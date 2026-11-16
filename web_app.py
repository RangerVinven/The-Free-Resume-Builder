import json
import os
import re
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path
from flask import Flask, jsonify, render_template, request, send_file
from docxtpl import DocxTemplate

from db import (
    _clean_str,
    create_ai_chat_db,
    create_resume_db,
    delete_ai_chat_db,
    delete_resume_db,
    duplicate_resume_db,
    get_ai_chat_db,
    get_resume_db,
    get_version_db,
    init_db,
    list_ai_chats_db,
    list_resumes_db,
    make_slug,
    normalize_resume_schema,
    revert_version_db,
    save_ai_chat_db,
    update_resume_db,
)
from resume_builder import (
    TEMPLATE_PATH,
    build_render_context,
    load_settings,
    save_settings,
)
from convert_to_pdf import convert_docx_to_pdf

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
pdf_lock = threading.Lock()
_db_initialized = False
_db_lock = threading.Lock()


def ensure_db():
    global _db_initialized
    if not _db_initialized:
        with _db_lock:
            if not _db_initialized:
                init_db()
                _db_initialized = True


def _render_resume_bytes(data: dict, stem: str, fmt: str) -> BytesIO | None:
    """Render DOCX or PDF inside an ephemeral temporary directory and return file bytes."""
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Template not found: {TEMPLATE_PATH}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_docx = Path(tmpdir) / f"{stem}_generated.docx"
        doc = DocxTemplate(TEMPLATE_PATH)
        doc.render(build_render_context(data), autoescape=True)
        doc.save(tmp_docx)

        if fmt == "docx":
            return BytesIO(tmp_docx.read_bytes())

        with pdf_lock:
            out_pdf = convert_docx_to_pdf(tmp_docx)
        if not out_pdf or not Path(out_pdf).exists():
            return None
        return BytesIO(Path(out_pdf).read_bytes())


@app.route("/")
def index():
    ensure_db()
    return render_template("index.html")


@app.route("/api/health", methods=["GET"])
def health_check():
    ensure_db()
    return jsonify({"status": "ok"})


@app.route("/api/resumes", methods=["GET"])
def list_resumes():
    ensure_db()
    return jsonify({"resumes": list_resumes_db()})


