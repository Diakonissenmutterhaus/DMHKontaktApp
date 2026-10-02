"""Create a consistent, read-only-source SQLite snapshot before M365 testing."""

from contextlib import closing
from datetime import datetime
from pathlib import Path
import sqlite3
import sys
from uuid import uuid4


source = Path(sys.argv[1])
backup_dir = Path(sys.argv[2])
if not source.is_file():
    raise SystemExit(f"Lokale Datenbank nicht gefunden: {source}")

backup_dir.mkdir(parents=True, exist_ok=True)
destination = backup_dir / f"agendakontakte-{datetime.now():%Y%m%d-%H%M%S}-{uuid4().hex[:8]}.sqlite"
with closing(sqlite3.connect(f"file:{source}?mode=ro", uri=True)) as original:
    with closing(sqlite3.connect(destination)) as backup:
        original.backup(backup)
        if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit("Die Sicherung ist beschädigt. Der Test wurde nicht gestartet.")

print(destination)
