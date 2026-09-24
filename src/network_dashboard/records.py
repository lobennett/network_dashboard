"""Short-lived read-only connections survive atomic index replacement."""
from contextlib import contextmanager
from pathlib import Path
import sqlite3


@contextmanager
def connect(index: Path):
    with sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        yield db


def rows(db, sql: str, args=()) -> list[dict]:
    return [dict(row) for row in db.execute(sql, args)]


def dataset_roots(db, study: Path) -> dict[str, Path]:
    identity = db.execute("SELECT value FROM metadata WHERE key='study_id'").fetchone()[0]
    roots = {identity: study}
    for row in db.execute("SELECT path,kind FROM artifacts WHERE kind LIKE 'dataset:%'"):
        relative = Path(row["path"])
        if not relative.is_absolute() and ".." not in relative.parts:
            roots[row["kind"].removeprefix("dataset:")] = study / relative
    return roots