@app.route("/api/resumes", methods=["POST"])
def create_resume_api():
    ensure_db()
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Full Name is required."}), 400

    try:
        created = create_resume_db(payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(created), 201


@app.route("/api/resumes/import", methods=["POST"])
def import_resume_api():
    ensure_db()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON resume file."}), 400

    # Support either direct resume object or wrapped { data: {...} }
    candidate = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    fallback_name = _clean_str(payload.get("fallback_name"))
    normalized = normalize_resume_schema(candidate)
    if not normalized["name"] and fallback_name:
        normalized["name"] = fallback_name
    if not normalized["name"]:
        return jsonify({"error": "Imported JSON must include a candidate 'name'."}), 400

    try:
        created = create_resume_db(normalized, initial_label="Imported from JSON")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(created), 201


@app.route("/api/resumes/<int:resume_id>/duplicate", methods=["POST"])
def duplicate_resume_api(resume_id):
    ensure_db()
    duplicated = duplicate_resume_db(resume_id)
    if not duplicated:
        return jsonify({"error": "Resume not found."}), 404
    return jsonify(duplicated), 201


@app.route("/api/resumes/<int:resume_id>", methods=["GET"])
def get_resume_api(resume_id):
    ensure_db()
    record = get_resume_db(resume_id)
    if not record:
        return jsonify({"error": "Resume not found."}), 404
    return jsonify(record)


@app.route("/api/resumes/<int:resume_id>", methods=["PUT", "POST"])
def update_resume_api(resume_id):
    ensure_db()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid request payload."}), 400

    if isinstance(payload.get("data"), dict):
        save_mode = (payload.get("save_mode") or "autosave").strip().lower()
        resume_data = payload["data"]
    else:
        save_mode = (payload.get("save_mode") or "snapshot").strip().lower()
        resume_data = payload

    if save_mode not in ("autosave", "snapshot", "ai"):
        save_mode = "autosave"

    updated = update_resume_db(resume_id, resume_data, save_mode=save_mode)
    if not updated:
        return jsonify({"error": "Resume not found."}), 404
    return jsonify(updated)


@app.route("/api/resumes/<int:resume_id>", methods=["DELETE"])
def delete_resume_api(resume_id):
    ensure_db()
    payload = request.get_json(silent=True) or {}
    confirm_name = payload.get("confirm_name", "")
    ok, detail = delete_resume_db(resume_id, confirm_name)
    if not ok:
        if detail == "not_found":
            return jsonify({"error": "Resume not found."}), 404
        return jsonify({"error": "Confirmation name does not match."}), 400
    return jsonify({"deleted_id": resume_id, "deleted_name": detail})


@app.route("/api/resumes/<int:resume_id>/history/<int:version_id>/revert", methods=["POST"])
def revert_history_api(resume_id, version_id):
    ensure_db()
    updated = revert_version_db(resume_id, version_id)
    if not updated:
        return jsonify({"error": "Resume or history version not found."}), 404
    return jsonify(updated)


@app.route("/api/resumes/<int:resume_id>/history/<int:version_id>/export/<fmt>", methods=["GET"])
def export_history_api(resume_id, version_id, fmt):
    ensure_db()
    if fmt not in ("docx", "pdf", "json"):
        return jsonify({"error": "Format must be docx, pdf, or json."}), 400

    ver = get_version_db(resume_id, version_id)
    if not ver:
        return jsonify({"error": "Resume or history version not found."}), 404

    hist_state = ver["state"]
    slug = ver["slug"]
    ver_num = ver["version_num"]

    if fmt == "json":
        buf = BytesIO(json.dumps(hist_state, indent=2).encode("utf-8"))
        return send_file(
            buf,
            mimetype="application/json",
            as_attachment=True,
            download_name=f"{slug}_v{ver_num}.json",
        )

    stem = f"{slug}_history_v{ver_num}"
    buf = _render_resume_bytes(hist_state, stem, fmt)
    if buf is None:
        return jsonify({"error": "PDF conversion failed. Ensure Microsoft Word is accessible."}), 500
    mime = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if fmt == "docx"
        else "application/pdf"
    )
    return send_file(buf, mimetype=mime, as_attachment=True, download_name=f"{stem}_generated.{fmt}")


def _extract_export_payload(resume_id: int) -> tuple[dict | None, str | None]:
    record = get_resume_db(resume_id)
    if not record:
        return None, None
    payload = request.get_json(silent=True)
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        data = normalize_resume_schema(payload["data"])
    else:
        data = normalize_resume_schema(record["data"])
    slug = make_slug(data.get("name") or record["slug"])
    return data, slug


@app.route("/api/resumes/<int:resume_id>/export/json", methods=["POST"])
def export_json_api(resume_id):
    ensure_db()
    data, slug = _extract_export_payload(resume_id)
    if data is None:
        return jsonify({"error": "Resume not found."}), 404
    buf = BytesIO(json.dumps(data, indent=2).encode("utf-8"))
    return send_file(
        buf,
        mimetype="application/json",
        as_attachment=True,
        download_name=f"{slug}.json",
    )


@app.route("/api/resumes/<int:resume_id>/export/docx", methods=["POST"])
def export_docx_api(resume_id):
    ensure_db()
    data, slug = _extract_export_payload(resume_id)
    if data is None:
        return jsonify({"error": "Resume not found."}), 404

    buf = _render_resume_bytes(data, slug, "docx")
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name=f"{slug}_generated.docx",
    )


@app.route("/api/resumes/<int:resume_id>/export/pdf", methods=["POST"])
def export_pdf_api(resume_id):
    ensure_db()
    data, slug = _extract_export_payload(resume_id)
    if data is None:
        return jsonify({"error": "Resume not found."}), 404

    buf = _render_resume_bytes(data, slug, "pdf")
    if buf is None:
        return jsonify({"error": "PDF conversion failed. Ensure Microsoft Word is accessible."}), 500
    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"{slug}_generated.pdf",
    )


