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
    load_settings,
    render_resume_docx,
    save_settings,
)
from convert_to_pdf import convert_docx_to_pdf

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
pdf_lock = threading.Lock()
_settings_lock = threading.Lock()
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
        render_resume_docx(data, tmp_docx)

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
    settings.pop("formatting", None)
    return jsonify({"settings": settings})


@app.route("/api/settings", methods=["PUT"])
def update_settings_api():
    payload = request.get_json(silent=True) or {}
    with _settings_lock:
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
        settings.pop("formatting", None)
        save_settings(settings)
    return jsonify({"settings": settings})


SHARED_BULLET_GUIDE = (
    "Universal Bullet Point Writing Standards (Google XYZ + Action-Impact, All Industries):\n"
    "- Formula: Lead with a strong past/present action verb, state the concrete outcome or quantified result (X/Y), "
    "and specify the method, tool, system, or scope (Z): '[Strong Verb] + [Accomplished X / Metric Y] + [via/by Z]'.\n"
    "- Length Discipline (Critical): Target 85-125 characters (1 crisp line on US Letter). NEVER exceed 175 characters. "
    "Cut filler words ('Responsible for', 'Helped to', 'Assisted with', 'Worked on', 'Successfully', unnecessary articles like 'the'/'a', 'every single week' -> 'weekly').\n"
    "- Action Verb Upgrading: NEVER blindly mirror casual or passive user verbs ('worked on', 'made', 'did', 'rewrote', 'helped', 'handled', 'used'). "
    "Pick an accurate, authoritative verb matched to the industry and task:\n"
    "  * Creation & Architecture: Architected, Engineered, Designed, Built, Launched, Authored, Established\n"
    "  * Optimization & Transformation: Re-engineered, Overhauled, Streamlined, Optimized, Accelerated, Modernized, Consolidated\n"
    "  * Leadership & Instruction: Led, Directed, Mentored, Coordinated, Trained, Facilitated, Spearheaded\n"
    "  * Protection, Automation & Cost/Risk Control: Automated, Hardened, Eliminated, Mitigated, Secured, Resolved, Audited\n"
    "  * Growth & Delivery: Increased, Generated, Expanded, Delivered, Secured, Exceeded, Saved\n"
    "- Facts, Metrics & Scope: Preserve ALL concrete numbers, baselines (e.g. '1.2s to 450ms'), tools, and scale the user gave. "
    "Highlight relevant metrics for the user's field (%, $, hours saved, revenue, patients/clients served, error/defect reduction, SLA, latency, pass rates). "
    "NEVER invent, estimate, or insert placeholder numbers (such as '10+', '20%', '30%', '100+') when the user did not supply them, and prefer exact stated figures (e.g. 'from 18% to 29%') over unrequested derived percentages.\n"
    "- Tense & Punctuation: Past tense for previous roles; present tense for current/ongoing roles. "
    "Do NOT include leading bullet characters ('•', '-', '*').\n\n"
    "Cross-Domain Reference Examples (notice 85-125 char 1-line punchiness and strong verbs):\n"
    "1. Engineering — Weak: 'Helped make our backend API faster using Redis and Postgres.'\n"
    "   Strong (105 chars): 'Reduced API p95 latency by 42% (310ms to 180ms) for 120K daily users via Redis caching and SQL indexing.'\n"
    "2. Marketing — Weak: 'Ran social media ads and improved our lead numbers.'\n"
    "   Strong (110 chars): 'Grew qualified inbound leads by 38% while lowering CAC 22% across $150K in targeted Meta and LinkedIn campaigns.'\n"
    "3. Healthcare — Weak: 'Helped check in patients faster and fixed scheduling errors.'\n"
    "   Strong (108 chars): 'Streamlined clinical intake across 45+ daily patients, cutting wait times 30% and eliminating charting errors.'\n"
    "4. Finance / Ops — Weak: 'Built automation scripts for the finance team spreadsheet work.'\n"
    "   Strong (98 chars): 'Automated nightly billing reconciliation in Python and SQL, saving 12 hours of manual audits weekly.'\n"
    "5. Education / Leadership — Weak: 'Taught coding workshops and helped students pass.'\n"
    "   Strong (105 chars): 'Mentored 60+ undergraduate students in Python algorithms, lifting cohort exam pass rates from 74% to 92%.'\n"
    "6. When user gives NO numbers (focus strictly on factual scope, tools, and qualitative outcome):\n"
    "   BAD (fabricated '30%' & '10+'): 'Improved build stability by 30% across 10+ pull requests.'\n"
    "   GOOD (103 chars, zero fake stats): 'Standardized Python unit testing and PR validation checks to catch regressions before production builds.'"
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
            "- Write a tight 1-3 line prose statement grounded strictly in facts provided by the user.\n"
            "- Prioritize measurable outcomes, domain expertise, or concrete scope; do NOT include leading bullet symbols ('•', '-', '*').\n\n"
        )
    )

    return (
        "You are an expert, domain-adaptable resume writing coach helping the user craft a single "
        f"{style_label} for their resume.\n\n"
        f"Resume Entry Context:\n{ctx_block}\n\n"
        f"{style_section}"
        "Interaction Guidelines:\n"
        "1. STRICT FACTUALITY: Never invent or guess any numbers, percentages, user counts, durations, tools, or achievements the user did not explicitly state. If the user gave no numbers, your drafts MUST contain zero numbers.\n"
        "2. Scope Authorization: Only add, change, or revise details the user directly asked for or authorized; do not introduce unrequested topics or claims.\n"
        "3. ALWAYS draft 2 distinct suggestions whenever the user has provided ANY work description, task, or Current Draft Text—even if numbers are missing:\n"
        "   - 'Action-Focused' (or 'Impact-Focused' when user provided metrics): Retain ALL concrete facts, baselines, tools, and scale the user provided (under 175 chars).\n"
        "   - 'Concise (1-Line)': Strictly 80-120 characters (must be shorter than the first option) while keeping the strongest stated fact/outcome.\n"
        "4. If adding real numbers/scale (e.g., %, $, volume, time saved, team size) would strengthen the drafts, ask 1-2 short, domain-relevant follow-up questions in 'reply' alongside your factual drafts.\n"
        "5. ONLY return an empty array [] for 'suggestions' if the user has not described any work or task yet (e.g., asking how to start from a blank box).\n"
        "6. Avoid hollow corporate clichés (e.g. 'synergized', 'thought leader', 'dynamic self-starter').\n\n"
        "You MUST respond strictly with a JSON object matching this schema:\n"
        "{\n"
        '  "reply": "Brief feedback plus 1-2 optional follow-up questions if metrics are missing.",\n'
        '  "suggestions": [\n'
        '    {"label": "Action-Focused", "text": "..."},\n'
        '    {"label": "Concise (1-Line)", "text": "..."}\n'
        "  ]\n"
        "}"
    )


