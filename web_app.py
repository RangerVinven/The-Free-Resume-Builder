import json
import os
import re
import threading
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, render_template, request, send_file
from docxtpl import DocxTemplate

from resume_builder import (
    RESUMES_DIR,
    TEMPLATE_PATH,
    load_resume,
    save_resume,
    load_settings,
    save_settings,
)
from convert_to_pdf import convert_docx_to_pdf

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
pdf_lock = threading.Lock()


def ensure_dirs():
    RESUMES_DIR.mkdir(exist_ok=True)


def resolve_resume_path(filename: str) -> Path | None:
    """Safely resolve a resume JSON path inside RESUMES_DIR."""
    clean_name = Path(filename).name
    if not clean_name.endswith(".json") or clean_name != filename:
        return None
    target = (RESUMES_DIR / clean_name).resolve()
    if target.parent != RESUMES_DIR.resolve():
        return None
    return target


def render_docx_file(data: dict, out_docx_path: Path) -> Path:
    """Render resume JSON data into a .docx file using Base_Template.docx."""
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Template not found: {TEMPLATE_PATH}")
    doc = DocxTemplate(TEMPLATE_PATH)
    doc.render(data)
    doc.save(out_docx_path)
    return out_docx_path


@app.route("/")
def index():
    ensure_dirs()
    return render_template("index.html")


