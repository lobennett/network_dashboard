import json
import sqlite3
from test_api import study, client


def test_conversion_files_do_not_include_trimmed_versions_or_later_metrics(study):
    with sqlite3.connect(study[1]) as db:
        db.execute('CREATE TABLE artifact_observations (artifact_id TEXT,commit_hash TEXT,availability TEXT)')
        for identity, path in [('dicom','sub-s03/source.dicom.zip'),('converted','sub-s03/ses-11/func/sub-s03_ses-11_task-rest_bold.nii.gz'),('trimmed','sub-s03/ses-11/func/sub-s03_ses-11_task-rest_bold.nii.gz')]:
            db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',(identity,'study',path,'sha256:'+identity,'{}'))
        db.execute('INSERT INTO processing_attempts VALUES (?,?)',('convert',json.dumps({'id':'convert','stage':'conversion','scope':'sub-s03','software':{'dcm2niix':'1.0'},'status':'success'})))
        db.execute('INSERT INTO processing_attempts VALUES (?,?)',('trim',json.dumps({'id':'trim','stage':'trim_dummy','scope':'sub-s03','status':'success'})))
        db.executemany('INSERT INTO lineage_links VALUES (?,?,?,?)',[('dicom','converted','convert','conversion'),('converted','trimmed','trim','trim_dummy')])
        db.execute('INSERT INTO findings VALUES (?,?,?)',('scan','mriqc',json.dumps({'fd_mean':0.3})))
    response=client(study).get('/api/subjects/s03/stages/bids')
    assert response.status_code==200
    value=response.json()
    assert {f['id'] for f in value['outputs']}=={'converted'}
    assert {f['id'] for f in value['inputs']}=={'dicom'}
    assert value['findings']==[] and value['decisions']==[]
    assert value['processing'][0]['software']=={'dcm2niix':'1.0'}
    trim=client(study).get('/api/subjects/s03/stages/trim').json()
    assert {f['id'] for f in trim['outputs']}=={'trimmed'}
    assert trim['decisions']==[]


def test_stage_artifact_search_cannot_fall_back_to_current_files(study):
    result=client(study).get('/api/artifacts?subject=s03&stage=bids')
    assert result.status_code==200
    assert result.json()==[]
    assert client(study).get('/api/subjects/s03/stages/unknown').status_code==422


def test_dataset_wide_attempt_only_shows_inputs_for_this_subject(study):
    with sqlite3.connect(study[1]) as db:
        for identity, path in [('ours-in','sub-s03/source.zip'),('other-in','sub-s04/source.zip'),('ours-out','sub-s03/scan_bold.nii.gz'),('other-out','sub-s04/scan_bold.nii.gz'),('shared','template.nii.gz')]:
            db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',(identity,'study',path,'sha256:'+identity,'{}'))
        db.execute('INSERT INTO processing_attempts VALUES (?,?)',('dataset',json.dumps({'id':'dataset','stage':'conversion','scope':'dataset'})))
        db.executemany('INSERT INTO lineage_links VALUES (?,?,?,?)',[('ours-in','ours-out','dataset','conversion'),('other-in','other-out','dataset','conversion'),('shared','ours-out','dataset','conversion')])
    value=client(study).get('/api/subjects/s03/stages/bids').json()
    assert {f['id'] for f in value['inputs']}=={'ours-in','shared'}
    assert {f['id'] for f in value['outputs']}=={'ours-out'}


