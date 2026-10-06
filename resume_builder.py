import json
import copy
from datetime import datetime

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
        console.print(f'[red]Error: {TEMPLATE_PATH} not found. Please ensure it is in the same directory.[/red]')
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
    if filepath.exists():
        with open(filepath, 'r') as f:
            try:
                old_data = json.load(f)
            except json.JSONDecodeError:
                old_data = {}
        old_compare = {k: v for k, v in old_data.items() if k != '_history'}
        new_compare = {k: v for k, v in data.items() if k != '_history'}
        if old_compare != new_compare and old_compare:
            history = data.get('_history', [])
            history.append({
                'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'state': old_compare
            })
            data['_history'] = history
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=4)


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
    while True:
        choice = questionary.select('Options:', choices=['Set API Keys', 'Back to Main Menu'], use_shortcuts=True).ask()
        if choice == 'Set API Keys':
            provider = questionary.select('Select Provider:', choices=['OpenAI', 'Gemini', 'Claude', 'Other', 'Back'], use_shortcuts=True).ask()
            if provider and provider != 'Back':
                key = questionary.password(f'Enter {provider} API Key:').ask()
                if key:
                    if 'api_keys' not in settings:
                        settings['api_keys'] = {}
                    settings['api_keys'][provider] = key
                    save_settings(settings)
                    console.print(f'[green]Saved API key for {provider}![/green]')
        else:
            break


def delete_resume():
    resumes = list(RESUMES_DIR.glob('*.json'))
    if not resumes:
        console.print("[yellow]No resumes to delete.[/yellow]")
        return
    choices = [r.name for r in resumes] + ["Back"]
    choice = questionary.select("Select a resume to delete:", choices=choices, use_shortcuts=True).ask()
    if choice == "Back" or not choice:
        return
    
    confirm_text = questionary.text(f"Type '{choice}' to confirm deletion:").ask()
    if confirm_text == choice:
        (RESUMES_DIR / choice).unlink()
        console.print(f"[green]Deleted {choice}[/green]")
    else:
        console.print("[red]Deletion cancelled.[/red]")

def create_resume():
    name = questionary.text('Full Name:').ask()
    if not name:
        return None
    phone = questionary.text('Phone Number:').ask()
    email = questionary.text('Email:').ask()
    portfolio = questionary.text('Portfolio Website (optional):').ask()
    linkedin = questionary.text('LinkedIn (optional):').ask()
    data = {'name': name, 'phone': phone, 'email': email, 'portfolio': portfolio, 'linkedin': linkedin, 'sections': []}
    filename = name.replace(' ', '_').lower() + '.json'
    filepath = RESUMES_DIR / filename
    save_resume(filepath, data)
    console.print(f'[green]Created new resume: {filename}[/green]')
    return filepath

def select_resume():
    resumes = list(RESUMES_DIR.glob('*.json'))
    if not resumes:
        console.print('[yellow]No resumes found. Please create one first.[/yellow]')
        return create_resume()
    choices = [r.name for r in resumes] + ['Create New Resume', 'Back']
    choice = questionary.select('Select a resume:', choices=choices, use_shortcuts=True).ask()
    if choice == 'Create New Resume':
        return create_resume()
    elif choice == 'Back' or not choice:
        return None
    else:
        return RESUMES_DIR / choice

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

def generate_resume(data, filepath):
    doc = DocxTemplate(TEMPLATE_PATH)
    doc.render(data)
    out_name = filepath.stem + '_generated.docx'
    doc.save(out_name)
    console.print(f'[green]Successfully generated {out_name}![/green]')

def version_history_menu(data, filepath):
    history = data.get('_history', [])
    if not history:
        console.print("[yellow]No version history available for this resume yet. It saves automatically as you make changes.[/yellow]")
        questionary.press_any_key_to_continue().ask()
        return data

    while True:
        # Show most recent first
        choices = [f"{i+1}. {h['timestamp']}" for i, h in enumerate(reversed(history))] + ['Back']
        choice = questionary.select("Select a past version:", choices=choices, use_shortcuts=True).ask()
        
        if choice == 'Back' or not choice:
            break
            
        # Convert choice back to original history index
        rev_idx = int(choice.split('.')[0]) - 1
        idx = len(history) - 1 - rev_idx
        selected_version = history[idx]
        
        action = questionary.select(
            "What would you like to do with this version?", 
            choices=["Generate PDF/Docx to preview", "Revert to this version", "Back"], 
            use_shortcuts=True
        ).ask()
        
        if action == "Generate PDF/Docx to preview":
            temp_data = selected_version['state']
            temp_filepath = filepath.with_name(f"{filepath.stem}_history_{idx+1}.json")
            generate_resume(temp_data, temp_filepath)
        elif action == "Revert to this version":
            if questionary.confirm("Are you sure? Your current state will be saved as a new history entry.").ask():
                new_data = selected_version['state']
                new_data['_history'] = history # Preserve the history list
                console.print("[green]Reverted to past version![/green]")
                return new_data

    return data

def edit_resume_menu(filepath):
    data = load_resume(filepath)
    while True:
        save_resume(filepath, data)
        console.print(f'\n[bold cyan]--- Editing {filepath.name} ---[/bold cyan]')
        choice = questionary.select('What would you like to do?', choices=['Edit Contact Info', 'Manage Sections & Items', 'Preview in Terminal', 'Generate/Preview Resume', 'Version History', 'Save & Return to Main Menu'], use_shortcuts=True).ask()
        if choice == 'Edit Contact Info':
            data = edit_contact_info(data)
        elif choice == 'Manage Sections & Items':
            data = manage_sections(data)
        elif choice == 'Preview in Terminal':
            preview_resume_terminal(data)
        elif choice == 'Generate/Preview Resume':
            generate_resume(data, filepath)
        elif choice == 'Version History':
            data = version_history_menu(data, filepath)
        else:
            save_resume(filepath, data)
            break

def main():
    init_app()
    console.print('[bold magenta]Welcome to The Free Resume Builder![/bold magenta]')
    while True:
        choice = questionary.select('Main Menu:', choices=['Select/Edit Resume', 'Create New Resume', 'Delete a Resume', 'Options', 'Help / Examples', 'Exit'], use_shortcuts=True).ask()
        if choice == 'Select/Edit Resume':
            filepath = select_resume()
            if filepath:
                edit_resume_menu(filepath)
        elif choice == 'Create New Resume':
            filepath = create_resume()
            if filepath:
                edit_resume_menu(filepath)
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