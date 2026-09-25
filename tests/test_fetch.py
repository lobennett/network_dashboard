import hashlib
import sqlite3
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from test_api import study


def test_fetch_rejects_original_anatomy_before_running_datalad(study):
    from network_dashboard.fetch import fetch_artifact
    with sqlite3.connect(study[1]) as db:
        db.execute("INSERT INTO artifact_versions VALUES ('original','study','sub-s03_T1w.nii.gz','sha256:missing','{}')")
    runner=Mock()
    with pytest.raises(HTTPException,match='defacing'):
        fetch_artifact(study[1],study[0],'original',runner=runner)
    runner.assert_not_called()


def test_fetch_only_retrieves_registered_missing_file_and_verifies_bytes(study):
    from network_dashboard.fetch import fetch_artifact
    root,index=study
    path=root/'report.html';data=path.read_bytes();path.unlink()
    def run(command,**kwargs):
        assert command == ['datalad','get','--','report.html']
        assert kwargs['cwd'] == root
        path.write_bytes(data)
    assert fetch_artifact(index,root,'report',runner=run)==path
