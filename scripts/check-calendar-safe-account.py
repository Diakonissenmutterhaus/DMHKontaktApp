"""Verify that a read-only M365 test uses the same account as its backup."""

from hashlib import sha256
from contextlib import closing
from pathlib import Path
import json
import os
import sqlite3
import sys


def account_id(database_path: str) -> str:
    uri = Path(database_path).resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as database:
        row = database.execute(
            "SELECT value FROM app_settings WHERE key = 'm365_connection_profile_v1'"
        ).fetchone()
    if row is None:
        # A machine without a connected account is safe as long as both the
        # source and isolated databases agree. Any later account write remains
        # blocked by DMH_M365_READ_ONLY_TEST in the Rust layer.
        return ""
    identifier = json.loads(row[0]).get("id", "")
    if not isinstance(identifier, str) or not identifier.strip():
        raise ValueError("O perfil Microsoft 365 da cópia de teste é inválido.")
    return identifier


def refresh_test_copy(source_snapshot: str, previous_snapshot: str, destination: str) -> None:
    target = Path(destination).resolve()
    allowed_target = (
        Path(os.environ["APPDATA"])
        / "de.dmh.agendakontakte.calendar-safe"
        / "agendakontakte.sqlite"
    ).resolve()
    if target != allowed_target:
        raise ValueError("Somente a cópia isolada de teste pode ser renovada.")
    previous = Path(previous_snapshot).resolve()
    source = Path(source_snapshot).resolve()
    if previous == target or source == target or not previous.is_file():
        raise ValueError("É necessário preservar um backup da cópia anterior do teste.")
    with closing(sqlite3.connect(previous.as_uri() + "?mode=ro", uri=True)) as saved:
        if saved.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("O backup anterior do teste está danificado.")
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as original:
        if original.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("O backup da base principal está danificado.")
        # SQLite's backup API also handles an existing destination in WAL mode.
        # Replacing only the .sqlite file could leave stale journal contents.
        with closing(sqlite3.connect(target)) as test_database:
            original.backup(test_database)
            if test_database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("A nova cópia isolada falhou na verificação de integridade.")


try:
    live_account = account_id(sys.argv[1])
    test_account = account_id(sys.argv[2])
    if live_account != test_account:
        if len(sys.argv) == 5 and sys.argv[3] == "--refresh-test-copy":
            refresh_test_copy(sys.argv[1], sys.argv[2], sys.argv[4])
            test_account = account_id(sys.argv[4])
            if live_account != test_account:
                raise ValueError("A conta da nova cópia isolada não foi confirmada.")
        else:
            print("A cópia isolada está ligada a outra conta Microsoft 365.")
            raise SystemExit(2)
    print(sha256(test_account.encode("utf-8")).hexdigest())
except (OSError, sqlite3.Error, ValueError, IndexError, KeyError) as error:
    raise SystemExit(str(error)) from error
