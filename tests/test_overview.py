"""Study status must distinguish missing evidence, active work and manual gates."""
import json
import sqlite3
from test_api import study,client


def test_overview_keeps_unindexed_roster_and_analysis_exclusions_distinct(study):
    with sqlite3.connect(study[1]) as db:
        db.execute('INSERT INTO metadata VALUES (?,?)',('expected_subjects',json.dumps(['s03','s10'])))
        db.execute("INSERT INTO stage_attempts VALUES ('mriqc','sub-s03','running')")
    response=client(study).get('/api/overview')
    assert response.status_code==200
    value=response.json()
    assert value['expected_subjects']==2 and value['indexed_subjects']==1
    ours=next(s for s in value['subjects'] if s['subject']=='s03')
    missing=next(s for s in value['subjects'] if s['subject']=='s10')
    assert ours['status']=='Running'
    assert ours['task_excluded']==1 and ours['preprocessing_excluded']==0
    assert missing['status']=='Not indexed'
    assert value['snapshot']['built_at']


def test_failed_job_is_not_hidden_by_an_older_success(study):
    with sqlite3.connect(study[1]) as db:
        db.execute("INSERT INTO stage_attempts VALUES ('fmriprep-complete','sub-s03','success')")
        db.execute("INSERT INTO stage_attempts VALUES ('fmriprep','sub-s03','failed')")
    value=client(study).get('/api/overview').json()
    assert value['subjects'][0]['status']=='Failed'


def test_exclusions_export_includes_upstream_acquisitions_and_model_scope(study):
    with sqlite3.connect(study[1]) as db:
        db.execute('INSERT INTO findings VALUES (?,?,?)',('scan','flywheel-acquisition',json.dumps({'decision':'skipped','reason':'qa-reject','label':'T1w','session':'11','acquisition_id':'abc'})))
    response=client(study).get('/api/exclusions')
    assert response.status_code==200
    rows=response.json()['rows']
    source=next(r for r in rows if r['stage']=='source')
    task=next(r for r in rows if r['scope']=='task_first_level')
    assert source['reason']=='qa-reject' and source['scope']=='source_acquisition'
    assert task['stage']=='review' and task['preprocessing']=='keep'
    text=client(study).get('/api/exclusions?format=tsv').text
    assert 'source_acquisition' in text and 'task_first_level' in text


def test_completed_subject_overrides_dataset_campaign_placeholder(study):
    with sqlite3.connect(study[1]) as db:
        db.execute("INSERT INTO stage_attempts VALUES ('fmriprep','dataset','blocked')")
        db.execute("INSERT INTO stage_attempts VALUES ('fmriprep-complete','sub-s03','success')")
    value=client(study).get('/api/overview').json()['subjects'][0]
    assert value['stages']['fmriprep']=='Complete'
