"""SQLite persistence and owned-audio lifecycle for Gemma 4 conversations."""
from __future__ import annotations

import contextlib
import os
import time
import uuid
from pathlib import Path

from core.config import DATA_DIR, OUTPUTS_DIR
from core.db import db_conn
from core.file_cleanup import unlink_if_present

AUDIO_ROOT = Path(DATA_DIR) / "gemma4_assistant"


def _owned_audio_path(stored_path: str) -> Path:
    root = AUDIO_ROOT.resolve()
    candidate = (Path(DATA_DIR) / stored_path).resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError("assistant audio path escapes its storage directory")
    return candidate


def _output_audio_path(filename: str) -> Path:
    if not filename or Path(filename).name != filename:
        raise ValueError("invalid generated audio path")
    root = Path(OUTPUTS_DIR).resolve()
    candidate = (root / filename).resolve()
    if root not in candidate.parents:
        raise ValueError("generated audio path escapes the outputs directory")
    return candidate


def list_threads() -> list[dict]:
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT t.*, COUNT(m.id) AS message_count FROM gemma4_threads t "
            "LEFT JOIN gemma4_messages m ON m.thread_id=t.id "
            "GROUP BY t.id ORDER BY t.updated_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def create_thread(persona: str) -> dict:
    thread_id = str(uuid.uuid4())
    now = time.time()
    with db_conn() as conn:
        conn.execute(
            "INSERT INTO gemma4_threads (id, title, persona, created_at, updated_at) "
            "VALUES (?, '', ?, ?, ?)",
            (thread_id, persona, now, now),
        )
        row = conn.execute("SELECT * FROM gemma4_threads WHERE id=?", (thread_id,)).fetchone()
    return dict(row)


def get_thread(thread_id: str) -> dict | None:
    with db_conn() as conn:
        thread = conn.execute("SELECT * FROM gemma4_threads WHERE id=?", (thread_id,)).fetchone()
        if thread is None:
            return None
        messages = conn.execute(
            "SELECT * FROM gemma4_messages WHERE thread_id=? ORDER BY seq",
            (thread_id,),
        ).fetchall()
    result = dict(thread)
    result["messages"] = [dict(message) for message in messages]
    return result


def begin_turn(
    thread_id: str,
    text: str,
    persona: str,
    audio_requested: bool,
    user_message_id: str,
    assistant_message_id: str,
) -> None:
    now = time.time()
    with db_conn() as conn:
        thread = conn.execute(
            "SELECT title FROM gemma4_threads WHERE id=?", (thread_id,)
        ).fetchone()
        if thread is None:
            raise LookupError("thread not found")
        seq = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) FROM gemma4_messages WHERE thread_id=?",
            (thread_id,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO gemma4_messages "
            "(id, thread_id, seq, role, content, status, created_at) "
            "VALUES (?, ?, ?, 'user', ?, 'complete', ?)",
            (user_message_id, thread_id, seq + 1, text, now),
        )
        conn.execute(
            "INSERT INTO gemma4_messages "
            "(id, thread_id, seq, role, content, status, audio_requested, created_at) "
            "VALUES (?, ?, ?, 'assistant', '', 'streaming', ?, ?)",
            (assistant_message_id, thread_id, seq + 2, int(audio_requested), now),
        )
        title = thread["title"] or text.strip()[:60]
        conn.execute(
            "UPDATE gemma4_threads SET title=?, persona=?, updated_at=? WHERE id=?",
            (title, persona, now, thread_id),
        )


def complete_message(thread_id: str, message_id: str, content: str) -> None:
    with db_conn() as conn:
        changed = conn.execute(
            "UPDATE gemma4_messages SET content=?, status='complete' "
            "WHERE id=? AND thread_id=? AND role='assistant'",
            (content, message_id, thread_id),
        ).rowcount
        if not changed:
            raise LookupError("message not found")
        conn.execute(
            "UPDATE gemma4_threads SET updated_at=? WHERE id=?", (time.time(), thread_id)
        )


def fail_message(thread_id: str, message_id: str) -> None:
    with db_conn() as conn:
        conn.execute(
            "UPDATE gemma4_messages SET status='error' WHERE id=? AND thread_id=?",
            (message_id, thread_id),
        )


def delete_message(thread_id: str, message_id: str) -> bool:
    with db_conn() as conn:
        row = conn.execute(
            "SELECT audio_path FROM gemma4_messages WHERE id=? AND thread_id=?",
            (message_id, thread_id),
        ).fetchone()
        if row is None:
            return False
        if row["audio_path"]:
            unlink_if_present(_owned_audio_path(row["audio_path"]))
        conn.execute("DELETE FROM gemma4_messages WHERE id=?", (message_id,))
        conn.execute(
            "UPDATE gemma4_threads SET updated_at=? WHERE id=?", (time.time(), thread_id)
        )
    return True


def delete_thread(thread_id: str) -> bool:
    with db_conn() as conn:
        exists = conn.execute("SELECT 1 FROM gemma4_threads WHERE id=?", (thread_id,)).fetchone()
        if exists is None:
            return False
        rows = conn.execute(
            "SELECT audio_path FROM gemma4_messages WHERE thread_id=? AND audio_path<>''",
            (thread_id,),
        ).fetchall()
        for row in rows:
            unlink_if_present(_owned_audio_path(row["audio_path"]))
        conn.execute("DELETE FROM gemma4_threads WHERE id=?", (thread_id,))
    with contextlib.suppress(OSError):
        (AUDIO_ROOT / thread_id).rmdir()
    return True


def attach_generated_audio(
    thread_id: str,
    message_id: str,
    audio_id: str,
    profile_id: str,
) -> dict:
    destination = AUDIO_ROOT / thread_id / f"{message_id}.wav"
    moved_from: Path | None = None
    try:
        with db_conn() as conn:
            message = conn.execute(
                "SELECT * FROM gemma4_messages WHERE id=? AND thread_id=? AND role='assistant'",
                (message_id, thread_id),
            ).fetchone()
            if message is None:
                raise LookupError("message not found")
            generated = conn.execute(
                "SELECT audio_path FROM generation_history WHERE id=?", (audio_id,)
            ).fetchone()
            if generated is None:
                raise LookupError("generated audio not found")
            source = _output_audio_path(generated["audio_path"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, destination)
            moved_from = source
            stored_path = str(destination.relative_to(DATA_DIR))
            conn.execute(
                "UPDATE gemma4_messages SET audio_path=?, profile_id=? WHERE id=?",
                (stored_path, profile_id, message_id),
            )
            conn.execute("DELETE FROM generation_history WHERE id=?", (audio_id,))
            result = conn.execute(
                "SELECT * FROM gemma4_messages WHERE id=?", (message_id,)
            ).fetchone()
        return dict(result)
    except Exception:
        if moved_from is not None and destination.exists():
            with contextlib.suppress(OSError):
                os.replace(destination, moved_from)
        raise


def audio_file(thread_id: str, message_id: str) -> Path | None:
    with db_conn() as conn:
        row = conn.execute(
            "SELECT audio_path FROM gemma4_messages WHERE id=? AND thread_id=?",
            (message_id, thread_id),
        ).fetchone()
    if row is None or not row["audio_path"]:
        return None
    path = _owned_audio_path(row["audio_path"])
    return path if path.is_file() else None
