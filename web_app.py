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

    data = {
        "name": name,
        "phone": (payload.get("phone") or "").strip(),
        "email": (payload.get("email") or "").strip(),
        "portfolio": (payload.get("portfolio") or "").strip(),
        "linkedin": (payload.get("linkedin") or "").strip(),
        "sections": [],
    }
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

    return (
        "You are a precise, practical resume writing coach helping the user craft a single "
        f"{style_label} for their resume.\n\n"
        f"Resume Entry Context:\n{ctx_block}\n\n"
        "Guidelines:\n"
        "1. Never invent metrics, technologies, responsibilities, or achievements the user has not stated.\n"
        "2. If the user has not yet described what they did—or if adding concrete scope, tools, or outcomes "
        "would make the phrasing much stronger—ask 1 to 3 concise, specific questions.\n"
        "3. When you have enough information (or when the user asks for examples or rewrites), provide 2 to 3 "
        "distinct, crisp options (e.g., 'Impact-Focused', 'Technical', 'Concise').\n"
        "4. Do NOT include leading bullet symbols ('•', '-', '*') in suggestion text. Keep each option clean, "
        "direct, and ready to paste into a resume.\n"
        "5. Avoid generic fluff and exaggerated buzzwords.\n\n"
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
    return {"reply": reply, "suggestions": clean_suggestions}


@app.route("/api/ai/assist", methods=["POST"])
def ai_assist_api():
    payload = request.get_json(silent=True) or {}
    mode = payload.get("mode", "bullet")
    context = payload.get("context") or {}
    messages = payload.get("messages") or []

    if mode != "bullet":
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

    if not messages:
        messages = [{"role": "user", "content": "Help me draft this resume item. Ask me clarifying questions about what I did if needed."}]

    system_prompt = build_bullet_system_prompt(context)
    try:
        result = call_openai_chat(api_key, model, system_prompt, messages)
        return jsonify({
            "reply": result["reply"],
            "suggestions": result["suggestions"],
            "provider": provider,
            "model": model,
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Assistant error: {str(e)}"}), 500


if __name__ == "__main__":
    ensure_dirs()
    app.run(host="127.0.0.1", port=5050, debug=False)