@app.route("/api/resumes/<int:resume_id>/preview-pdf", methods=["GET"])
def preview_pdf_api(resume_id):
    ensure_db()
    record = get_resume_db(resume_id)
    if not record:
        return jsonify({"error": "Resume not found."}), 404

    data = normalize_resume_schema(record["data"])
    slug = make_slug(data.get("name") or record["slug"])
    buf = _render_resume_bytes(data, slug, "pdf")
    if buf is None:
        return jsonify({"error": "PDF conversion failed."}), 500
    return send_file(buf, mimetype="application/pdf", as_attachment=False)


@app.route("/api/resumes/<int:resume_id>/chats", methods=["GET"])
def list_resume_chats_api(resume_id):
    ensure_db()
    if not get_resume_db(resume_id):
        return jsonify({"error": "Resume not found."}), 404
    return jsonify({"chats": list_ai_chats_db(resume_id)})


@app.route("/api/chats", methods=["POST"])
def create_chat_api():
    ensure_db()
    payload = request.get_json(silent=True) or {}
    resume_id = payload.get("resume_id")
    if resume_id is not None and not get_resume_db(int(resume_id)):
        return jsonify({"error": "Resume not found."}), 404
    chat = create_ai_chat_db(
        resume_id=int(resume_id) if resume_id is not None else None,
        title=_clean_str(payload.get("title")),
        messages=payload.get("messages") or [],
    )
    return jsonify(chat), 201


@app.route("/api/chats/<int:chat_id>", methods=["GET"])
def get_chat_api(chat_id):
    ensure_db()
    chat = get_ai_chat_db(chat_id)
    if not chat:
        return jsonify({"error": "Chat not found."}), 404
    return jsonify(chat)


@app.route("/api/chats/<int:chat_id>", methods=["PUT"])
def update_chat_api(chat_id):
    ensure_db()
    payload = request.get_json(silent=True) or {}
    resume_id = payload.get("resume_id")
    if resume_id is not None and not get_resume_db(int(resume_id)):
        return jsonify({"error": "Resume not found."}), 404
    updated = save_ai_chat_db(
        chat_id,
        messages=payload.get("messages"),
        title=payload.get("title"),
        resume_id=int(resume_id) if resume_id is not None else None,
    )
    if not updated:
        return jsonify({"error": "Chat not found."}), 404
    return jsonify(updated)


@app.route("/api/chats/<int:chat_id>", methods=["DELETE"])
def delete_chat_api(chat_id):
    ensure_db()
    if not delete_ai_chat_db(chat_id):
        return jsonify({"error": "Chat not found."}), 404
    return jsonify({"status": "deleted"})


@app.route("/api/settings", methods=["GET"])
def get_settings_api():
    settings = load_settings()
    ai_cfg = settings.get("ai", {})
    settings.setdefault("ai", {
        "provider": ai_cfg.get("provider", "OpenAI"),
        "model": ai_cfg.get("model", "gpt-4o-mini"),
    })
    fmt_cfg = settings.get("formatting", {})
    settings["formatting"] = {
        "standardize_skills_gap": bool(fmt_cfg.get("standardize_skills_gap", True)),
    }
    return jsonify({"settings": settings})


@app.route("/api/settings", methods=["PUT"])
def update_settings_api():
    payload = request.get_json(silent=True) or {}
    settings = load_settings()
    api_keys = payload.get("api_keys")
    if isinstance(api_keys, dict):
        cleaned = {k: v.strip() for k, v in api_keys.items() if isinstance(v, str) and v.strip()}
        settings["api_keys"] = cleaned
    ai_cfg = payload.get("ai")
    if isinstance(ai_cfg, dict):
        settings["ai"] = {
            "provider": (ai_cfg.get("provider") or "OpenAI").strip(),
            "model": (ai_cfg.get("model") or "gpt-4o-mini").strip(),
        }
    fmt_cfg = payload.get("formatting")
    if isinstance(fmt_cfg, dict):
        settings["formatting"] = {
            "standardize_skills_gap": bool(fmt_cfg.get("standardize_skills_gap", True)),
        }
    save_settings(settings)
    return jsonify({"settings": settings})


