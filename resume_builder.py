from copy import deepcopy
import json
import os
import re
import sys
from pathlib import Path
import questionary
from rich.console import Console
from docxtpl import DocxTemplate
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from db import (
    create_resume_db,
    delete_resume_db,
    get_resume_db,
    init_db,
    list_resumes_db,
    make_slug,
    normalize_formatting_settings,
    normalize_resume_schema,
    revert_version_db,
    update_resume_db,
)
from convert_to_pdf import convert_docx_to_pdf

console = Console()
TEMPLATE_PATH = Path('Base_Template.docx')
_DATA_DIR = Path(os.environ['DATA_DIR']) if os.environ.get('DATA_DIR') else Path('.')
SETTINGS_PATH = Path(os.environ['SETTINGS_PATH']) if os.environ.get('SETTINGS_PATH') else _DATA_DIR / 'settings.json'

_STAT_PATTERN = re.compile(
    r'(?<![A-Za-z0-9_\\/\x00-])'
    r'(?:'
        r'[$£€]\d+(?:[.,]\d+)*(?:[KkMmBbTt]\b|\+)?'
        r'|'
        r'\d+(?:[.,]\d+)*%'
        r'|'
        r'\d+(?:[.,]\d+)*[xX]\b'
        r'|'
        r'\d+(?:[.,]\d+)*(?:ms|us|ns|s|KB|MB|GB|TB|PB|Mbps|Gbps|rps|qps|fps)\b\+?'
        r'|'
        r'\d+(?:[.,]\d+)*(?:[KkMmBb]\+?(?![A-Za-z0-9])|\+)'
        r'|'
        r'\d{1,3}(?:,\d{3})+(?:\+)?'
        r'|'
        r'\d+(?:[.,]\d+)?(?:-bed|-person|-member|-hour|-day|-week)?(?=\s+(?:[a-z][A-Za-z-]*\s+)?(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|users?|clients?|customers?|accounts?|patients?|students?|engineers?|developers?|nurses?|staff|baristas?|teams?|apps?|applications?|services?|microservices?|endpoints?|servers?|containers?|orders?|transactions?|requests?|tickets?|records?|CVEs?|bugs?|vulnerabilities|issues?|percent|times|shifts?|beds?)\b)'
        r'|'
        r'\d+(?:[.,]\d+)?(?:-(?:bed|person|member|hour|day|week))\b'
    r')'
)
_BOLD_MD_PATTERN = re.compile(r'\*\*(.+?)\*\*')
_ESCAPED_TOKEN_PATTERN = re.compile(r'\\(\d+(?:[.,]\d+)?[A-Za-z%+-]*|[$£€]\d+(?:[.,]\d+)*[A-Za-z%+-]*|\*|\\)')


def init_app():
    if not TEMPLATE_PATH.exists():
        console.print(f'[red]Error: {TEMPLATE_PATH} not found. Please ensure it is in the same directory.[/red]')
        sys.exit(1)
    init_db()


def load_settings():
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH, 'r') as f:
            return json.load(f)
    return {}


def save_settings(data):
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_PATH, 'w') as f:
        json.dump(data, f, indent=4)


def build_render_context(data: dict) -> dict:
    """Attach per-resume formatting settings to a copy of the resume payload before rendering."""
    fmt = normalize_formatting_settings(data.get("formatting") if isinstance(data, dict) else None)
    skills_gap = fmt["header_gap_overrides"].get("SKILLS", fmt["header_content_gap_pt"])
    return {
        **data,
        "standardize_skills_gap": skills_gap > 0,
    }


