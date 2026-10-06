import json
import os
import sys
from pathlib import Path
import questionary
from rich.console import Console
from rich.table import Table
from docxtpl import DocxTemplate

console = Console()
RESUMES_DIR = Path('resumes')
TEMPLATE_PATH = Path('Base_Template.docx')
SETTINGS_PATH = Path('settings.json')

def init_app():
    RESUMES_DIR.mkdir(exist_ok=True)
    if not TEMPLATE_PATH.exists():
        console.print(f"[red]Error: {TEMPLATE_PATH} not found. Please ensure it is in the same directory.[/red]")
        sys.exit(1)

def load_settings():
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH, 'r') as f:
            return json.load(f)
    return {}

def save_settings(data):
    with open(SETTINGS_PATH, 'w') as f:
        json.dump(data, f, indent=4)

def load_resume(filepath):
    with open(filepath, 'r') as f:
        return json.load(f)

def save_resume(filepath, data):
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=4)

def options_menu():
    settings = load_settings()
    while True:
        choice = questionary.select(
            "Options:",
            choices=[
                "Set API Keys",
                "Back to Main Menu"
            ]
        ).ask()
        
        if choice == "Set API Keys":
            provider = questionary.select(
                "Select Provider:",
                choices=["OpenAI", "Gemini", "Claude", "Other", "Back"]
            ).ask()
            if provider and provider != "Back":
                key = questionary.password(f"Enter {provider} API Key:").ask()
                if key:
                    if 'api_keys' not in settings:
                        settings['api_keys'] = {}
                    settings['api_keys'][provider] = key
                    save_settings(settings)
                    console.print(f"[green]Saved API key for {provider}![/green]")
        else:
            break

def create_resume():
    name = questionary.text("Full Name:").ask()
    if not name: return None
    phone = questionary.text("Phone Number:").ask()
    email = questionary.text("Email:").ask()
    portfolio = questionary.text("Portfolio Website (optional):").ask()
    linkedin = questionary.text("LinkedIn (optional):").ask()

    data = {
        "name": name,
        "phone": phone,
        "email": email,
        "portfolio": portfolio,
        "linkedin": linkedin,
        "sections": []
    }
    filename = name.replace(' ', '_').lower() + ".json"
    filepath = RESUMES_DIR / filename
    save_resume(filepath, data)
    console.print(f"[green]Created new resume: {filename}[/green]")
    return filepath

def select_resume():
    resumes = list(RESUMES_DIR.glob('*.json'))
    if not resumes:
        console.print("[yellow]No resumes found. Please create one first.[/yellow]")
        return create_resume()
    
    choices = [r.name for r in resumes] + ["Create New Resume", "Back"]
    choice = questionary.select("Select a resume:", choices=choices).ask()
    
    if choice == "Create New Resume":
        return create_resume()
    elif choice == "Back" or not choice:
        return None
    else:
        return RESUMES_DIR / choice

def edit_contact_info(data):
    data['name'] = questionary.text("Full Name:", default=data.get('name', '')).ask() or data.get('name')
    data['phone'] = questionary.text("Phone Number:", default=data.get('phone', '')).ask() or data.get('phone')
    data['email'] = questionary.text("Email:", default=data.get('email', '')).ask() or data.get('email')
    data['portfolio'] = questionary.text("Portfolio Website (optional):", default=data.get('portfolio', '')).ask() or data.get('portfolio')
    data['linkedin'] = questionary.text("LinkedIn (optional):", default=data.get('linkedin', '')).ask() or data.get('linkedin')
    return data