SHARED_BULLET_GUIDE = (
    "Bullet Point Writing Standards (Modified Google XYZ + Action-Impact):\n"
    "- Formula: Lead with a strong action verb, state the quantified result or concrete outcome (X/Y), "
    "and specify the technical method, system, or scope (Z): '[Verb] + [Accomplished X / Metric Y] + [by doing Z]'.\n"
    "- Length: Aim for 1 crisp line on US Letter (roughly 80-125 characters). Never exceed 2 lines "
    "(~190 characters max). Cut filler such as 'Responsible for', 'Helped to', 'Assisted with', or 'Successfully'.\n"
    "- Statistics & Numbers: Highlight concrete numbers (%, $, latency, throughput, hours saved, team size, users) "
    "whenever the user supplies them. NEVER invent or guess numbers. If the user's description lacks metrics or scope, "
    "ask 1-3 quick questions in 'reply' to uncover real numbers before locking in final bullets.\n"
    "- Tense & Punctuation: Past tense for previous roles; present tense for ongoing/current roles. "
    "Do NOT include leading bullet characters ('•', '-', '*').\n\n"
    "Reference Examples (notice 1-line punchiness, XYZ ordering, and clear metrics):\n"
    "1. Weak: 'Helped make our backend API faster using Redis and Postgres queries.'\n"
    "   Strong: 'Reduced API p95 latency by 42% (310ms to 180ms) for 120K daily users by adding Redis caching and SQL indexing.'\n"
    "2. Weak: 'Built automation scripts for the finance team spreadsheet work.'\n"
    "   Strong: 'Automated nightly billing reconciliation in Python and PostgreSQL, saving 12 hours of manual audits weekly.'\n"
    "3. Weak: 'Managed Kubernetes migration project with a group of developers.'\n"
    "   Strong: 'Led 4 engineers to migrate 18 legacy microservices to Kubernetes ahead of schedule with zero downtime.'\n"
    "4. Weak: 'Did customer support onboarding and improved satisfaction.'\n"
    "   Strong: 'Cut enterprise onboarding time from 14 days to 5 days by redesigning kickoff playbooks across 60+ accounts.'\n"
    "5. Weak: 'Created an ML model for detecting fraud in transactions.'\n"
    "   Strong: 'Built an XGBoost fraud classifier on 2.4M transactions, raising recall by 19% while keeping false positives under 1%.'\n"
    "6. When user confirms no numeric metric is available (focus on concrete scope & outcome):\n"
    "   Strong: 'Designed a centralized React component library adopted across 5 internal product teams to unify UI accessibility.'"
)