def parse_formatted_segments(text: str, auto_bold_stats: bool = False) -> list[tuple[str, bool]]:
    """Split text into (segment, is_bold) runs supporting **markdown**, \\escapes, and auto-bold stats."""
    if not text:
        return []

    placeholders: dict[str, str] = {}

    def _protect(m):
        idx = len(placeholders)
        tag = "".join(chr(65 + int(d)) for d in str(idx))
        key = f"\x00ESC{tag}\x00"
        placeholders[key] = m.group(1)
        return key

    protected = _ESCAPED_TOKEN_PATTERN.sub(_protect, text)

    def _restore(s: str) -> str:
        for k, v in placeholders.items():
            s = s.replace(k, v)
        return s

    md_matches = list(_BOLD_MD_PATTERN.finditer(protected))
    if md_matches:
        segs: list[tuple[str, bool]] = []
        pos = 0
        for m in md_matches:
            if m.start() > pos:
                segs.append((_restore(protected[pos:m.start()]), False))
            segs.append((_restore(m.group(1)), True))
            pos = m.end()
        if pos < len(protected):
            segs.append((_restore(protected[pos:]), False))
        return [(t, b) for t, b in segs if t]

    if not auto_bold_stats:
        return [(_restore(protected), False)]

    segs = []
    pos = 0
    for m in _STAT_PATTERN.finditer(protected):
        if m.start() > pos:
            segs.append((_restore(protected[pos:m.start()]), False))
        segs.append((_restore(m.group(0)), True))
        pos = m.end()
    if pos < len(protected):
        segs.append((_restore(protected[pos:]), False))
    return [(t, b) for t, b in segs if t]


def _set_paragraph_spacing(p, before_pt: float | None = None, after_pt: float | None = None) -> None:
    pPr = p._p.get_or_add_pPr()
    spacing = pPr.find(qn("w:spacing"))
    if spacing is None:
        spacing = OxmlElement("w:spacing")
        pPr.append(spacing)
    if before_pt is not None:
        spacing.set(qn("w:before"), str(max(0, round(before_pt * 20))))
    if after_pt is not None:
        spacing.set(qn("w:after"), str(max(0, round(after_pt * 20))))


def _apply_formatted_runs_to_paragraph(p, text: str, auto_bold_stats: bool) -> None:
    segments = parse_formatted_segments(text, auto_bold_stats=auto_bold_stats)
    if not segments:
        return
    # Skip XML rewrite when plain unbolded text matches existing single run
    if len(segments) == 1 and not segments[0][1] and segments[0][0] == text:
        return

    existing_runs = list(p._p.findall(qn("w:r")))
    template_rPr = existing_runs[0].find(qn("w:rPr")) if existing_runs else None
    for r in existing_runs:
        p._p.remove(r)

    for seg_text, is_bold in segments:
        if not seg_text:
            continue
        r_el = OxmlElement("w:r")
        rPr = deepcopy(template_rPr) if template_rPr is not None else OxmlElement("w:rPr")
        if is_bold:
            if rPr.find(qn("w:b")) is None:
                rPr.append(OxmlElement("w:b"))
            if rPr.find(qn("w:bCs")) is None:
                rPr.append(OxmlElement("w:bCs"))
        r_el.append(rPr)
        lines = seg_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        for line_idx, line_text in enumerate(lines):
            if line_idx > 0:
                r_el.append(OxmlElement("w:br"))
            t_el = OxmlElement("w:t")
            if line_text.startswith(" ") or line_text.endswith(" ") or "  " in line_text:
                t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            t_el.text = line_text
            r_el.append(t_el)
        p._p.append(r_el)


