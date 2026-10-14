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


def historical_only(db, identity: str) -> bool:
    """Whether a file version is recorded only as an earlier processing input."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='artifact_observations'").fetchone():
        return False
    observations = list(db.execute(
        "SELECT availability FROM artifact_observations WHERE artifact_id=?", (identity,)))
    return bool(observations) and all(row[0] == 'historical' for row in observations)


def published_location(db, artifact: dict) -> str | None:
    """Resolve an audited historical version; never guess from its current name."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='artifact_locations'").fetchone():
        return None
    row = db.execute('SELECT location FROM artifact_locations WHERE artifact_id=?', (artifact['id'],)).fetchone()
    if not row or not row[0]:
        return None
    location = Path(row[0])
    roots = dataset_roots(db, Path('.'))
    root = roots.get(artifact['dataset_id'])
    if root is None or location.is_absolute() or '..' in location.parts or '\\' in row[0]:
        raise ValueError('Invalid published file location')
    historical = Path('code/network_fmri/publication/historical-files') / artifact['content_id'].removeprefix('sha256:')
    if artifact['content_id'].startswith('sha256:') and location == historical:
        return row[0]
    import re
    annex = root / '.git/annex/objects'
    if location.is_relative_to(annex):
        parts = location.relative_to(annex).parts
        if (len(parts) == 4 and all(re.fullmatch(r'[A-Za-z0-9]+', p) for p in parts[:2])
                and parts[2] == parts[3]
                and re.fullmatch(r'(?:MD5|SHA256)E?-s\d+--[a-f0-9]+(?:\.[A-Za-z0-9.]+)?', parts[3])):
            return row[0]
    raise ValueError('Published location is not a retained dataset version')


def published_availability(db, identity: str) -> str | None:
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='artifact_locations'").fetchone():
        row = db.execute('SELECT availability FROM artifact_locations WHERE artifact_id=?', (identity,)).fetchone()
        if row:
            return row[0]
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='artifact_observations'").fetchone():
        values = {r[0] for r in db.execute('SELECT availability FROM artifact_observations WHERE artifact_id=? AND commit_hash IS NOT NULL', (identity,))}
        if 'available' in values:
            return 'available'
        if 'unavailable' in values:
            return 'unavailable'
    return None