def build_bullet_system_prompt(context: dict) -> str:
    """Build a focused, factual system prompt for drafting or refining resume details."""
    section = context.get("section_title") or "EXPERIENCE"
    role = context.get("role") or ""
    company = context.get("company") or ""
    location = context.get("location") or ""
    date = context.get("date") or ""
    subtitle = context.get("subtitle") or ""
    is_bullet = context.get("is_bullet", True)
    current_text = (context.get("current_text") or "").strip()
    siblings = [s for s in (context.get("sibling_details") or []) if isinstance(s, str) and s.strip()]

    style_label = "bullet point" if is_bullet else "concise prose paragraph"
    ctx_lines = [f"Section: {section}"]
    if role:
        ctx_lines.append(f"Role/Title: {role}")
    if company:
        ctx_lines.append(f"Company/Organization: {company}")
    if location:
        ctx_lines.append(f"Location: {location}")
    if date:
        ctx_lines.append(f"Date: {date}")
    if subtitle:
        ctx_lines.append(f"Subtitle: {subtitle}")
    if current_text:
        ctx_lines.append(f"Current Draft Text: {current_text}")
    if siblings:
        formatted_siblings = "\n".join(f"- {s}" for s in siblings[:8])
        ctx_lines.append(f"Other existing bullets/details in this entry (do not duplicate):\n{formatted_siblings}")

    ctx_block = "\n".join(ctx_lines)

    style_section = (
        f"{SHARED_BULLET_GUIDE}\n\n"
        if is_bullet
        else (
            "Prose Writing Standards:\n"
            "- Write a tight 1-2 line prose statement grounded strictly in facts provided by the user.\n"
            "- Prioritize measurable outcomes or concrete scope; do NOT include leading bullet symbols ('•', '-', '*').\n\n"
        )
    )

    return (
        "You are a precise, practical resume writing coach helping the user craft a single "
        f"{style_label} for their resume.\n\n"
        f"Resume Entry Context:\n{ctx_block}\n\n"
        f"{style_section}"
        "Interaction Guidelines:\n"
        "1. Never invent metrics, technologies, responsibilities, or achievements the user has not stated.\n"
        "2. If the user has not yet described what they did—or if asking for numbers/scale (e.g., %, $, time saved, "
        "user volume) would turn a generic line into an XYZ bullet—ask 1 to 3 concise, specific questions.\n"
        "3. When you have enough information (or when the user asks for examples or rewrites), provide 2 to 3 "
        "distinct, crisp options (e.g., 'Impact-Focused (1-line)', 'Technical', 'Concise').\n"
        "4. Avoid generic fluff and exaggerated buzzwords.\n\n"
        "You MUST respond strictly with a JSON object matching this schema:\n"
        "{\n"
        '  "reply": "Short conversational message or 1-3 clear clarifying questions.",\n'
        '  "suggestions": [\n'
        '    {"label": "Impact-Focused", "text": "..."},\n'
        '    {"label": "Concise", "text": "..."}\n'
        "  ]\n"
        "}\n"
        "Use an empty array [] for \"suggestions\" when you are only asking clarifying questions before drafting."
    )


def build_full_resume_system_prompt(resume_data: dict) -> str:
    """Build the system prompt for conversational full-resume construction."""
    snapshot = normalize_resume_schema(resume_data or {})
    snapshot.pop("_history", None)
    snapshot_json = json.dumps(snapshot, indent=2)

    return (
        "You are an expert, practical resume architect collaborating step-by-step with the user to build "
        "or refine their complete resume.\n\n"
        f"Current Resume JSON State:\n```json\n{snapshot_json}\n```\n\n"
        "Exact Target Schema for `updated_resume`:\n"
        "{\n"
        '  "name": "Full Name",\n'
        '  "phone": "...",\n'
        '  "email": "...",\n'
        '  "portfolio": "...",\n'
        '  "linkedin": "...",\n'
        '  "sections": [\n'
        "    {\n"
        '      "title": "UPPERCASE SECTION TITLE (e.g. EXPERIENCE, EDUCATION, PROJECTS, SKILLS)",\n'
        '      "is_skills": false,\n'
        '      "items": [\n'
        "        {\n"
        '          "role": "Primary Role, Degree, or Project Name",\n'
        '          "company": "Organization / University",\n'
        '          "location": "City, State",\n'
        '          "date": "May 2023 - Present",\n'
        '          "subtitle": "Optional secondary left metadata (e.g., Coursework, GPA)",\n'
        '          "subtitle_right": "Optional secondary right metadata",\n'
        '          "details": [\n'
        '            {"is_bullet": true, "text": "Clean bullet text without leading symbol"}\n'
        "          ]\n"
        "        }\n"
        "      ]\n"
        "    },\n"
        "    {\n"
        '      "title": "TECHNICAL SKILLS",\n'
        '      "is_skills": true,\n'
        '      "items": [\n'
        '        {"category": "Languages", "text": "Python, TypeScript, SQL"}\n'
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        f"{SHARED_BULLET_GUIDE}\n\n"
        "Guidelines:\n"
        "1. Never fabricate employers, degrees, dates, projects, technologies, or metrics the user has not provided.\n"
        "2. Whenever the user shares facts (name, contact info, education, roles, projects, bullet ideas, or skills), "
        "incorporate them into `updated_resume` right away—formatting bullet points to match the Bullet Point Writing Standards above—"
        "while preserving ALL existing resume data they did not ask to remove.\n"
        "3. Use `is_skills: true` ONLY for two-column key-value sections (`category` + `text`), and `is_skills: false` for standard entries.\n"
        "4. Always uppercase section `title` strings, and omit leading bullet symbols ('•', '-', '*') inside `details[].text`.\n"
        "5. If user descriptions lack numbers or measurable outcomes, still draft clean initial bullets from known facts AND "
        "ask 2 to 4 focused questions in `reply` (asking for stats/metrics/scale or missing resume sections next).\n"
        "6. You MUST respond strictly with a JSON object matching:\n"
        "{\n"
        '  "reply": "Conversational response summarizing what you updated and/or asking clear next questions.",\n'
        '  "changes_summary": ["Short bullet describing each change applied to the resume, or empty array [] if none"],\n'
        '  "updated_resume": <full updated resume object matching the schema above, or null if no resume fields changed>\n'
        "}"
    )