def edit_sections(data):
    while True:
        choices = [f"Edit: {s['title']}" for s in data.get('sections', [])] + ["Add New Section", "Back"]
        choice = questionary.select("Manage Sections:", choices=choices).ask()
        
        if choice == "Back" or not choice:
            break
        elif choice == "Add New Section":
            title = questionary.text("Section Title (e.g. EDUCATION, EXPERIENCE):").ask()
            if title:
                data['sections'].append({"title": title.upper(), "items": []})
                console.print(f"[green]Added section: {title.upper()}[/green]")
        else:
            idx = choices.index(choice)
            section = data['sections'][idx]
            action = questionary.select("Action:", choices=["Rename Section", "Delete Section", "Back"]).ask()
            
            if action == "Rename Section":
                new_title = questionary.text("New Title:", default=section['title']).ask()
                if new_title:
                    section['title'] = new_title.upper()
                    console.print(f"[green]Renamed to {section['title']}[/green]")
            elif action == "Delete Section":
                if questionary.confirm(f"Are you sure you want to delete {section['title']}?").ask():
                    data['sections'].pop(idx)
                    console.print("[green]Deleted section[/green]")
    return data

def manage_items(data):
    if not data.get('sections'):
        console.print("[yellow]No sections exist. Add a section first.[/yellow]")
        return data
        
    section_choices = [s['title'] for s in data['sections']] + ["Back"]
    section_title = questionary.select("Select Section to manage items:", choices=section_choices).ask()
    if section_title == "Back" or not section_title: return data
    
    section = next(s for s in data['sections'] if s['title'] == section_title)
    
    while True:
        item_choices = [f"{i.get('title', 'Untitled')} - {i.get('date', '')}" for i in section.get('items', [])] + ["Add New Item", "Back"]
        choice = questionary.select(f"Items in {section_title}:", choices=item_choices).ask()
        
        if choice == "Back" or not choice:
            break
        elif choice == "Add New Item":
            title = questionary.text("Item Title (e.g. University Name or Job Title):").ask()
            date = questionary.text("Date (e.g. May 2024 - August 2024):").ask()
            subtitle = questionary.text("Item Subtitle (e.g. Degree or Company Name) [Optional]:").ask()
            item = {"title": title, "date": date, "subtitle": subtitle, "details": []}
            while True:
                if not questionary.confirm("Add a detail (bullet point or prose)?").ask():
                    break
                detail_type = questionary.select("Detail Style:", choices=["Bullet Point", "Prose"]).ask()
                text = questionary.text("Enter text:").ask()
                item['details'].append({"is_bullet": detail_type == "Bullet Point", "text": text})
            section.setdefault('items', []).append(item)
            console.print(f"[green]Added item '{title}'[/green]")
        else:
            idx = item_choices.index(choice)
            item = section['items'][idx]
            
            while True:
                action = questionary.select(
                    f"Action for {item.get('title')}:",
                    choices=["Edit Item Header", "Manage Details", "Delete Item", "Back"]
                ).ask()
                
                if action == "Back" or not action:
                    break
                elif action == "Edit Item Header":
                    item['title'] = questionary.text("Item Title:", default=item.get('title', '')).ask() or item['title']
                    item['date'] = questionary.text("Date:", default=item.get('date', '')).ask() or item['date']
                    item['subtitle'] = questionary.text("Item Subtitle:", default=item.get('subtitle', '')).ask() or item['subtitle']
                elif action == "Delete Item":
                    if questionary.confirm(f"Delete {item.get('title')}?").ask():
                        section['items'].pop(idx)
                        console.print("[green]Deleted item[/green]")
                        break
                elif action == "Manage Details":
                    while True:
                        det_choices = [f"[{'Bullet' if d.get('is_bullet') else 'Prose'}] {d.get('text', '')[:30]}..." for d in item.get('details', [])] + ["Add New Detail", "Back"]
                        d_choice = questionary.select("Select Detail:", choices=det_choices).ask()
                        if d_choice == "Back" or not d_choice: break
                        elif d_choice == "Add New Detail":
                            detail_type = questionary.select("Detail Style:", choices=["Bullet Point", "Prose"]).ask()
                            text = questionary.text("Enter text:").ask()
                            item.setdefault('details', []).append({"is_bullet": detail_type == "Bullet Point", "text": text})
                        else:
                            d_idx = det_choices.index(d_choice)
                            d_act = questionary.select("Action:", choices=["Edit", "Delete", "Back"]).ask()
                            if d_act == "Edit":
                                d = item['details'][d_idx]
                                d_type = questionary.select("Detail Style:", choices=["Bullet Point", "Prose"], default="Bullet Point" if d.get('is_bullet') else "Prose").ask()
                                d['is_bullet'] = (d_type == "Bullet Point")
                                d['text'] = questionary.text("Enter text:", default=d.get('text', '')).ask() or d['text']
                            elif d_act == "Delete":
                                item['details'].pop(d_idx)
    return data