def build_full_resume_system_prompt(resume_data: dict) -> str:
    """Build the system prompt for conversational full-resume construction."""
    snapshot = normalize_resume_schema(resume_data or {})
    snapshot.pop("_history", None)
    snapshot.pop("formatting", None)
    snapshot_json = json.dumps(snapshot, indent=2)

    return (
        "You are an expert, domain-adaptable resume architect collaborating step-by-step with the user to build "
        "or refine their complete resume across any profession or industry.\n\n"
        f"Current Resume JSON State:\n```json\n{snapshot_json}\n```\n\n"
        "Target Schema Structure for `updated_resume` (ONLY include sections the user provided or that already exist in Current Resume JSON State):\n"
        "{\n"
        '  "name": "<Full Name>",\n'
        '  "phone": "<Phone>",\n'
        '  "email": "<Email>",\n'
        '  "portfolio": "<Portfolio URL>",\n'
        '  "linkedin": "<LinkedIn URL>",\n'
        '  "sections": [\n'
        "    {\n"
        '      "title": "<UPPERCASE SECTION TITLE, e.g. PROFESSIONAL SUMMARY>",\n'
        '      "is_skills": false,\n'
        '      "items": [\n'
        "        {\n"
        '          "role": "",\n'
        '          "company": "",\n'
        '          "location": "",\n'
        '          "date": "",\n'
        '          "subtitle": "",\n'
        '          "subtitle_right": "",\n'
        '          "details": [{"is_bullet": false, "text": "<Prose summary paragraph>"}]\n'
        "        }\n"
        "      ]\n"
        "    },\n"
        "    {\n"
        '      "title": "<UPPERCASE SECTION TITLE, e.g. EXPERIENCE, EDUCATION, PROJECTS>",\n'
        '      "is_skills": false,\n'
        '      "items": [\n'
        "        {\n"
        '          "role": "<Role, Degree, or Project Name>",\n'
        '          "company": "<Organization / University>",\n'
        '          "location": "<City, State>",\n'
        '          "date": "<Date Range>",\n'
        '          "subtitle": "<Optional left metadata, e.g. Degree/GPA>",\n'
        '          "subtitle_right": "<Optional right metadata>",\n'
        '          "details": [{"is_bullet": true, "text": "<Crisp XYZ bullet under 175 chars, target 85-125 chars>"}]\n'
        "        }\n"
        "      ]\n"
        "    },\n"
        "    {\n"
        '      "title": "<UPPERCASE KEY-VALUE SECTION, e.g. TECHNICAL SKILLS, CERTIFICATIONS>",\n'
        '      "is_skills": true,\n'
        '      "items": [{"category": "<Category>", "text": "<Comma-separated items>"}]\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        f"{SHARED_BULLET_GUIDE}\n\n"
        "Guidelines:\n"
        "1. CRITICAL — No Fabricated or Placeholder Sections: Never fabricate employers, degrees, dates, metrics, or skills, and NEVER copy placeholder sections or example text from the schema above when the user has not mentioned them.\n"
        "2. Authoritative Live State: Treat `Current Resume JSON State` above as the authoritative, live source of truth—the user may have edited fields manually in the editor since earlier messages in the chat.\n"
        "3. Strict Authorization & Scope: ONLY add, update, or remove sections, entries, bullets, skills, or contact fields that the user directly asked or authorized in their latest request. Do NOT proactively add unrequested sections (such as a Professional Summary) or unrequested edits.\n"
        "4. Verbatim Preservation: Copy every untouched section, item, bullet, prose text, newline, and field VERBATIM character-for-character from `Current Resume JSON State` into `updated_resume`. NEVER rephrase, 'polish', overwrite, or revert manual edits back to wording from earlier chat turns.\n"
        "5. Proposal-First Approval: Whenever you propose resume edits, ALWAYS describe in `reply` (and list in `changes_summary`) the exact items/sections you plan to add, edit, or remove, and explicitly ask whether the user authorizes applying those changes or wants revisions first—the UI holds `updated_resume` as a preview proposal until the user clicks Apply.\n"
        "6. Authorized Updates Style: For newly proposed bullets the user authorized, follow the Universal Bullet Point Writing Standards above (strong upgraded verbs, <= 175 chars, target 85-125 chars).\n"
        "7. Summary / Profile Sections: For summary, profile, or objective sections (e.g., 'PROFESSIONAL SUMMARY'), set `is_skills: false`, leave `role`, `company`, `location`, `date`, and subtitles as empty strings `\"\"`, and place the prose text in `details`: `[{\"is_bullet\": false, \"text\": \"...\"}]`. Do NOT place raw strings directly into `items`.\n"
        "8. Key-Value Sections: Use `is_skills: true` ONLY for two-column key-value sections (`category` + `text`), and `is_skills: false` for all other sections.\n"
        "9. Formatting: Always uppercase section `title` strings, and omit leading bullet symbols ('•', '-', '*') inside `details[].text`.\n"
        "10. Coaching: If user descriptions for a requested change lack numbers or measurable outcomes, still draft clean initial bullets from known facts AND "
        "ask 2 to 3 focused questions in `reply` (asking for real stats/metrics/scale or missing resume sections next).\n"
        "11. Output Format: Respond strictly with a JSON object matching:\n"
        "{\n"
        '  "reply": "Conversational response clearly stating every addition/change you are proposing and asking if the user wants to apply them or make any edits first.",\n'
        '  "changes_summary": ["Short bullet describing each proposed addition, edit, or removal, or empty array [] if none"],\n'
        '  "updated_resume": <full proposed resume object matching the schema above, or null if no authorized changes were requested>\n'
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


class _UnsupportedTemperatureError(ValueError):
    """Raised when an AI provider returns HTTP 400 rejecting the temperature parameter."""


def _is_temperature_unsupported_error(status_code: int, err_json: dict | None, err_msg: str) -> bool:
    """Strictly detect HTTP 400 provider errors rejecting the temperature parameter."""
    if status_code != 400:
        return False
    if isinstance(err_json, dict) and isinstance(err_json.get("error"), dict):
        err_obj = err_json["error"]
        param = err_obj.get("param")
        code = str(err_obj.get("code") or "").lower()
        if param is not None and str(param).strip() != "":
            if str(param).strip().lower() != "temperature":
                return False
            return code in ("unsupported_value", "unsupported_parameter", "")
    msg_lower = (err_msg or "").lower()
    return bool(
        re.search(
            r"(unsupported (value|parameter)|not supported|does not support)[^.\n]{0,25}\btemperature\b"
            r"|\btemperature\b[^.\n]{0,30}(is not supported|not supported|does not support|unsupported|only the default)",
            msg_lower,
        )
    )


def _get_model_temperature_support(provider_name: str, model: str) -> bool | None:
    """Return cached temperature support for provider:model, or None if not yet probed."""
    with _settings_lock:
        caps = load_settings().get("model_capabilities") or {}
    entry = caps.get(f"{provider_name}:{model}")
    if isinstance(entry, dict) and isinstance(entry.get("supports_temperature"), bool):
        return entry["supports_temperature"]
    if provider_name == "OpenAI" and model.startswith(("o1", "o3", "o4")):
        return False
    return None


def _save_model_temperature_support(provider_name: str, model: str, supports_temperature: bool) -> None:
    """Persist whether a model accepts custom temperature so future requests skip probing."""
    with _settings_lock:
        settings = load_settings()
        caps = settings.setdefault("model_capabilities", {})
        caps[f"{provider_name}:{model}"] = {"supports_temperature": supports_temperature}
        save_settings(settings)


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
        err_json = None
        try:
            err_json = json.loads(err_text)
            err_msg = (
                (err_json.get("error") or {}).get("message")
                if isinstance(err_json.get("error"), dict)
                else err_json.get("message")
            ) or err_text
        except Exception:
            err_msg = err_text
        if _is_temperature_unsupported_error(e.code, err_json, err_msg):
            raise _UnsupportedTemperatureError(f"{provider_name} API error ({e.code}): {err_msg}")
        if e.code in (401, 403):
            raise ValueError(f"Invalid or unauthorized {provider_name} API key. Please check Settings.")
        if e.code == 429:
            raise ValueError(f"{provider_name} rate limit or quota exceeded: {err_msg}")
        raise ValueError(f"{provider_name} API error ({e.code}): {err_msg}")
    except urllib.error.URLError as e:
        raise ValueError(f"Network error contacting {provider_name}: {e.reason}")


def _post_with_temperature_fallback(
    url: str,
    headers: dict,
    body: dict,
    provider_name: str,
    model: str,
    temp_container_key: str | None = None,
) -> dict:
    """Send request with temperature=0.4 when supported; retry without temperature and cache on HTTP 400."""
    target = body[temp_container_key] if temp_container_key else body
    known_support = _get_model_temperature_support(provider_name, model)
    if known_support is False:
        target.pop("temperature", None)
        return _post_json_api(url, headers, body, provider_name)

    target["temperature"] = 0.4
    try:
        raw = _post_json_api(url, headers, body, provider_name)
    except _UnsupportedTemperatureError:
        target.pop("temperature", None)
        raw = _post_json_api(url, headers, body, provider_name)
        _save_model_temperature_support(provider_name, model, False)
        return raw

    if known_support is None:
        _save_model_temperature_support(provider_name, model, True)
    return raw


def call_openai_chat(api_key: str, model: str, system_prompt: str, messages: list) -> dict:
    """Call OpenAI Chat Completions API with JSON response_format."""
    target_model = model or "gpt-4o-mini"
    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = msg.get("role")
        content = (msg.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            api_messages.append({"role": role, "content": content})

    body: dict = {
        "model": target_model,
        "messages": api_messages,
        "response_format": {"type": "json_object"},
    }
    raw = _post_with_temperature_fallback(
        "https://api.openai.com/v1/chat/completions",
        {"Authorization": f"Bearer {api_key}"},
        body,
        "OpenAI",
        target_model,
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
            "responseMimeType": "application/json",
        },
    }
    encoded_model = urllib.parse.quote(target_model, safe="-.")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{encoded_model}:generateContent"
    raw = _post_with_temperature_fallback(
        url,
        {"x-goog-api-key": api_key},
        body,
        "Gemini",
        target_model,
        temp_container_key="generationConfig",
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
        "system": system_prompt + "\n\nRespond with a valid JSON object only (no markdown code fences).",
        "messages": api_messages,
    }
    raw = _post_with_temperature_fallback(
        "https://api.anthropic.com/v1/messages",
        {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        body,
        "Claude",
        target_model,
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
