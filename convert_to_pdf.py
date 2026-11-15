import os
import sys
import shutil
import subprocess
from pathlib import Path

def convert_docx_to_pdf(docx_path):
    docx_path = Path(docx_path).resolve()
    if not docx_path.exists():
        print(f"Error: {docx_path} does not exist.")
        return None

    pdf_path = docx_path.with_suffix(".pdf")
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
    else:
        print(f"Conversion failed: {res.stderr}")
        return None

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

    # Quit Word quietly if done
    subprocess.run(["osascript", "-e", 'tell application "Microsoft Word" to quit'], capture_output=True)
