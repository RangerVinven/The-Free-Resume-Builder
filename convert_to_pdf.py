import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _convert_with_libreoffice(docx_path: Path, pdf_path: Path) -> Path | None:
    """Convert DOCX to PDF using headless LibreOffice when available."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        print("PDF conversion failed: LibreOffice ('soffice') not found.")
        return None

    with tempfile.TemporaryDirectory() as profile_dir:
        cmd = [
            soffice,
            f"-env:UserInstallation=file://{profile_dir}",
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(docx_path.parent),
            str(docx_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=90)

    if pdf_path.exists():
        print(f"Successfully converted to: {pdf_path.name}")
        return pdf_path

    err = (res.stderr or res.stdout or "Unknown LibreOffice error").strip()
    print(f"LibreOffice PDF conversion failed: {err}")
    return None


def _convert_with_word_mac(docx_path: Path, pdf_path: Path) -> Path | None:
    """Convert DOCX to PDF via Microsoft Word on macOS."""
    container_dir = Path.home() / "Library/Containers/com.microsoft.Word/Data/tmp"
    container_dir.mkdir(parents=True, exist_ok=True)

    stem = docx_path.stem
    tmp_docx = container_dir / f"{stem}.docx"
    tmp_pdf = container_dir / f"{stem}.pdf"

    shutil.copyfile(docx_path, tmp_docx)
    if tmp_pdf.exists():
        tmp_pdf.unlink()

    script = f'''
    tell application "Microsoft Word"
        set doc to open file name "{tmp_docx}"
        save as doc file name "{tmp_pdf}" file format format PDF
        close doc saving no
    end tell
    '''

    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if tmp_pdf.exists():
        shutil.copyfile(tmp_pdf, pdf_path)
        tmp_pdf.unlink()
        if tmp_docx.exists():
            tmp_docx.unlink()
        print(f"Successfully converted to: {pdf_path.name}")
        return pdf_path

    if tmp_docx.exists():
        tmp_docx.unlink()
    print(f"Conversion failed: {res.stderr}")
    return None


def convert_docx_to_pdf(docx_path):
    docx_path = Path(docx_path).resolve()
    if not docx_path.exists():
        print(f"Error: {docx_path} does not exist.")
        return None

    pdf_path = docx_path.with_suffix(".pdf")

    if sys.platform == "darwin":
        converted = _convert_with_word_mac(docx_path, pdf_path)
        if converted:
            return converted
        if shutil.which("soffice") or shutil.which("libreoffice"):
            return _convert_with_libreoffice(docx_path, pdf_path)
        return None

    return _convert_with_libreoffice(docx_path, pdf_path)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            convert_docx_to_pdf(arg)
    else:
        # Convert all generated docx files in current directory by default
        docx_files = list(Path(".").glob("*generated*.docx"))
        if not docx_files:
            print("No generated .docx files found to convert.")
        for f in docx_files:
            convert_docx_to_pdf(f)

    # Quit Word quietly if done on macOS
    if sys.platform == "darwin":
        subprocess.run(["osascript", "-e", 'tell application "Microsoft Word" to quit'], capture_output=True)