def _parse_ai_json_response(content_str: str) -> dict:
    """Parse structured JSON output from any AI provider (stripping optional markdown fences)."""
    cleaned = (content_str or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return {"reply": content_str, "suggestions": [], "updated_resume": None, "changes_summary": []}

    if not isinstance(parsed, dict):
        return {"reply": content_str, "suggestions": [], "updated_resume": None, "changes_summary": []}

    reply = parsed.get("reply") or ""
    suggestions = parsed.get("suggestions") or []
    clean_suggestions = []
    if isinstance(suggestions, list):
        for s in suggestions:
            if isinstance(s, dict) and isinstance(s.get("text"), str) and s["text"].strip():
                clean_suggestions.append({
                    "label": (s.get("label") or "Option").strip(),
                    "text": s["text"].strip(),
                })

    changes_summary = []
    raw_changes = parsed.get("changes_summary")
    if isinstance(raw_changes, list):
        changes_summary = [_clean_str(c) for c in raw_changes if _clean_str(c)]

    updated_resume = parsed.get("updated_resume")
    if not isinstance(updated_resume, dict):
        updated_resume = None

    return {
        "reply": reply,
        "suggestions": clean_suggestions,
        "updated_resume": updated_resume,
        "changes_summary": changes_summary,
    }


def _post_json_api(url: str, headers: dict, body: dict, provider_name: str) -> dict:
    """Send a JSON POST request to an AI provider API and normalize error messages."""
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_text = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_text)
            err_msg = (
                (err_json.get("error") or {}).get("message")
                if isinstance(err_json.get("error"), dict)
                else err_json.get("message")
            ) or err_text
        except Exception:
            err_msg = err_text
        if e.code in (401, 403):
            raise ValueError(f"Invalid or unauthorized {provider_name} API key. Please check Settings.")
        if e.code == 429:
            raise ValueError(f"{provider_name} rate limit or quota exceeded: {err_msg}")
        raise ValueError(f"{provider_name} API error ({e.code}): {err_msg}")
    except urllib.error.URLError as e:
        raise ValueError(f"Network error contacting {provider_name}: {e.reason}")


def call_openai_chat(api_key: str, model: str, system_prompt: str, messages: list) -> dict:
    """Call OpenAI Chat Completions API with JSON response_format."""
    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = msg.get("role")
        content = (msg.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            api_messages.append({"role": role, "content": content})

    body: dict = {
        "model": model or "gpt-4o-mini",
        "messages": api_messages,
        "response_format": {"type": "json_object"},
    }
    if not (model or "").startswith(("o1", "o3", "o4")):
        body["temperature"] = 0.4

    raw = _post_json_api(
        "https://api.openai.com/v1/chat/completions",
        {"Authorization": f"Bearer {api_key}"},
        body,
        "OpenAI",
    )
    content_str = raw["choices"][0]["message"]["content"]
    return _parse_ai_json_response(content_str)


def call_gemini_chat(api_key: str, model: str, system_prompt: str, messages: list) -> dict:
    """Call Google Gemini generateContent REST API with JSON responseMimeType."""
    target_model = model or "gemini-2.5-flash"
    contents = []
    for msg in messages:
        role = msg.get("role")
        content = (msg.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            contents.append({
                "role": "model" if role == "assistant" else "user",
                "parts": [{"text": content}],
            })

    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json",
        },
    }
    encoded_model = urllib.parse.quote(target_model, safe="-.")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{encoded_model}:generateContent"
    raw = _post_json_api(
        url,
        {"x-goog-api-key": api_key},
        body,
        "Gemini",
    )
    candidates = raw.get("candidates") or []
    parts = (candidates[0].get("content") or {}).get("parts") or [] if candidates else []
    content_str = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    return _parse_ai_json_response(content_str)