def _postprocess_rendered_docx(docx_doc, normalized_data: dict, fmt: dict) -> None:
    """Apply standardized/custom gaps and inline bold formatting across rendered paragraphs."""
    paragraphs = docx_doc.paragraphs
    idx = 0
    while idx < len(paragraphs):
        pPr = paragraphs[idx]._p.pPr
        if pPr is not None and pPr.find(qn("w:pBdr")) is not None:
            break
        idx += 1

    sections = normalized_data.get("sections") or []
    for sec_idx, sec in enumerate(sections):
        if idx >= len(paragraphs):
            break
        heading_p = paragraphs[idx]
        idx += 1
        _set_paragraph_spacing(
            heading_p,
            before_pt=(2.0 if sec_idx == 0 else fmt["section_gap_pt"]),
            after_pt=0.0,
        )

        sec_title = (sec.get("title") or "").strip().upper()
        header_gap_pt = fmt["header_gap_overrides"].get(sec_title, fmt["header_content_gap_pt"])

        if sec.get("is_skills"):
            for skill_idx, _skill in enumerate(sec.get("items") or []):
                if idx >= len(paragraphs):
                    break
                skill_p = paragraphs[idx]
                idx += 1
                _set_paragraph_spacing(
                    skill_p,
                    before_pt=(header_gap_pt if skill_idx == 0 else 0.0),
                    after_pt=0.0,
                )
        else:
            for item_idx, item in enumerate(sec.get("items") or []):
                item_gap_pt = header_gap_pt if item_idx == 0 else fmt["entry_gap_pt"]
                applied_item_gap = False

                has_header = any((item.get(k) or "").strip() for k in ("role", "company", "location", "date"))
                if has_header and idx < len(paragraphs):
                    hdr_p = paragraphs[idx]
                    idx += 1
                    _set_paragraph_spacing(hdr_p, before_pt=item_gap_pt, after_pt=0.0)
                    applied_item_gap = True

                has_sub = any((item.get(k) or "").strip() for k in ("subtitle", "subtitle_right"))
                if has_sub and idx < len(paragraphs):
                    sub_p = paragraphs[idx]
                    idx += 1
                    _set_paragraph_spacing(sub_p, before_pt=(0.0 if applied_item_gap else item_gap_pt), after_pt=0.0)
                    applied_item_gap = True

                for detail in item.get("details") or []:
                    if idx >= len(paragraphs):
                        break
                    det_p = paragraphs[idx]
                    idx += 1
                    det_before = 0.0 if applied_item_gap else item_gap_pt
                    applied_item_gap = True
                    _set_paragraph_spacing(det_p, before_pt=det_before, after_pt=0.0)
                    _apply_formatted_runs_to_paragraph(
                        det_p,
                        detail.get("text") or "",
                        auto_bold_stats=fmt["auto_bold_stats"],
                    )


def render_resume_docx(data: dict, out_path: Path) -> Path:
    """Render a resume dictionary into Base_Template.docx with per-resume formatting applied."""
    normalized = normalize_resume_schema(data)
    fmt = normalized["formatting"]
    doc = DocxTemplate(TEMPLATE_PATH)
    doc.render(build_render_context(normalized), autoescape=True)
    _postprocess_rendered_docx(doc.docx, normalized, fmt)
    doc.save(out_path)
    return out_path


def confirm_deletion(item_name):
    if questionary.confirm(f"Are you sure you want to delete {item_name}?").ask():
        if questionary.confirm("ARE YOU SURE?").ask():
            return True
    return False


def show_help():
    console.print("\n[bold cyan]--- Formatting Example ---[/bold cyan]")
    console.print("When you create an item in a section, this is how it will look on the final generated document:")
    console.print("")
    console.print("[bold green][Role/Title][/bold green][green], [Company/School][/green][bold green] – [Location][/bold green]                  [yellow]([Date])[/yellow]")
    console.print("[italic][Item Subtitle (e.g. Degree, GPA, etc.)][/italic]")
    console.print("  • [Detail style: Bullet Point]")
    console.print("  [Detail style: Prose]")
    console.print("")
    console.print("Note: If you leave any of the optional fields blank, they will automatically format cleanly to fit the remaining information!")
    console.print("")
    questionary.press_any_key_to_continue().ask()

