"""Fetch one registered, preview-eligible artifact through DataLad."""
from pathlib import Path
import subprocess

from fastapi import HTTPException

from network_dashboard.artifacts import content_path
from network_dashboard.records import connect, dataset_roots


def fetch_artifact(index: Path, study: Path, identity: str, runner=subprocess.run) -> Path:
    study = Path(study).resolve()
    with connect(index) as db:
        row = db.execute('SELECT * FROM artifact_versions WHERE id=?', (identity,)).fetchone()
        if row is None:
            raise HTTPException(404, 'Unknown artifact')
        artifact = dict(row)
        try:
            return content_path(db, study, artifact)
        except HTTPException as error:
            # All path/privacy checks run before a missing-content result.
            if error.status_code != 404:
                raise
        root = dataset_roots(db, study)[artifact['dataset_id']]
        runner(['datalad', 'get', '--', artifact['path']], cwd=root, check=True)
        return content_path(db, study, artifact)
