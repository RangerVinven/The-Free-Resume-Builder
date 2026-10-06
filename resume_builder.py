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

def init_app():
    RESUMES_DIR.mkdir(exist_ok=True)
    if not TEMPLATE_PATH.exists():
        console.print(f"[red]Error: {TEMPLATE_PATH} not found. Please ensure it is in the same directory.[/red]")
        sys.exit(1)

def load_resume(filepath):
    with open(filepath, 'r') as f:
        return json.load(f)

def save_resume(filepath, data):
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=4)

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

def add_section(data):
    title = questionary.text("Section Title (e.g. EDUCATION, EXPERIENCE):").ask()
    if title:
        data['sections'].append({
            "title": title.upper(),
            "items": []
        })
        console.print(f"[green]Added section: {title.upper()}[/green]")
    return data

def add_item_to_section(data):
    if not data.get('sections'):
        console.print("[yellow]No sections exist. Create a section first.[/yellow]")
        return data
        
    section_choices = [s['title'] for s in data['sections']]
    section_title = questionary.select("Select Section to add to:", choices=section_choices).ask()
    if not section_title: return data
    
    section = next(s for s in data['sections'] if s['title'] == section_title)
    
    title = questionary.text("Item Title (e.g. University Name or Job Title):").ask()
    date = questionary.text("Date (e.g. May 2024 - August 2024):").ask()
    subtitle = questionary.text("Item Subtitle (e.g. Degree or Company Name) [Optional]:").ask()
    
    item = {
        "title": title,
        "date": date,
        "subtitle": subtitle,
        "details": []
    }
    
    while True:
        add_detail = questionary.confirm("Add a detail (bullet point or prose)?").ask()
        if not add_detail:
            break
            
        detail_type = questionary.select("Detail Style:", choices=["Bullet Point", "Prose"]).ask()
        text = questionary.text("Enter text:").ask()
        
        item['details'].append({
            "is_bullet": detail_type == "Bullet Point",
            "text": text
        })
        
    section['items'].append(item)
    console.print(f"[green]Added item '{title}' to {section_title}[/green]")
    return data

def generate_resume(data, filepath):
    doc = DocxTemplate(TEMPLATE_PATH)
    doc.render(data)
    
    out_name = filepath.stem + "_generated.docx"
    doc.save(out_name)
    console.print(f"[green]Successfully generated {out_name}![/green]")

def edit_resume_menu(filepath):
    data = load_resume(filepath)
    while True:
        console.print(f"\n[bold cyan]--- Editing {filepath.name} ---[/bold cyan]")
        choice = questionary.select(
            "What would you like to do?",
            choices=[
                "Add New Section",
                "Add Item to Section",
                "Generate/Preview Resume",
                "Save & Return to Main Menu"
            ]
        ).ask()
        
        if choice == "Add New Section":
            data = add_section(data)
        elif choice == "Add Item to Section":
            data = add_item_to_section(data)
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
        else:
            console.print("[bold blue]Goodbye![/bold blue]")
            break

if __name__ == "__main__":
    main()
