"""SQLite storage and version history management for Resume Builder."""

from __future__ import annotations

import copy
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path("resumes.db")
LEGACY_RESUMES_DIR = Path("resumes")
AUTO_CHECKPOINT_INTERVAL_SECONDS = 180


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _clean_str(val: Any) -> str:
    if isinstance(val, str):
        return val.strip()
    if val is not None:
        return str(val).strip()
    return ""


def make_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9_]+", "_", (name or "").lower()).strip("_")
    return slug or "resume"


def normalize_resume_schema(raw_data: dict | None, existing_data: dict | None = None) -> dict:
    """Coerce partial or AI-generated resume dicts into the strict Base_Template schema."""
    src = raw_data if isinstance(raw_data, dict) else {}
    normalized: dict[str, Any] = {
        "name": _clean_str(src.get("name")),
        "phone": _clean_str(src.get("phone")),
        "email": _clean_str(src.get("email")),
        "portfolio": _clean_str(src.get("portfolio")),
        "linkedin": _clean_str(src.get("linkedin")),
        "sections": [],
    }

    raw_sections = src.get("sections")
    if isinstance(raw_sections, list):
        for sec in raw_sections:
            if not isinstance(sec, dict):
                continue
            title = _clean_str(sec.get("title")).upper()
            if not title:
                continue
            is_skills = bool(sec.get("is_skills", False))
            raw_items = sec.get("items") if isinstance(sec.get("items"), list) else []
            clean_items = []
            if is_skills:
                for it in raw_items:
                    if not isinstance(it, dict):
                        continue
                    cat = _clean_str(it.get("category"))
                    txt = _clean_str(it.get("text"))
                    if cat or txt:
                        clean_items.append({"category": cat, "text": txt})
            else:
                for it in raw_items:
                    if not isinstance(it, dict):
                        continue
                    raw_details = it.get("details") if isinstance(it.get("details"), list) else []
                    clean_details = []
                    for d in raw_details:
                        if isinstance(d, dict):
                            d_txt = _clean_str(d.get("text"))
                            if d_txt:
                                clean_details.append({
                                    "is_bullet": bool(d.get("is_bullet", True)),
                                    "text": d_txt,
                                })
                        elif isinstance(d, str) and d.strip():
                            clean_details.append({"is_bullet": True, "text": d.strip()})

                    item_obj = {
                        "role": _clean_str(it.get("role")),
                        "company": _clean_str(it.get("company")),
                        "location": _clean_str(it.get("location")),
                        "date": _clean_str(it.get("date")),
                        "subtitle": _clean_str(it.get("subtitle")),
                        "subtitle_right": _clean_str(it.get("subtitle_right")),
                        "details": clean_details,
                    }
                    has_header = any(
                        item_obj[k]
                        for k in ("role", "company", "location", "date", "subtitle", "subtitle_right")
                    )
                    if has_header or clean_details:
                        clean_items.append(item_obj)

            normalized["sections"].append({
                "title": title,
                "is_skills": is_skills,
                "items": clean_items,
            })

    if isinstance(existing_data, dict) and "_history" in existing_data:
        normalized["_history"] = existing_data["_history"]

    return normalized


