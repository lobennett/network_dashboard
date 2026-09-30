import json
import sqlite3
import pytest

from test_api import study, client


def test_completed_reference_is_visible_without_replacing_active_campaign(study):
    root, index = study
    reference = {'label': 'Completed s03 pilot', 'study_commit': 'pilot-commit',
                 'projects': {'fmriprep': 'references/pilot/derivatives/fMRIPrep-25.2.5+pilot'},
                 'decisions': []}
    with sqlite3.connect(index) as db:
        db.execute('CREATE TABLE artifact_observations (artifact_id TEXT,commit_hash TEXT,availability TEXT)')
        db.execute('INSERT INTO metadata VALUES (?,?)', ('active_projects', json.dumps({'fmriprep': {'path': 'derivatives/fMRIPrep-25.2.5+current'}})))
        db.execute('INSERT INTO metadata VALUES (?,?)', ('reference_stages', json.dumps({'s03': {'fmriprep': reference}})))
        db.execute("INSERT INTO artifacts VALUES (1,'references/pilot/derivatives/fMRIPrep-25.2.5+pilot','dataset:pilot','dataset',NULL)")
        db.execute("INSERT INTO artifact_versions VALUES ('pilot-report','pilot','sub-s03.html','sha256:report','{}')")
        db.execute("INSERT INTO artifact_observations VALUES ('pilot-report','pilot-commit','unavailable')")
        db.execute("INSERT INTO stage_attempts VALUES ('fmriprep','dataset','ready')")
    c = client(study)
    result = c.get('/api/subjects/s03/stages/fmriprep').json()
    assert [f['id'] for f in result['outputs']] == ['pilot-report']
    assert result['reference']['study_commit'] == 'pilot-commit'
    assert c.get('/api/subjects/s03').json()['attempts'][-1]['state'] == 'ready'
    assert c.get('/api/subjects/s03').json()['reference_stages']['fmriprep']['label'] == 'Completed s03 pilot'


def test_reference_never_overrides_available_current_outputs(study):
    root, index = study
    with sqlite3.connect(index) as db:
        db.execute('CREATE TABLE artifact_observations (artifact_id TEXT,commit_hash TEXT,availability TEXT)')
        db.execute('INSERT INTO metadata VALUES (?,?)', ('active_projects', json.dumps({'fmriprep': {'path': 'derivatives/fMRIPrep-25.2.5+current'}})))
        db.execute('INSERT INTO metadata VALUES (?,?)', ('reference_stages', json.dumps({'s03': {'fmriprep': {'label':'Pilot','projects':{'fmriprep':'references/pilot/derivatives/fMRIPrep-25.2.5+pilot'}}}})))
        for n, path in [('current','derivatives/fMRIPrep-25.2.5+current'),('pilot','references/pilot/derivatives/fMRIPrep-25.2.5+pilot')]:
            db.execute('INSERT INTO artifacts VALUES (?,?,?,?,?)',(1,path,'dataset:'+n,'dataset',None))
            db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',(n,n,'sub-s03.html','sha256:report','{}'))
            db.execute('INSERT INTO artifact_observations VALUES (?,?,?)',(n,'commit','unavailable'))
    result = client(study).get('/api/subjects/s03/stages/fmriprep').json()
    assert [f['id'] for f in result['outputs']] == ['current']
    assert result.get('reference') is None


def test_reference_import_preserves_campaign_and_original_content_identities(tmp_path):
    from network_dashboard.references import import_reference
    schema = '''
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE entities(entity_key TEXT PRIMARY KEY,subject TEXT);
    CREATE TABLE stage_attempts(stage TEXT,scope TEXT,state TEXT);
    CREATE TABLE decisions(id INTEGER PRIMARY KEY,entity_key TEXT,scope TEXT,decision TEXT);
    CREATE TABLE findings(id INTEGER PRIMARY KEY,entity_key TEXT,finding_type TEXT,evidence_path TEXT,evidence_json TEXT);
    CREATE TABLE artifacts(id INTEGER PRIMARY KEY,stage TEXT,path TEXT,entity_key TEXT,kind TEXT,commit_hash TEXT);
    CREATE TABLE artifact_versions(id TEXT PRIMARY KEY,dataset_id TEXT,path TEXT,content_id TEXT,source_ids TEXT);
    CREATE TABLE artifact_observations(artifact_id TEXT,commit_hash TEXT,availability TEXT,PRIMARY KEY(artifact_id,commit_hash,availability));
    CREATE TABLE processing_attempts(id TEXT PRIMARY KEY,stage TEXT,scope TEXT,status TEXT,evidence_json TEXT);
    CREATE TABLE lineage_links(input TEXT,attempt TEXT,output TEXT,relation TEXT,PRIMARY KEY(input,attempt,output,relation));
    '''
    main, pilot, output = [tmp_path / n for n in ('main.sqlite','pilot.sqlite','combined.sqlite')]
    for path, identity in [(main,'main'),(pilot,'pilot')]:
        with sqlite3.connect(path) as db:
            db.executescript(schema)
            db.executemany('INSERT INTO metadata VALUES (?,?)',[('study_id',identity),('study_commit',identity+'-commit'),('schema_version','2'),('active_projects',json.dumps({'fmriprep':{'path':'derivatives/fMRIPrep-25+full+'+identity}}))])
            db.execute("INSERT INTO entities VALUES ('scan','s03')")
            db.execute('INSERT INTO stage_attempts VALUES (?,?,?)',('fmriprep','dataset','ready' if identity=='main' else 'complete'))
            db.execute('INSERT INTO decisions VALUES (1,?,?,?)',('scan','output','pending' if identity=='main' else 'approved'))
    with sqlite3.connect(pilot) as db:
        db.execute("INSERT INTO artifacts VALUES (1,'dataset','derivatives/fMRIPrep-25+full+pilot',NULL,'dataset:outputs','output-commit')")
        db.execute("INSERT INTO artifact_versions VALUES ('report','outputs','sub-s03.html','sha256:original','{}')")
        db.execute("INSERT INTO artifact_observations VALUES ('report','output-commit','available')")
        db.execute("INSERT INTO findings VALUES (1,'scan','fmriprep-output-check','receipt.json','{}')")
    import_reference(main,pilot,output,subject='s03',mount='references/pilot',label='Completed s03 pilot')
    with sqlite3.connect(output) as db:
        assert db.execute('SELECT state FROM stage_attempts').fetchall()==[('ready',)]
        assert db.execute('SELECT decision FROM decisions').fetchall()==[('pending',)]
        assert db.execute("SELECT content_id FROM artifact_versions WHERE id='report'").fetchone()[0]=='sha256:original'
        metadata=dict(db.execute('SELECT * FROM metadata'))
        assert metadata['study_commit']=='main-commit'
        reference=json.loads(metadata['reference_stages'])['s03']['registration']
        assert reference['decisions'][0]['decision']=='approved'
        assert reference['study_commit']=='pilot-commit'
    with pytest.raises(ValueError):
        import_reference(main,pilot,output,subject='s03',mount='../pilot',label='Pilot')
