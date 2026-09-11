"""Persistent Gemma 4 conversation threads and messages.

Revision ID: 0011_gemma4_conversations
Revises: 0010_remote_worker_schema
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0011_gemma4_conversations"
down_revision: Union[str, None] = "0010_remote_worker_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS gemma4_threads (
            id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
            persona TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS gemma4_messages (
            id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, seq INTEGER NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'complete',
            audio_requested INTEGER NOT NULL DEFAULT 0,
            audio_path TEXT NOT NULL DEFAULT '', profile_id TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL,
            FOREIGN KEY (thread_id) REFERENCES gemma4_threads(id) ON DELETE CASCADE,
            UNIQUE (thread_id, seq)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_gemma4_threads_updated "
        "ON gemma4_threads(updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_gemma4_messages_thread "
        "ON gemma4_messages(thread_id, seq)"
    )


def downgrade() -> None:
    op.drop_table("gemma4_messages")
    op.drop_table("gemma4_threads")