def options_menu():
    settings = load_settings()
    provider_defaults = {
        'OpenAI': 'gpt-4o-mini',
        'Gemini': 'gemini-2.5-flash',
        'Claude': 'claude-sonnet-4-5',
    }
    while True:
        choice = questionary.select(
            'Options:',
            choices=['Set Active Provider & Model', 'Set API Keys', 'Back to Main Menu'],
            use_shortcuts=True,
        ).ask()
        if choice == 'Set Active Provider & Model':
            provider = questionary.select('Active AI Provider:', choices=['OpenAI', 'Gemini', 'Claude', 'Back'], use_shortcuts=True).ask()
            if provider and provider != 'Back':
                current_model = settings.get('ai', {}).get('model') or provider_defaults[provider]
                model = questionary.text('Model:', default=current_model).ask() or provider_defaults[provider]
                settings['ai'] = {'provider': provider, 'model': model.strip()}
                save_settings(settings)
                console.print(f'[green]Active provider set to {provider} ({model.strip()})![/green]')
        elif choice == 'Set API Keys':
            provider = questionary.select('Select Provider:', choices=['OpenAI', 'Gemini', 'Claude', 'Other', 'Back'], use_shortcuts=True).ask()
            if provider and provider != 'Back':
                key = questionary.password(f'Enter {provider} API Key:').ask()
                if key:
                    settings.setdefault('api_keys', {})[provider] = key.strip()
                    save_settings(settings)
                    console.print(f'[green]Saved API key for {provider}![/green]')
        else:
            break


def _pick_resume_record(prompt_text):
    resumes = list_resumes_db()
    if not resumes:
        return None, []
    labels = [
        f"{r['name']} ({r['email'] or 'no email'}) [ID {r['id']}]"
        for r in resumes
    ]
    return resumes, labels


def delete_resume():
    resumes, labels = _pick_resume_record('Select a resume to delete:')
    if not resumes:
        console.print("[yellow]No resumes to delete.[/yellow]")
        return
    choice = questionary.select("Select a resume to delete:", choices=labels + ["Back"], use_shortcuts=True).ask()
    if choice == "Back" or not choice:
        return

    target = resumes[labels.index(choice)]
    confirm_text = questionary.text(f"Type '{target['name']}' to confirm deletion:").ask()
    ok, _ = delete_resume_db(target['id'], confirm_text or '')
    if ok:
        console.print(f"[green]Deleted {target['name']}[/green]")
    else:
        console.print("[red]Deletion cancelled.[/red]")


def create_resume():
    name = questionary.text('Full Name:').ask()
    if not name or not name.strip():
        return None
    phone = questionary.text('Phone Number:').ask() or ''
    email = questionary.text('Email:').ask() or ''
    portfolio = questionary.text('Portfolio Website (optional):').ask() or ''
    linkedin = questionary.text('LinkedIn (optional):').ask() or ''
    created = create_resume_db({
        'name': name.strip(),
        'phone': phone.strip(),
        'email': email.strip(),
        'portfolio': portfolio.strip(),
        'linkedin': linkedin.strip(),
        'sections': [],
    })
    console.print(f"[green]Created new resume: {created['data']['name']} (ID {created['id']})[/green]")
    return created['id']


def select_resume():
    resumes, labels = _pick_resume_record('Select a resume:')
    if not resumes:
        console.print('[yellow]No resumes found. Please create one first.[/yellow]')
        return create_resume()
    choices = labels + ['Create New Resume', 'Back']
    choice = questionary.select('Select a resume:', choices=choices, use_shortcuts=True).ask()
    if choice == 'Create New Resume':
        return create_resume()
    if choice == 'Back' or not choice:
        return None
    return resumes[labels.index(choice)]['id']

def edit_contact_info(data):
    data['name'] = questionary.text('Full Name:', default=data.get('name', '')).ask() or data.get('name')
    data['phone'] = questionary.text('Phone Number:', default=data.get('phone', '')).ask() or data.get('phone')
    data['email'] = questionary.text('Email:', default=data.get('email', '')).ask() or data.get('email')
    data['portfolio'] = questionary.text('Portfolio Website (optional):', default=data.get('portfolio', '')).ask() or data.get('portfolio')
    data['linkedin'] = questionary.text('LinkedIn (optional):', default=data.get('linkedin', '')).ask() or data.get('linkedin')
    return data