def preview_resume_terminal(data):
    console.print(f"
[bold white on black] {data.get('name', 'Name').upper()} [/bold white on black]")
    contact = f"{data.get('phone', '')} | {data.get('email', '')}"
    if data.get('portfolio'): contact += f" | {data.get('portfolio')}"
    if data.get('linkedin'): contact += f" | {data.get('linkedin')}"
    console.print(f"[cyan]{contact}[/cyan]
")
    
    for section in data.get('sections', []):
        console.print(f"[bold magenta]{section.get('title', '')}[/bold magenta]")
        console.print("[magenta]" + "-"*40 + "[/magenta]")
        for item in section.get('items', []):
            header = f"[bold green]{item.get('title', '')}[/bold green]"
            if item.get('date'): header += f"  [yellow]({item.get('date')})[/yellow]"
            console.print(header)
            if item.get('subtitle'):
                console.print(f"[italic]{item.get('subtitle')}[/italic]")
            for detail in item.get('details', []):
                if detail.get('is_bullet'):
                    console.print(f"  • {detail.get('text', '')}")
                else:
                    console.print(f"  {detail.get('text', '')}")
            console.print("")
    
    questionary.press_any_key_to_continue().ask()

def generate_resume(data, filepath):
    doc = DocxTemplate(TEMPLATE_PATH)
    doc.render(data)
    
    out_name = filepath.stem + "_generated.docx"
    doc.save(out_name)
    console.print(f"[green]Successfully generated {out_name}![/green]")

def edit_resume_menu(filepath):
    data = load_resume(filepath)
    while True:
        # Save on every menu cycle
        save_resume(filepath, data)
        console.print(f"\n[bold cyan]--- Editing {filepath.name} ---[/bold cyan]")
        choice = questionary.select(
            "What would you like to do?",
            choices=[
                "Edit Contact Info",
                "Manage Sections (Add/Rename/Delete)",
                "Manage Items in Section",
                "Preview in Terminal",
                "Generate/Preview Resume",
                "Save & Return to Main Menu"
            ]
        ).ask()
        
        if choice == "Edit Contact Info":
            data = edit_contact_info(data)
        elif choice == "Manage Sections (Add/Rename/Delete)":
            data = edit_sections(data)
        elif choice == "Manage Items in Section":
            data = manage_items(data)
        elif choice == "Preview in Terminal":
            preview_resume_terminal(data)
        elif choice == "Generate/Preview Resume":
            generate_resume(data, filepath)
        else:
            save_resume(filepath, data)
            break

def main():
    init_app()
    console.print("[bold magenta]Welcome to The Free Resume Builder![/bold magenta]")
    
    while True:
        choice = questionary.select(
            "Main Menu:",
            choices=[
                "Select/Edit Resume",
                "Create New Resume",
                "Options",
                "Exit"
            ]
        ).ask()
        
        if choice == "Select/Edit Resume":
            filepath = select_resume()
            if filepath:
                edit_resume_menu(filepath)
        elif choice == "Create New Resume":
            filepath = create_resume()
            if filepath:
                edit_resume_menu(filepath)
        elif choice == "Options":
            options_menu()
        else:
            console.print("[bold blue]Goodbye![/bold blue]")
            break

if __name__ == "__main__":
    main()