def _strip_history(data: dict) -> dict:
    clean = copy.deepcopy(data if isinstance(data, dict) else {})
    clean.pop("_history", None)
    return normalize_resume_schema(clean)


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or DB_PATH
    conn = sqlite3.connect(str(path), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db(db_path: Path | None = None, legacy_dir: Path | None = None) -> None:
    """Initialize SQLite schema and perform one-time migration of legacy JSON resumes."""
    with get_connection(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS resumes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL,
                name TEXT NOT NULL,
                phone TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT '',
                portfolio TEXT NOT NULL DEFAULT '',
                linkedin TEXT NOT NULL DEFAULT '',
                sections_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS resume_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
                version_num INTEGER NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                snapshot_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_resume_versions_resume_id
                ON resume_versions(resume_id, version_num);

            CREATE TABLE IF NOT EXISTS imported_legacy_files (
                filename TEXT PRIMARY KEY,
                imported_at TEXT NOT NULL
            );
            """
        )

    migrate_legacy_json_resumes(db_path=db_path, legacy_dir=legacy_dir)


def migrate_legacy_json_resumes(
    db_path: Path | None = None,
    legacy_dir: Path | None = None,
) -> int:
    """Import any un-imported legacy resumes/*.json files into SQLite exactly once."""
    src_dir = legacy_dir or LEGACY_RESUMES_DIR
    if not src_dir.exists():
        return 0

    imported_count = 0
    with get_connection(db_path) as conn:
        for json_file in sorted(src_dir.glob("*.json"), key=lambda p: p.stat().st_mtime):
            already = conn.execute(
                "SELECT 1 FROM imported_legacy_files WHERE filename = ?",
                (json_file.name,),
            ).fetchone()
            if already:
                continue

            try:
                raw = json.loads(json_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(raw, dict):
                continue

            legacy_history = raw.get("_history") if isinstance(raw.get("_history"), list) else []
            clean_current = _strip_history(raw)
            if not clean_current["name"]:
                clean_current["name"] = json_file.stem.replace("_", " ").title()

            mtime_str = datetime.fromtimestamp(json_file.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            slug = make_slug(clean_current["name"] or json_file.stem)
            sections_str = json.dumps(clean_current["sections"])

            cur = conn.execute(
                """
                INSERT INTO resumes (slug, name, phone, email, portfolio, linkedin, sections_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    slug,
                    clean_current["name"],
                    clean_current["phone"],
                    clean_current["email"],
                    clean_current["portfolio"],
                    clean_current["linkedin"],
                    sections_str,
                    mtime_str,
                    mtime_str,
                ),
            )
            resume_id = cur.lastrowid

            version_num = 0
            for hist_entry in legacy_history:
                if not isinstance(hist_entry, dict) or not isinstance(hist_entry.get("state"), dict):
                    continue
                version_num += 1
                snap = _strip_history(hist_entry["state"])
                ts = _clean_str(hist_entry.get("timestamp")) or mtime_str
                conn.execute(
                    """
                    INSERT INTO resume_versions (resume_id, version_num, label, snapshot_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (resume_id, version_num, "Legacy Snapshot", json.dumps(snap), ts),
                )

            # Ensure current state is also captured if history was empty or differs from last imported snapshot
            should_append_current = version_num == 0
            if not should_append_current:
                last_row = conn.execute(
                    "SELECT snapshot_json FROM resume_versions WHERE resume_id = ? ORDER BY version_num DESC LIMIT 1",
                    (resume_id,),
                ).fetchone()
                if last_row and json.loads(last_row["snapshot_json"]) != clean_current:
                    should_append_current = True

            if should_append_current:
                version_num += 1
                label = "Imported Version" if version_num > 1 else "Initial Draft"
                conn.execute(
                    """
                    INSERT INTO resume_versions (resume_id, version_num, label, snapshot_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (resume_id, version_num, label, json.dumps(clean_current), mtime_str),
                )

            conn.execute(
                "INSERT INTO imported_legacy_files (filename, imported_at) VALUES (?, ?)",
                (json_file.name, _now_str()),
            )
            imported_count += 1

    return imported_count


def _row_to_resume_dict(row: sqlite3.Row, versions: list[sqlite3.Row]) -> dict:
    sections = json.loads(row["sections_json"] or "[]")
    history = []
    for v in versions:
        history.append({
            "id": v["id"],
            "version_num": v["version_num"],
            "label": v["label"] or f"Version #{v['version_num']}",
            "timestamp": v["created_at"],
            "state": json.loads(v["snapshot_json"]),
        })
    return {
        "name": row["name"],
        "phone": row["phone"],
        "email": row["email"],
        "portfolio": row["portfolio"],
        "linkedin": row["linkedin"],
        "sections": sections,
        "_history": history,
    }


def list_resumes_db(db_path: Path | None = None) -> list[dict]:
    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT r.*,
                   (SELECT COUNT(*) FROM resume_versions v WHERE v.resume_id = r.id) AS history_count
            FROM resumes r
            ORDER BY r.updated_at DESC, r.id DESC
            """
        ).fetchall()
        items = []
        for r in rows:
            sections = json.loads(r["sections_json"] or "[]")
            items.append({
                "id": r["id"],
                "slug": r["slug"],
                "name": r["name"],
                "email": r["email"],
                "phone": r["phone"],
                "section_count": len(sections),
                "section_titles": [s.get("title", "") for s in sections if isinstance(s, dict)],
                "history_count": r["history_count"],
                "updated_at": r["updated_at"][:16],
            })
        return items


def get_resume_db(resume_id: int, db_path: Path | None = None) -> dict | None:
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM resumes WHERE id = ?", (resume_id,)).fetchone()
        if not row:
            return None
        versions = conn.execute(
            "SELECT * FROM resume_versions WHERE resume_id = ? ORDER BY version_num ASC, id ASC",
            (resume_id,),
        ).fetchall()
        return {
            "id": row["id"],
            "slug": row["slug"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "data": _row_to_resume_dict(row, versions),
        }


def create_resume_db(
    payload: dict,
    initial_label: str = "Initial Draft",
    db_path: Path | None = None,
) -> dict:
    clean = _strip_history(payload)
    if not clean["name"]:
        raise ValueError("Full Name is required.")

    now = _now_str()
    slug = make_slug(clean["name"])
    sections_str = json.dumps(clean["sections"])
    snapshot_str = json.dumps(clean)

    with get_connection(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO resumes (slug, name, phone, email, portfolio, linkedin, sections_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                slug,
                clean["name"],
                clean["phone"],
                clean["email"],
                clean["portfolio"],
                clean["linkedin"],
                sections_str,
                now,
                now,
            ),
        )
        resume_id = cur.lastrowid
        conn.execute(
            """
            INSERT INTO resume_versions (resume_id, version_num, label, snapshot_json, created_at)
            VALUES (?, 1, ?, ?, ?)
            """,
            (resume_id, initial_label or "Initial Draft", snapshot_str, now),
        )

    return get_resume_db(resume_id, db_path=db_path)  # type: ignore[return-value]


def duplicate_resume_db(resume_id: int, db_path: Path | None = None) -> dict | None:
    """Create a deep copy of an existing resume with a unique '(Copy)' name."""
    source = get_resume_db(resume_id, db_path=db_path)
    if not source:
        return None

    src_data = _strip_history(source["data"])
    base_name = re.sub(r"\s+\(Copy(?:\s+\d+)?\)$", "", src_data["name"]).strip() or src_data["name"]

    with get_connection(db_path) as conn:
        existing_names = {
            row["name"].strip().lower()
            for row in conn.execute("SELECT name FROM resumes").fetchall()
        }

    candidate_name = f"{base_name} (Copy)"
    counter = 2
    while candidate_name.lower() in existing_names:
        candidate_name = f"{base_name} (Copy {counter})"
        counter += 1

    copy_payload = {
        **src_data,
        "name": candidate_name,
    }
    return create_resume_db(
        copy_payload,
        initial_label=f"Duplicated from {src_data['name']}",
        db_path=db_path,
    )


def _should_record_version(
    conn: sqlite3.Connection,
    resume_id: int,
    new_snapshot: dict,
    save_mode: str,
) -> tuple[bool, int, str]:
    last_row = conn.execute(
        "SELECT version_num, snapshot_json, created_at FROM resume_versions WHERE resume_id = ? ORDER BY version_num DESC, id DESC LIMIT 1",
        (resume_id,),
    ).fetchone()

    next_ver = (last_row["version_num"] + 1) if last_row else 1
    if not last_row:
        label = "AI Builder Update" if save_mode == "ai" else "Saved Snapshot"
        return True, next_ver, label

    last_snapshot = json.loads(last_row["snapshot_json"])
    if last_snapshot == new_snapshot:
        return False, next_ver, ""

    if save_mode == "snapshot":
        return True, next_ver, "Saved Snapshot"
    if save_mode == "ai":
        return True, next_ver, "AI Builder Update"

    # Auto-save only creates a checkpoint after AUTO_CHECKPOINT_INTERVAL_SECONDS since latest version
    try:
        last_dt = datetime.strptime(last_row["created_at"], "%Y-%m-%d %H:%M:%S")
        elapsed = (datetime.now() - last_dt).total_seconds()
    except Exception:
        elapsed = AUTO_CHECKPOINT_INTERVAL_SECONDS + 1

    if elapsed >= AUTO_CHECKPOINT_INTERVAL_SECONDS:
        return True, next_ver, "Auto-Checkpoint"

    return False, next_ver, ""


def update_resume_db(
    resume_id: int,
    payload: dict,
    save_mode: str = "autosave",
    db_path: Path | None = None,
) -> dict | None:
    """Update live resume row and optionally record a version history snapshot."""
    clean = _strip_history(payload)
    now = _now_str()

    with get_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM resumes WHERE id = ?", (resume_id,)).fetchone()
        if not row:
            return None

        # Preserve existing non-empty name if transient blank input occurs mid-edit
        effective_name = clean["name"] or row["name"]
        clean["name"] = effective_name
        slug = make_slug(effective_name)
        sections_str = json.dumps(clean["sections"])

        conn.execute(
            """
            UPDATE resumes
            SET slug = ?, name = ?, phone = ?, email = ?, portfolio = ?, linkedin = ?, sections_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                slug,
                clean["name"],
                clean["phone"],
                clean["email"],
                clean["portfolio"],
                clean["linkedin"],
                sections_str,
                now,
                resume_id,
            ),
        )

        record, next_ver, label = _should_record_version(conn, resume_id, clean, save_mode)
        if record:
            conn.execute(
                """
                INSERT INTO resume_versions (resume_id, version_num, label, snapshot_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (resume_id, next_ver, label, json.dumps(clean), now),
            )

    return get_resume_db(resume_id, db_path=db_path)


def delete_resume_db(resume_id: int, confirm_name: str, db_path: Path | None = None) -> tuple[bool, str]:
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT id, name FROM resumes WHERE id = ?", (resume_id,)).fetchone()
        if not row:
            return False, "not_found"
        if (confirm_name or "").strip() != (row["name"] or "").strip():
            return False, "mismatch"
        conn.execute("DELETE FROM resumes WHERE id = ?", (resume_id,))
        return True, row["name"]


def get_version_db(resume_id: int, version_id: int, db_path: Path | None = None) -> dict | None:
    with get_connection(db_path) as conn:
        res_row = conn.execute("SELECT id, slug, name FROM resumes WHERE id = ?", (resume_id,)).fetchone()
        if not res_row:
            return None
        ver_row = conn.execute(
            "SELECT * FROM resume_versions WHERE id = ? AND resume_id = ?",
            (version_id, resume_id),
        ).fetchone()
        if not ver_row:
            return None
        return {
            "resume_id": res_row["id"],
            "slug": res_row["slug"],
            "resume_name": res_row["name"],
            "version_id": ver_row["id"],
            "version_num": ver_row["version_num"],
            "label": ver_row["label"],
            "timestamp": ver_row["created_at"],
            "state": json.loads(ver_row["snapshot_json"]),
        }


def revert_version_db(resume_id: int, version_id: int, db_path: Path | None = None) -> dict | None:
    now = _now_str()
    with get_connection(db_path) as conn:
        res_row = conn.execute("SELECT * FROM resumes WHERE id = ?", (resume_id,)).fetchone()
        if not res_row:
            return None
        target_ver = conn.execute(
            "SELECT * FROM resume_versions WHERE id = ? AND resume_id = ?",
            (version_id, resume_id),
        ).fetchone()
        if not target_ver:
            return None

        # Archive current live state before reverting if it differs from latest saved snapshot
        current_live = _strip_history({
            "name": res_row["name"],
            "phone": res_row["phone"],
            "email": res_row["email"],
            "portfolio": res_row["portfolio"],
            "linkedin": res_row["linkedin"],
            "sections": json.loads(res_row["sections_json"] or "[]"),
        })
        last_ver = conn.execute(
            "SELECT version_num, snapshot_json FROM resume_versions WHERE resume_id = ? ORDER BY version_num DESC, id DESC LIMIT 1",
            (resume_id,),
        ).fetchone()
        next_ver = (last_ver["version_num"] + 1) if last_ver else 1
        if not last_ver or json.loads(last_ver["snapshot_json"]) != current_live:
            conn.execute(
                """
                INSERT INTO resume_versions (resume_id, version_num, label, snapshot_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (resume_id, next_ver, "Before Revert", json.dumps(current_live), now),
            )
            next_ver += 1

        restored = _strip_history(json.loads(target_ver["snapshot_json"]))
        slug = make_slug(restored["name"] or res_row["name"])
        conn.execute(
            """
            UPDATE resumes
            SET slug = ?, name = ?, phone = ?, email = ?, portfolio = ?, linkedin = ?, sections_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                slug,
                restored["name"] or res_row["name"],
                restored["phone"],
                restored["email"],
                restored["portfolio"],
                restored["linkedin"],
                json.dumps(restored["sections"]),
                now,
                resume_id,
            ),
        )
        conn.execute(
            """
            INSERT INTO resume_versions (resume_id, version_num, label, snapshot_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                resume_id,
                next_ver,
                f"Reverted to Version #{target_ver['version_num']}",
                json.dumps(restored),
                now,
            ),
        )

    return get_resume_db(resume_id, db_path=db_path)
