import json
import sqlite3

from test_api import study, client


def test_tree_follows_transitive_inputs_and_stops_cycles(study):
    with sqlite3.connect(study[1]) as db:
        for name in ('source', 'converted'):
            db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', (name, 'study', name+'.nii.gz', 'sha256:'+'a'*64, '{}'))
        for name in ('conversion', 'trim_dummy'):
            db.execute('INSERT INTO processing_attempts VALUES (?,?)', (name, json.dumps({'id': name, 'stage': name, 'software': {'network_fmri': '0.1.0'}})))
        db.executemany('INSERT INTO lineage_links VALUES (?,?,?,?)', [
            ('source', 'converted', 'conversion', 'conversion'),
            ('converted', 'report', 'trim_dummy', 'trim_dummy'),
            ('report', 'source', 'conversion', 'conversion'),
        ])
    response = client(study).get('/api/artifacts/report/tree')
    assert response.status_code == 200
    tree = response.json()
    assert {row['id'] for row in tree['artifacts']} == {'source', 'converted', 'report'}
    assert len(tree['links']) == 3
    assert len(tree['attempts']) == 2
    assert not tree['truncated']
    assert client(study).get('/api/artifacts/missing/tree').status_code == 404