def manage_sections(data):
    while True:
        choices = [f"Edit: {s['title']}" for s in data.get('sections', [])]
        if len(data.get('sections', [])) > 1:
            choices.append('Re-order Sections')
        choices.extend(['Add New Section', 'Back'])
        
        choice = questionary.select('Manage Sections & Items:', choices=choices, use_shortcuts=True).ask()
        
        if choice == 'Back' or not choice:
            break
        elif choice == 'Re-order Sections':
            while True:
                sec_list = [s['title'] for s in data['sections']] + ['Done']
                to_move = questionary.select('Select section to move:', choices=sec_list, use_shortcuts=True).ask()
                if to_move == 'Done' or not to_move:
                    break
                
                idx = sec_list.index(to_move)
                pos_choices = [str(i + 1) for i in range(len(data['sections']))]
                new_pos_str = questionary.select(f"Move '{to_move}' to position:", choices=pos_choices, use_shortcuts=True).ask()
                if new_pos_str:
                    new_pos = int(new_pos_str) - 1
                    section_to_move = data['sections'].pop(idx)
                    data['sections'].insert(new_pos, section_to_move)
                    console.print(f"[green]Moved {to_move} to position {new_pos + 1}[/green]")
        elif choice == 'Add New Section':
            title = questionary.text('Section Title (e.g. EDUCATION, EXPERIENCE, SKILLS):').ask()
            if title:
                is_skills = questionary.confirm("Is this a Skills section (Key-Value format)?").ask()
                data.setdefault('sections', []).append({'title': title.upper(), 'is_skills': is_skills, 'items': []})
                console.print(f"[green]Added section: {title.upper()}[/green]")
        else:
            idx = choices.index(choice)
            section = data['sections'][idx]
            
            while True:
                sec_choices = [
                    "Rename Section",
                    "Delete Section",
                    "Add New Item",
                ]
                if section.get('items'):
                    sec_choices.append("Edit Items")
                    if len(section.get('items')) > 1:
                        sec_choices.append("Re-order Items")
                sec_choices.append("Back")
                
                sec_choice = questionary.select(f"Section [{section['title']}]:", choices=sec_choices, use_shortcuts=True).ask()
                
                if sec_choice == "Back" or not sec_choice:
                    break
                elif sec_choice == "Re-order Items":
                    while True:
                        if section.get('is_skills'):
                            item_labels = [f"{i.get('category', 'Untitled')}" for i in section.get('items', [])]
                        else:
                            item_labels = [f"{i.get('role', i.get('company', 'Untitled'))} - {i.get('date', '')}" for i in section.get('items', [])]
                        
                        item_list = item_labels + ['Done']
                        to_move = questionary.select('Select item to move:', choices=item_list, use_shortcuts=True).ask()
                        if to_move == 'Done' or not to_move:
                            break
                        
                        item_idx = item_list.index(to_move)
                        pos_choices = [str(i + 1) for i in range(len(section['items']))]
                        new_pos_str = questionary.select(f"Move item to position:", choices=pos_choices, use_shortcuts=True).ask()
                        if new_pos_str:
                            new_pos = int(new_pos_str) - 1
                            item_to_move = section['items'].pop(item_idx)
                            section['items'].insert(new_pos, item_to_move)
                            console.print(f"[green]Moved item to position {new_pos + 1}[/green]")
                elif sec_choice == "Rename Section":
                    new_title = questionary.text("New Title:", default=section['title']).ask()
                    if new_title:
                        section['title'] = new_title.upper()
                        console.print(f"[green]Renamed to {section['title']}[/green]")
                elif sec_choice == "Delete Section":
                    if confirm_deletion(f"section '{section['title']}'"):
                        data['sections'].pop(idx)
                        console.print("[green]Deleted section[/green]")
                        break
                elif sec_choice == "Add New Item":
                    if section.get('is_skills'):
                        category = questionary.text("Category (e.g. Design, Analysis & Control):").ask()
                        text = questionary.text("Skills (comma-separated):").ask()
                        item = {"category": category, "text": text}
                        section.setdefault('items', []).append(item)
                        console.print(f"[green]Added skill category[/green]")
                    else:
                        role = questionary.text("Role/Title [Optional]:").ask()
                        company = questionary.text("Company/School [Optional]:").ask()
                        location = questionary.text("Location [Optional]:").ask()
                        date = questionary.text("Date (e.g. May 2024 - August 2024) [Optional]:").ask()
                        subtitle = questionary.text("Item Subtitle Left (e.g. Degree) [Optional]:").ask()
                        subtitle_right = questionary.text("Item Subtitle Right (e.g. GPA) [Optional]:").ask()
                        item = {"role": role, "company": company, "location": location, "date": date, "subtitle": subtitle, "subtitle_right": subtitle_right, "details": []}
                        while True:
                            if not questionary.confirm("Add a detail (bullet point or prose)?").ask():
                                break
                            detail_type = questionary.select("Detail Style:", choices=["Bullet Point", "Prose"], use_shortcuts=True).ask()
                            text = questionary.text("Enter text:").ask()
                            item['details'].append({"is_bullet": detail_type == "Bullet Point", "text": text})
                        section.setdefault('items', []).append(item)
                        console.print(f"[green]Added item[/green]")
                elif sec_choice == "Edit Items":
                    while True:
                        if section.get('is_skills'):
                            item_list = [f"{i.get('category', 'Untitled')}" for i in section.get('items', [])] + ["Back"]
                        else:
                            item_list = [f"{i.get('role', i.get('company', 'Untitled'))} - {i.get('date', '')}" for i in section.get('items', [])] + ["Back"]
                        
                        item_choice = questionary.select("Select Item to Edit:", choices=item_list, use_shortcuts=True).ask()
                        if item_choice == "Back" or not item_choice:
                            break
                        item_idx = item_list.index(item_choice)
                        item = section['items'][item_idx]
                        
                        while True:
                            if section.get('is_skills'):
                                action = questionary.select(
                                    f"Action for {item.get('category', 'Untitled')}:",
                                    choices=["Edit Skill Header", "Delete Item", "Back"],
                                    use_shortcuts=True
                                ).ask()
                            else:
                                action = questionary.select(
                                    f"Action for {item.get('role', item.get('company', 'Untitled'))}:",
                                    choices=["Edit Item Header", "Manage Details", "Delete Item", "Back"],
                                    use_shortcuts=True
                                ).ask()
                            
                            if action == "Back" or not action:
                                break
                            elif action == "Edit Skill Header":
                                item['category'] = questionary.text("Category:", default=item.get('category', '')).ask()
                                item['text'] = questionary.text("Skills:", default=item.get('text', '')).ask()
                            elif action == "Edit Item Header":
                                item['role'] = questionary.text("Role/Title:", default=item.get('role', '')).ask()
                                item['company'] = questionary.text("Company/School:", default=item.get('company', '')).ask()
                                item['location'] = questionary.text("Location:", default=item.get('location', '')).ask()
                                item['date'] = questionary.text("Date:", default=item.get('date', '')).ask()
                                item['subtitle'] = questionary.text("Item Subtitle Left:", default=item.get('subtitle', '')).ask()
                                item['subtitle_right'] = questionary.text("Item Subtitle Right:", default=item.get('subtitle_right', '')).ask()
                            elif action == "Delete Item":
                                if confirm_deletion("item"):
                                    section['items'].pop(item_idx)
                                    console.print("[green]Deleted item[/green]")
                                    break
                            elif action == "Manage Details":
                                while True:
                                    det_choices = [f"[{'Bullet' if d.get('is_bullet') else 'Prose'}] {d.get('text', '')[:30]}..." for d in item.get('details', [])] + ["Add New Detail", "Back"]
                                    d_choice = questionary.select("Select Detail:", choices=det_choices, use_shortcuts=True).ask()
                                    if d_choice == "Back" or not d_choice: break
                                    elif d_choice == "Add New Detail":
                                        detail_type = questionary.select("Detail Style:", choices=["Bullet Point", "Prose"], use_shortcuts=True).ask()
                                        text = questionary.text("Enter text:").ask()
                                        item.setdefault('details', []).append({"is_bullet": detail_type == "Bullet Point", "text": text})
                                    else:
                                        d_idx = det_choices.index(d_choice)
                                        d_act = questionary.select("Action:", choices=["Edit", "Delete", "Back"], use_shortcuts=True).ask()
                                        if d_act == "Edit":
                                            d = item['details'][d_idx]
                                            d_type = questionary.select("Detail Style:", choices=["Bullet Point", "Prose"], default="Bullet Point" if d.get('is_bullet') else "Prose", use_shortcuts=True).ask()
                                            d['is_bullet'] = (d_type == "Bullet Point")
                                            d['text'] = questionary.text("Enter text:", default=d.get('text', '')).ask() or d['text']
                                        elif d_act == "Delete":
                                            if confirm_deletion("detail"):
                                                item['details'].pop(d_idx)
                        # Re-break if the item was deleted so we refresh the item list
                        if item not in section['items']:
                            break
    return data

