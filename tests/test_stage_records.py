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
