# The Free Resume Builder

A local-first resume builder with a live web workspace, optional multi-provider AI drafting, automatic SQLite saving with version history, and pixel-consistent `.docx`, `.pdf`, and `.json` exports powered by `Base_Template.docx`.

## Table of Contents

- [Deploy with Docker Compose (Recommended)](#deploy-with-docker-compose-recommended)
  - [How Data Persistence Works](#how-data-persistence-works)
  - [Updating or Backing Up](#updating-or-backing-up)
  - [Using a Host Folder Instead of a Named Volume](#using-a-host-folder-instead-of-a-named-volume)
- [Deploy with Plain Docker](#deploy-with-plain-docker)
- [Run Locally with Python](#run-locally-with-python)
- [How to Use the Web App](#how-to-use-the-web-app)
  - [1. Resume Directory (Homepage)](#1-resume-directory-homepage)
  - [2. Creating a Resume (Manual vs. AI Builder)](#2-creating-a-resume-manual-vs-ai-builder)
  - [3. Editing in the Manual Wizard (Steps 1–4)](#3-editing-in-the-manual-wizard-steps-14)
  - [4. Using the AI Builder & Bullet Writing Assistant](#4-using-the-ai-builder--bullet-writing-assistant)
  - [5. Auto-Save & Version History](#5-auto-save--version-history)
  - [6. Previewing & Exporting (DOCX, PDF, JSON)](#6-previewing--exporting-docx-pdf-json)
- [Using the Interactive CLI](#using-the-interactive-cli)
- [Configuration Reference](#configuration-reference)

---

## Deploy with Docker Compose (Recommended)

Docker runs the web app with Gunicorn and includes LibreOffice Writer so native PDF previews and PDF exports work out of the box on any host OS.

1. **Clone the repository and enter it:**
   ```bash
   git clone https://github.com/RangerVinven/The-Free-Resume-Builder.git
   cd Resume-Builder
   ```

2. **Build and start the container in the background:**
   ```bash
   docker compose up -d --build
   ```

3. **Open the app in your browser:**
   Navigate to `http://localhost:5050`.

### How Data Persistence Works

All user data lives inside `/app/data` in the container, mounted to the named Docker volume `resume_builder_data`:

- `/app/data/resumes.db` — All resumes and saved version history snapshots (SQLite).
- `/app/data/settings.json` — Your chosen AI provider, model, and API keys.

Stopping or rebuilding the container (`docker compose down` followed by `docker compose up -d --build`) keeps all your resumes and settings intact. Only running `docker compose down -v` will delete the persistent volume.

### Updating or Backing Up

- **Update to the latest code:**
  ```bash
  git pull
  docker compose up -d --build
  ```
- **Back up your database and settings from the Docker volume:**
  ```bash
  docker run --rm -v resume_builder_data:/data -v "$PWD":/backup alpine \
    tar czf /backup/resume-builder-backup.tar.gz -C /data .
  ```
- **Stop the app without losing data:**
  ```bash
  docker compose down
  ```

### Using a Host Folder Instead of a Named Volume

If you prefer to see `resumes.db` and `settings.json` directly in a local `./data` folder on your machine, edit `docker-compose.yml` to replace `resume_data:/app/data` with `./data:/app/data`:

```yaml
    volumes:
      - ./data:/app/data
```

---

## Deploy with Plain Docker

If you prefer `docker build` and `docker run` without Compose:

```bash
docker build -t resume-builder .
docker run -d \
  --name resume-builder \
  -p 5050:5050 \
  -v resume_builder_data:/app/data \
  --restart unless-stopped \
  resume-builder
```

Then open `http://localhost:5050`.

---

## Run Locally with Python

### Prerequisites
- Python 3.10+ (tested with Python 3.13)
- For PDF preview/export locally:
  - **macOS:** Microsoft Word installed, **or** LibreOffice (`soffice` in `PATH`)
  - **Linux:** LibreOffice Writer (`libreoffice-writer`) installed

### Setup & Launch

1. **Create and activate a virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
   *(On Windows PowerShell: `.\venv\Scripts\Activate.ps1`)*

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Start the web server:**
   ```bash
   python web_app.py
   ```
   Open `http://127.0.0.1:5050` in your browser. Data is stored locally in `resumes.db` and `settings.json` in the project directory.

---

## How to Use the Web App

### 1. Resume Directory (Homepage)

The homepage lists every resume saved in your SQLite database:

- **Search:** Filter resumes live by candidate name, email, or phone number.
- **Edit:** Opens the resume directly in the split-screen workspace.
- **Duplicate:** Creates an independent copy with its own version history.
- **DOCX / PDF:** Downloads a formatted Word or PDF document immediately using `Base_Template.docx`.
- **Delete:** Permanently deletes a resume (requires typing the candidate's full name to confirm).
- **Import JSON:** Imports a previously exported `.json` resume file into your SQLite database.

### 2. Creating a Resume (Manual vs. AI Builder)

Click **+ New Resume** and choose how you want to start:

- **Guided Manual Wizard:** Step-by-step forms for contact info, sections, and structured entries.
- **Build with AI Assistant:** Chat in plain language while the AI populates your live resume preview in real time.

You can switch freely between **Manual Wizard** and **AI Builder** at any time using the tabs at the top of the editor pane. Any edits made in one mode sync immediately to the other.

### 3. Editing in the Manual Wizard (Steps 1–4)

You can click any step (`1`–`4`) at the top at any time:

1. **Contact Info:** Full Name (required to save), phone, email, portfolio URL, and LinkedIn.
2. **Sections:** Add standard sections (`EDUCATION`, `EXPERIENCE`, `PROJECTS`, `LEADERSHIP`) or key-value sections (`TECHNICAL SKILLS`), rename them, switch formats, or reorder them up/down.
3. **Content:** Add entries (role/school, company, location, date, subtitle) and attach **Bullet Points** or **Prose** lines—or structured **Category / Items** rows for skills sections.
4. **Review & Export:** Run preflight checks, view version history, preview native PDF, or download `.docx`, `.pdf`, or `.json`.

### 4. Using the AI Builder & Bullet Writing Assistant

AI features are optional and use your own API keys stored locally in `settings.json`:

1. Click **Settings** in the top navigation bar.
2. Pick your **Active AI Provider** (**OpenAI**, **Gemini**, or **Claude**) and choose or type a **Model** (e.g. `gpt-4o-mini`, `gemini-2.5-flash`, `claude-sonnet-4-5`).
3. Paste your API key and click **Save Settings**.

Two AI workflows are available:

- **Full-Resume AI Builder:** Switch to the **AI Builder** tab to draft, review, or reorganize your entire resume conversationally. An **Undo Last AI Edit** button lets you revert any AI change in one click.
- **Per-Bullet Writing Assistant:** In Manual Wizard Step 3, click the **AI** button on any bullet or prose field to open the Writing Assistant drawer. Choose **Replace Bullet**, **Add Below**, or **Copy** on any suggested variation.

### 5. Auto-Save & Version History

- Changes auto-save shortly after you stop typing once a resume has a Full Name.
- Periodic auto-save checkpoints (~3 minutes) record snapshots in SQLite.
- Pressing **Save** (or `Cmd+S` / `Ctrl+S`) creates an explicit named snapshot right away.
- Click **History** in the top bar (or open Version History in Step 4) to inspect and **Restore** any earlier snapshot without losing safety (restoring also records a snapshot of your prior state).

### 6. Previewing & Exporting (DOCX, PDF, JSON)

- The right pane shows a **Live HTML** preview as you type. Switch to **Native PDF** at any time to inspect the exact paginated output generated through `Base_Template.docx`.
- Use the top toolbar or Step 4 buttons to download:
  - **DOCX** — Editable Word file styled with `Base_Template.docx`.
  - **PDF** — Print-ready PDF converted from the generated `.docx`.
  - **JSON** — Portable JSON backup of the resume that can be re-imported later via **Import JSON**.

---

## Using the Interactive CLI

Both the web app and the CLI share the same SQLite database (`resumes.db`) and `settings.json`:

```bash
python resume_builder.py
```

From the terminal menu you can:

- Create or edit resumes step by step
- Export formatted `.docx` and `.pdf` files
- Restore previous versions from version history
- Configure AI providers (`OpenAI`, `Gemini`, `Claude`) and API keys

---

## Configuration Reference

Environment variables (all optional; defaults apply automatically outside Docker):

| Variable | Default (Local) | Default (Docker) | Purpose |
| --- | --- | --- | --- |
| `DATA_DIR` | `.` | `/app/data` | Base directory where `resumes.db` and `settings.json` are stored |
| `DB_PATH` | `<DATA_DIR>/resumes.db` | `/app/data/resumes.db` | Override exact path to the SQLite database file |
| `SETTINGS_PATH` | `<DATA_DIR>/settings.json` | `/app/data/settings.json` | Override exact path to provider/API key settings |
| `LEGACY_RESUMES_DIR` | `./resumes` | `./resumes` | Directory checked once for migrating legacy `.json` resumes |
| `HOST` | `127.0.0.1` | `0.0.0.0` | Network interface bound when running `python web_app.py` |
| `PORT` | `5050` | `5050` | HTTP port bound when running `python web_app.py` |