def preview_resume_terminal(data):
    console.print(f"\n[bold white on black] {data.get('name', 'Name').upper()} [/bold white on black]")
    contact = f"{data.get('phone', '')} | {data.get('email', '')}"
    if data.get('portfolio'):
        contact += f" | {data.get('portfolio')}"
    if data.get('linkedin'):
        contact += f" | {data.get('linkedin')}"
    console.print(f'[cyan]{contact}[/cyan]\n')
    for section in data.get('sections', []):
        console.print(f"[bold magenta]{section.get('title', '')}[/bold magenta]")
        console.print('[magenta]' + '-' * 40 + '[/magenta]')
        if section.get('is_skills'):
            for skill in section.get('items', []):
                console.print(f"[bold green]{skill.get('category')}:[/bold green] {skill.get('text')}")
            console.print('')
        else:
            for item in section.get('items', []):
                header_parts = []
                if item.get('role'):
                    header_parts.append(f"[bold green]{item.get('role')}[/bold green]")
                if item.get('company'):
                    header_parts.append(f"[green]{(', ' if item.get('role') else '')}{item.get('company')}[/green]")
                if item.get('location'):
                    header_parts.append(f"[bold green] – {item.get('location')}[/bold green]")
                header = ''.join(header_parts)
                if item.get('date'):
                    header += f"  [yellow]({item.get('date')})[/yellow]"
                console.print(header)
                if item.get('subtitle') or item.get('subtitle_right'):
                    sub_left = item.get('subtitle', '')
                    sub_right = item.get('subtitle_right', '')
                    if sub_left and sub_right:
                        console.print(f"[italic]{sub_left} | {sub_right}[/italic]")
                    else:
                        console.print(f"[italic]{sub_left}{sub_right}[/italic]")
                for detail in item.get('details', []):
                    if detail.get('is_bullet'):
                        console.print(f"  • {detail.get('text', '')}")
                    else:
                        console.print(f"  {detail.get('text', '')}")
                console.print('')
    questionary.press_any_key_to_continue().ask()

