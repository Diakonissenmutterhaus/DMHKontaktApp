"""Create a consistent SQLite snapshot before M365 testing (no application writes)."""

from contextlib import closing
from datetime import datetime
from pathlib import Path
import sqlite3
import shutil
import sys
from uuid import uuid4


source = Path(sys.argv[1])
backup_dir = Path(sys.argv[2])
if not source.is_file():
    raise SystemExit(f"Lokale Datenbank nicht gefunden: {source}")

backup_dir.mkdir(parents=True, exist_ok=True)
destination = backup_dir / f"agendakontakte-{datetime.now():%Y%m%d-%H%M%S}-{uuid4().hex[:8]}.sqlite"
def snapshot(mode):
    with closing(sqlite3.connect(source.resolve().as_uri() + f"?mode={mode}", uri=True)) as original, closing(sqlite3.connect(destination)) as backup:
        original.execute("PRAGMA query_only = ON")
        original.backup(backup)
        if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit("Die Sicherung ist beschädigt. Der Test wurde nicht gestartet.")


try:
    snapshot("ro")
except sqlite3.OperationalError as error:
    journal = Path(str(source) + "-journal")
    if "readonly" not in str(error).lower() or not journal.is_file():
        raise
    # An interrupted process can leave a hot rollback journal. SQLite must
    # undo that uncommitted transaction before even a read-only query works.
    # Retain the original files first; query_only prevents application writes.
    raw_backup = backup_dir / f"interrupted-{uuid4().hex[:8]}"
    raw_backup.mkdir()
    shutil.copy2(source, raw_backup / source.name)
    shutil.copy2(journal, raw_backup / journal.name)
    snapshot("rw")

print(destination)
