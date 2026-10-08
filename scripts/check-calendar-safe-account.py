"""Verify that a read-only M365 test uses the same account as its backup."""

from hashlib import sha256
from pathlib import Path
import json
import sqlite3
import sys


def account_id(database_path: str) -> str:
    uri = Path(database_path).resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as database:
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


try:
    live_account = account_id(sys.argv[1])
    test_account = account_id(sys.argv[2])
    if live_account != test_account:
        raise ValueError(
            "A cópia isolada está ligada a outra conta Microsoft 365. "
            "O teste foi interrompido sem alterar nenhum banco."
        )
    print(sha256(test_account.encode("utf-8")).hexdigest())
except (OSError, sqlite3.Error, ValueError, IndexError) as error:
    raise SystemExit(str(error)) from error
