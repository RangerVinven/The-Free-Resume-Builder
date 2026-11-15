import os
import re
import threading
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
    return jsonify({"settings": settings})


@app.route("/api/settings", methods=["PUT"])
def update_settings_api():
    payload = request.get_json(silent=True) or {}
    settings = load_settings()
    api_keys = payload.get("api_keys")
    if isinstance(api_keys, dict):
        cleaned = {k: v.strip() for k, v in api_keys.items() if isinstance(v, str) and v.strip()}
        settings["api_keys"] = cleaned
    save_settings(settings)
    return jsonify({"settings": settings})


if __name__ == "__main__":
    ensure_dirs()
    app.run(host="127.0.0.1", port=5050, debug=False)