def generate_resume(data, out_stem=None):
    fmt = questionary.select("Export Format:", choices=["DOCX", "PDF", "JSON", "Cancel"], use_shortcuts=True).ask()
    if not fmt or fmt == "Cancel":
        return

    stem = out_stem or make_slug(data.get('name') or 'resume')
    if fmt == "JSON":
        clean_export = {k: v for k, v in data.items() if k != '_history'}
        out_json = Path(f"{stem}.json")
        out_json.write_text(json.dumps(clean_export, indent=2), encoding='utf-8')
        console.print(f'[green]Exported {out_json}![/green]')
        return

    out_docx = Path(f"{stem}_generated.docx")
    render_resume_docx(data, out_docx)
    if fmt == "DOCX":
        console.print(f'[green]Successfully generated {out_docx}![/green]')
        return

    out_pdf = convert_docx_to_pdf(out_docx)
    if out_pdf and Path(out_pdf).exists():
        out_docx.unlink(missing_ok=True)
        console.print(f'[green]Successfully generated {Path(out_pdf).name}![/green]')
    else:
        console.print(f'[yellow]PDF conversion failed; kept {out_docx}.[/yellow]')


def version_history_menu(resume_id):
    record = get_resume_db(resume_id)
    if not record:
        return {}
    data = record['data']
    history = data.get('_history', [])
    if not history:
        console.print("[yellow]No version history available for this resume yet.[/yellow]")
        questionary.press_any_key_to_continue().ask()
        return data

    while True:
        reversed_hist = list(reversed(history))
        choices = [
            f"v{h.get('version_num', '?')} ({h.get('label', 'Snapshot')}) — {h['timestamp']}"
            for h in reversed_hist
        ] + ['Back']
        choice = questionary.select("Select a past version:", choices=choices, use_shortcuts=True).ask()
        if choice == 'Back' or not choice:
            break

        selected_version = reversed_hist[choices.index(choice)]
        action = questionary.select(
            "What would you like to do with this version?",
            choices=["Export DOCX/PDF/JSON", "Revert to this version", "Back"],
            use_shortcuts=True,
        ).ask()

        if action == "Export DOCX/PDF/JSON":
            stem = f"{record['slug']}_history_v{selected_version['version_num']}"
            generate_resume(selected_version['state'], out_stem=stem)
        elif action == "Revert to this version":
            if questionary.confirm("Are you sure? Your current state will be archived as a snapshot.").ask():
                reverted = revert_version_db(resume_id, selected_version['id'])
                if reverted:
                    console.print(f"[green]Reverted to Version #{selected_version['version_num']}![/green]")
                    return reverted['data']

    return data


