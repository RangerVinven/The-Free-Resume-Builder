# The Free Resume Builder

A CLI tool for generating beautiful, perfectly formatted resumes in DOCX format matching a specific template.

## Features
- **Manage Multiple Resumes:** Create and edit multiple resumes at the same time. Resumes are saved automatically in the `resumes/` folder.
- **Dynamic Sections:** Add sections like `EDUCATION`, `EXPERIENCE`, `PROJECTS` or custom ones.
- **Flexible Styling:** Mix and match bullet points and prose under different job titles and items.
- **Identical Styling:** Uses the provided template to guarantee an output that looks exactly like `Template.docx`.

## Prerequisites
- Python 3.7+
- Recommended: Virtual Environment

## Installation

1. Clone the repository and enter the directory.
2. Install the requirements:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

Run the CLI application:
```bash
python resume_builder.py
```

Follow the interactive prompts to create your resume, add sections, and generate the final `.docx` file!
