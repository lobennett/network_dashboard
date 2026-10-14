from pathlib import Path
from unittest.mock import patch

from test_api import study, client
from test_coverage import db, file


def test_stage_classifies_reference_roots_once_per_dataset(study):
    import sqlite3

    with sqlite3.connect(study[1]) as connection:
        connection.executemany('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', [
            (str(index), 'study', f'sub-s03/scan-{index}_bold.nii.gz', 'sha256:none', '{}')
            for index in range(100)
        ])
    original = Path.is_relative_to
    calls = []

    def counted(path, other):
        calls.append((path, other))
        return original(path, other)

    with patch.object(Path, 'is_relative_to', counted):
        response = client(study).get('/api/subjects/s03/stages/bids')
    assert response.status_code == 200
    assert len(calls) < 10


def test_coverage_keeps_duplicate_names_and_run_boundaries(db):
    from network_dashboard.coverage import study_coverage

    base = 'sub-s03/ses-01/func/sub-s03_ses-01_task-goNogo_run-1'
    for echo in (1, 2, 3):
        for extension in ('.nii.gz', '.json'):
            file(db, base + f'_echo-{echo}_bold' + extension)
    file(db, base + '_events.tsv')
    file(db, 'another-directory/' + base.split('/')[-1] + '_events.tsv', dataset='other')
    file(db, base.replace('run-1', 'run-10') + '_events.tsv')
    result = study_coverage(db, 's03')
    scan = next(scan for scan in result['scans'] if scan['run'] == '1')
    assert scan['missing_files'] == []
    assert scan['events_status'] == 'Indexed'