def call_claude_chat(api_key: str, model: str, system_prompt: str, messages: list) -> dict:
    """Call Anthropic Claude Messages API requesting strict JSON output."""
    target_model = model or "claude-sonnet-4-5"
    api_messages = []
    for msg in messages:
        role = msg.get("role")
        content = (msg.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            api_messages.append({"role": role, "content": content})

    body = {
        "model": target_model,
        "max_tokens": 4096,
        "temperature": 0.4,
        "system": system_prompt + "\n\nRespond with a valid JSON object only (no markdown code fences).",
        "messages": api_messages,
    }
    raw = _post_json_api(
        "https://api.anthropic.com/v1/messages",
        {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        body,
        "Claude",
    )
    blocks = raw.get("content") or []
    content_str = "".join(
        b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"
    )
    return _parse_ai_json_response(content_str)


AI_PROVIDERS = {
    "OpenAI": ("gpt-4o-mini", call_openai_chat),
    "Gemini": ("gemini-2.5-flash", call_gemini_chat),
    "Claude": ("claude-sonnet-4-5", call_claude_chat),
}


@app.route("/api/ai/assist", methods=["POST"])
def ai_assist_api():
    payload = request.get_json(silent=True) or {}
    mode = payload.get("mode", "bullet")
    context = payload.get("context") or {}
    messages = payload.get("messages") or []

    if mode not in ("bullet", "full_resume"):
        return jsonify({"error": f"Unsupported assistant mode: {mode}"}), 400

    settings = load_settings()
    ai_cfg = settings.get("ai", {})
    provider = ai_cfg.get("provider", "OpenAI")
    api_keys = settings.get("api_keys", {})

    if provider not in AI_PROVIDERS:
        supported = ", ".join(AI_PROVIDERS.keys())
        return jsonify({"error": f"Unsupported provider '{provider}'. Choose one of: {supported}."}), 400

    default_model, caller_fn = AI_PROVIDERS[provider]
    model = (ai_cfg.get("model") or "").strip() or default_model
    api_key = (api_keys.get(provider) or "").strip()
    if not api_key:
        return jsonify({"error": f"No {provider} API key configured. Open Settings to add your key."}), 400

    if mode == "full_resume":
        existing_resume = payload.get("resume_data") or {}
        if not messages:
            messages = [{"role": "user", "content": "Let's build or refine my resume. Ask me what I'd like to include."}]
        system_prompt = build_full_resume_system_prompt(existing_resume)
    else:
        if not messages:
            messages = [{"role": "user", "content": "Help me draft this resume item. Ask me clarifying questions about what I did if needed."}]
        system_prompt = build_bullet_system_prompt(context)

    try:
        result = caller_fn(api_key, model, system_prompt, messages)
        response_body = {
            "reply": result["reply"],
            "suggestions": result["suggestions"],
            "provider": provider,
            "model": model,
        }
        if mode == "full_resume":
            existing_resume = payload.get("resume_data") or {}
            normalized = (
                normalize_resume_schema(result["updated_resume"], existing_resume)
                if result["updated_resume"] is not None
                else None
            )
            response_body["updated_resume"] = normalized
            response_body["changes_summary"] = result["changes_summary"]
        return jsonify(response_body)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Assistant error: {str(e)}"}), 500


if __name__ == "__main__":
    ensure_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5050"))
    app.run(host=host, port=port, debug=False)