def edit_resume_menu(resume_id):
    record = get_resume_db(resume_id)
    if not record:
        console.print("[red]Resume not found in database.[/red]")
        return
    data = record['data']
    while True:
        updated = update_resume_db(resume_id, data, save_mode="snapshot")
        if updated:
            data = updated['data']
        console.print(f"\n[bold cyan]--- Editing {data.get('name', 'Resume')} ---[/bold cyan]")
        choice = questionary.select(
            'What would you like to do?',
            choices=['Edit Contact Info', 'Manage Sections & Items', 'Preview in Terminal', 'Generate/Export Resume', 'Version History', 'Save & Return to Main Menu'],
            use_shortcuts=True,
        ).ask()
        if choice == 'Edit Contact Info':
            data = edit_contact_info(data)
        elif choice == 'Manage Sections & Items':
            data = manage_sections(data)
        elif choice == 'Preview in Terminal':
            preview_resume_terminal(data)
        elif choice == 'Generate/Export Resume':
            generate_resume(data, out_stem=make_slug(data.get('name') or 'resume'))
        elif choice == 'Version History':
            data = version_history_menu(resume_id)
        else:
            update_resume_db(resume_id, data, save_mode="snapshot")
            break


def main():
    init_app()
    console.print('[bold magenta]Welcome to The Free Resume Builder![/bold magenta]')
    while True:
        choice = questionary.select('Main Menu:', choices=['Select/Edit Resume', 'Create New Resume', 'Delete a Resume', 'Options', 'Help / Examples', 'Exit'], use_shortcuts=True).ask()
        if choice == 'Select/Edit Resume':
            resume_id = select_resume()
            if resume_id:
                edit_resume_menu(resume_id)
        elif choice == 'Create New Resume':
            resume_id = create_resume()
            if resume_id:
                edit_resume_menu(resume_id)
        elif choice == 'Delete a Resume':
            delete_resume()
        elif choice == 'Options':
            options_menu()
        elif choice == 'Help / Examples':
            show_help()
        else:
            console.print('[bold blue]Goodbye![/bold blue]')
            break


if __name__ == '__main__':
    main()