@app.route("/api/resumes", methods=["GET"])
def list_resumes():
    ensure_dirs()
    items = []
    for f in sorted(RESUMES_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = load_resume(f)
            items.append({
                "filename": f.name,
                "name": data.get("name") or f.stem,
                "email": data.get("email", ""),
                "phone": data.get("phone", ""),
                "section_count": len(data.get("sections", [])),
                "section_titles": [s.get("title", "") for s in data.get("sections", [])],
                "history_count": len(data.get("_history", [])),
                "updated_at": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
            })
        except Exception:
            items.append({
                "filename": f.name,
                "name": f.stem,
                "email": "",
                "phone": "",
                "section_count": 0,
                "section_titles": [],
                "history_count": 0,
                "updated_at": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
            })
    return jsonify({"resumes": items})


@app.route("/api/resumes", methods=["POST"])
def create_resume_api():
    ensure_dirs()
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Full Name is required."}), 400

    slug = re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_")
    if not slug:
        slug = "resume"
    filename = f"{slug}.json"
    filepath = RESUMES_DIR / filename

    if filepath.exists():
        return jsonify({"error": f"A resume named '{filename}' already exists."}), 409

    raw_sections = payload.get("sections")
    data = normalize_resume_schema({
        "name": name,
        "phone": (payload.get("phone") or "").strip(),
        "email": (payload.get("email") or "").strip(),
        "portfolio": (payload.get("portfolio") or "").strip(),
        "linkedin": (payload.get("linkedin") or "").strip(),
        "sections": raw_sections if isinstance(raw_sections, list) else [],
    })
    save_resume(filepath, data)
    return jsonify({"filename": filename, "data": data}), 201


@app.route("/api/resumes/<filename>", methods=["GET"])
def get_resume_api(filename):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404
    data = load_resume(filepath)
    return jsonify({"filename": filepath.name, "data": data})


@app.route("/api/resumes/<filename>", methods=["PUT"])
def update_resume_api(filename):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload."}), 400

    existing = load_resume(filepath)
    # Preserve existing _history unless explicitly managed via history endpoints
    if "_history" not in payload and "_history" in existing:
        payload["_history"] = existing["_history"]

    save_resume(filepath, payload)
    updated = load_resume(filepath)
    return jsonify({"filename": filepath.name, "data": updated})


@app.route("/api/resumes/<filename>", methods=["DELETE"])
def delete_resume_api(filename):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404

    payload = request.get_json(silent=True) or {}
    confirm_name = payload.get("confirm_filename", "")
    if confirm_name != filepath.name:
        return jsonify({"error": "Confirmation filename does not match."}), 400

    filepath.unlink()
    return jsonify({"deleted": filepath.name})


@app.route("/api/resumes/<filename>/history/<int:idx>/revert", methods=["POST"])
def revert_history_api(filename, idx):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404

    data = load_resume(filepath)
    history = data.get("_history", [])
    if idx < 0 or idx >= len(history):
        return jsonify({"error": "Invalid history index."}), 400

    target_state = dict(history[idx]["state"])
    target_state["_history"] = history
    save_resume(filepath, target_state)
    updated = load_resume(filepath)
    return jsonify({"filename": filepath.name, "data": updated})


@app.route("/api/resumes/<filename>/history/<int:idx>/export/<fmt>", methods=["GET"])
def export_history_api(filename, idx, fmt):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404
    if fmt not in ("docx", "pdf"):
        return jsonify({"error": "Format must be docx or pdf."}), 400

    data = load_resume(filepath)
    history = data.get("_history", [])
    if idx < 0 or idx >= len(history):
        return jsonify({"error": "Invalid history index."}), 400

    hist_state = history[idx]["state"]
    out_docx = Path(f"{filepath.stem}_history_{idx + 1}_generated.docx").resolve()
    render_docx_file(hist_state, out_docx)

    if fmt == "docx":
        return send_file(out_docx, as_attachment=True, download_name=out_docx.name)

    with pdf_lock:
        out_pdf = convert_docx_to_pdf(out_docx)
    if not out_pdf or not Path(out_pdf).exists():
        return jsonify({"error": "PDF conversion failed. Ensure Microsoft Word is accessible."}), 500
    return send_file(out_pdf, as_attachment=True, download_name=Path(out_pdf).name)


@app.route("/api/resumes/<filename>/export/docx", methods=["POST"])
def export_docx_api(filename):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404

    payload = request.get_json(silent=True)
    if isinstance(payload, dict) and payload.get("data"):
        data = payload["data"]
    else:
        data = load_resume(filepath)

    out_docx = Path(f"{filepath.stem}_generated.docx").resolve()
    render_docx_file(data, out_docx)
    return send_file(out_docx, as_attachment=True, download_name=out_docx.name)


@app.route("/api/resumes/<filename>/export/pdf", methods=["POST"])
def export_pdf_api(filename):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404

    payload = request.get_json(silent=True)
    if isinstance(payload, dict) and payload.get("data"):
        data = payload["data"]
    else:
        data = load_resume(filepath)

    out_docx = Path(f"{filepath.stem}_generated.docx").resolve()
    render_docx_file(data, out_docx)

    with pdf_lock:
        out_pdf = convert_docx_to_pdf(out_docx)

    if not out_pdf or not Path(out_pdf).exists():
        return jsonify({"error": "PDF conversion failed. Ensure Microsoft Word is accessible."}), 500
    return send_file(out_pdf, as_attachment=True, download_name=Path(out_pdf).name)


@app.route("/api/resumes/<filename>/preview-pdf", methods=["GET"])
def preview_pdf_api(filename):
    filepath = resolve_resume_path(filename)
    if not filepath or not filepath.exists():
        return jsonify({"error": "Resume not found."}), 404

    data = load_resume(filepath)
    out_docx = Path(f"{filepath.stem}_generated.docx").resolve()
    render_docx_file(data, out_docx)

    with pdf_lock:
        out_pdf = convert_docx_to_pdf(out_docx)

    if not out_pdf or not Path(out_pdf).exists():
        return jsonify({"error": "PDF conversion failed."}), 500
    return send_file(out_pdf, mimetype="application/pdf", as_attachment=False)


@app.route("/api/settings", methods=["GET"])
def get_settings_api():
    settings = load_settings()
    ai_cfg = settings.get("ai", {})
    settings.setdefault("ai", {
        "provider": ai_cfg.get("provider", "OpenAI"),
        "model": ai_cfg.get("model", "gpt-4o-mini"),
    })
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


def _clean_str(val) -> str:
    return val.strip() if isinstance(val, str) else (str(val).strip() if val is not None else "")


def normalize_resume_schema(raw_data: dict, existing_data: dict = None) -> dict:
    """Coerce an AI-produced or partial resume dict into the strict Base_Template schema."""
    src = raw_data if isinstance(raw_data, dict) else {}
    normalized = {
        "name": _clean_str(src.get("name")),
        "phone": _clean_str(src.get("phone")),
        "email": _clean_str(src.get("email")),
        "portfolio": _clean_str(src.get("portfolio")),
        "linkedin": _clean_str(src.get("linkedin")),
        "sections": [],
    }

    raw_sections = src.get("sections")
    if isinstance(raw_sections, list):
        for sec in raw_sections:
            if not isinstance(sec, dict):
                continue
            title = _clean_str(sec.get("title")).upper()
            if not title:
                continue
            is_skills = bool(sec.get("is_skills", False))
            raw_items = sec.get("items") if isinstance(sec.get("items"), list) else []
            clean_items = []
            if is_skills:
                for it in raw_items:
                    if not isinstance(it, dict):
                        continue
                    cat = _clean_str(it.get("category"))
                    txt = _clean_str(it.get("text"))
                    if cat or txt:
                        clean_items.append({"category": cat, "text": txt})
            else:
                for it in raw_items:
                    if not isinstance(it, dict):
                        continue
                    raw_details = it.get("details") if isinstance(it.get("details"), list) else []
                    clean_details = []
                    for d in raw_details:
                        if isinstance(d, dict):
                            d_txt = _clean_str(d.get("text"))
                            if d_txt:
                                clean_details.append({
                                    "is_bullet": bool(d.get("is_bullet", True)),
                                    "text": d_txt,
                                })
                        elif isinstance(d, str) and d.strip():
                            clean_details.append({"is_bullet": True, "text": d.strip()})

                    item_obj = {
                        "role": _clean_str(it.get("role")),
                        "company": _clean_str(it.get("company")),
                        "location": _clean_str(it.get("location")),
                        "date": _clean_str(it.get("date")),
                        "subtitle": _clean_str(it.get("subtitle")),
                        "subtitle_right": _clean_str(it.get("subtitle_right")),
                        "details": clean_details,
                    }
                    if any(item_obj[k] for k in ("role", "company", "location", "date", "subtitle", "subtitle_right")) or clean_details:
                        clean_items.append(item_obj)
            normalized["sections"].append({
                "title": title,
                "is_skills": is_skills,
                "items": clean_items,
            })

    if isinstance(existing_data, dict) and "_history" in existing_data:
        normalized["_history"] = existing_data["_history"]

    return normalized


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


def call_openai_chat(api_key: str, model: str, system_prompt: str, messages: list) -> dict:
    """Call OpenAI Chat Completions API with JSON response_format."""
    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = msg.get("role")
        content = (msg.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            api_messages.append({"role": role, "content": content})

    body = {
        "model": model or "gpt-4o-mini",
        "messages": api_messages,
        "response_format": {"type": "json_object"},
    }
    # Reasoning o-series models may reject custom temperature
    if not (model or "").startswith(("o1", "o3", "o4")):
        body["temperature"] = 0.4

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_text = e.read().decode("utf-8", errors="replace")
        try:
            err_msg = json.loads(err_text).get("error", {}).get("message") or err_text
        except Exception:
            err_msg = err_text
        if e.code == 401:
            raise ValueError("Invalid OpenAI API key. Please check your key in Settings.")
        if e.code == 429:
            raise ValueError(f"OpenAI rate limit or quota exceeded: {err_msg}")
        raise ValueError(f"OpenAI API error ({e.code}): {err_msg}")
    except urllib.error.URLError as e:
        raise ValueError(f"Network error contacting OpenAI: {e.reason}")

    content_str = raw["choices"][0]["message"]["content"]
    try:
        parsed = json.loads(content_str)
    except json.JSONDecodeError:
        return {"reply": content_str, "suggestions": []}

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
    model = ai_cfg.get("model", "gpt-4o-mini")
    api_keys = settings.get("api_keys", {})

    if provider != "OpenAI":
        return jsonify({"error": f"Provider '{provider}' is not enabled yet. Switch to OpenAI in Settings."}), 400

    api_key = (api_keys.get("OpenAI") or "").strip()
    if not api_key:
        return jsonify({"error": "No OpenAI API key configured. Open Settings to add your key."}), 400

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
        result = call_openai_chat(api_key, model, system_prompt, messages)
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
    ensure_dirs()
    app.run(host="127.0.0.1", port=5050, debug=False)