def test_trim_summary_uses_verified_global_signal_tables_not_mriqc(study):
    import hashlib
    root,index=study
    with sqlite3.connect(index) as db:
        db.execute('CREATE TABLE artifact_observations (artifact_id TEXT,commit_hash TEXT,availability TEXT)')
        for label,n in [('pretrim',100),('posttrim',93)]:
            path=root/f'derivatives/gs-{label}/gs_metrics.tsv'
            path.parent.mkdir(parents=True)
            path.write_text(f'subject\tsession\ttask\trun\tn_volumes\nsub-s03\tses-11\tstopSignalWDirectedForgetting\t1\t{n}\nsub-s04\tses-11\trest\t1\t999\n')
            identity=label
            db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',(identity,'study',path.relative_to(root).as_posix(),'sha256:'+hashlib.sha256(path.read_bytes()).hexdigest(),'{}'))
            db.execute('INSERT INTO artifact_observations VALUES (?,?,?)',(identity,'commit','available'))
    response=client(study).get('/api/subjects/s03/trim')
    assert response.status_code==200
    result=response.json()
    assert len(result['scans'])==1
    assert result['scans'][0]['before']==100
    assert result['scans'][0]['after']==93
    assert result['scans'][0]['removed']==7
    assert {f['id'] for f in client(study).get('/api/subjects/s03/stages/trim').json()['outputs']}=={'pretrim','posttrim'}
    (root/'derivatives/gs-pretrim/gs_metrics.tsv').write_text('tampered')
    result=client(study).get('/api/subjects/s03/trim').json()
    assert result['scans'][0]['before'] is None
    assert result['errors']


def test_b0_linkage_has_its_own_stage_not_events(study):
    with sqlite3.connect(study[1]) as db:
        db.execute('INSERT INTO processing_attempts VALUES (?,?)', ('b0',json.dumps({'id':'b0','stage':'b0-fieldmaps-linked','scope':'dataset','status':'success'})))
    c=client(study)
    response=c.get('/api/subjects/s03/stages/b0')
    assert response.status_code==200
    assert response.json()['processing'][0]['stage']=='b0-fieldmaps-linked'
    assert c.get('/api/subjects/s03/stages/events').json()['processing']==[]


def test_b0_check_verifies_current_sidecars_without_claiming_stage_history(study):
    import hashlib
    root,index=study
    from network_dashboard.records import dataset_roots,connect
    with connect(index) as db:
        dataset=next(iter(dataset_roots(db,root).items()))
    dataset_id,directory=dataset
    with sqlite3.connect(index) as db:
        db.execute("INSERT INTO artifacts VALUES (1,'sourcedata/raw',?,'dataset',NULL)",('dataset:'+dataset_id,))
        db.execute('CREATE TABLE artifact_observations (artifact_id TEXT,commit_hash TEXT,availability TEXT)')
        directory=root/'sourcedata/raw'
        for name,value in [('func/sub-s03_ses-11_task-rest_run-1_echo-2_bold.json',{'B0FieldSource':'ses11'}),('fmap/sub-s03_ses-11_fieldmap.json',{'B0FieldIdentifier':'ses11'})]:
            path='sub-s03/ses-11/'+name
            target=directory/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(value))
            identity='bold' if '/func/' in path else 'fmap'
            db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',(identity,dataset_id,path,'sha256:'+hashlib.sha256(target.read_bytes()).hexdigest(),'{}'))
            db.execute('INSERT INTO artifact_observations VALUES (?,?,?)',(identity,'commit','available'))
    c=client(study)
    inventory=c.get('/api/subjects/s03/b0').json()
    assert inventory['basis']=='Current checksum-verified sidecars; not a historical stage snapshot.'
    assert len(inventory['scans'])==1
    result=c.get('/api/subjects/s03/b0/bold').json()
    assert result['echoes'][0]['status']=='Matched'
    assert result['echoes'][0]['source']==['ses11']
    fmap=directory/'sub-s03/ses-11/fmap/sub-s03_ses-11_fieldmap.json'
    fmap.write_text(json.dumps({'B0FieldIdentifier':'another-session'}))
    with sqlite3.connect(index) as db:
        db.execute('UPDATE artifact_versions SET content_id=? WHERE id=?',('sha256:'+hashlib.sha256(fmap.read_bytes()).hexdigest(),'fmap'))
    assert c.get('/api/subjects/s03/b0/bold').json()['echoes'][0]['status']=='No matching fieldmap'
    target=directory/'sub-s03/ses-11/func/sub-s03_ses-11_task-rest_run-1_echo-2_bold.json'
    target.write_text('{}')
    result=c.get('/api/subjects/s03/b0/bold').json()
    assert result['echoes'][0]['status']=='Unavailable'
