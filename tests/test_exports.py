import sqlite3
import json
from network_dashboard.exports import analysis_manifest,analysis_tsv


def database():
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    db.executescript('''
    CREATE TABLE metadata(key,value); INSERT INTO metadata VALUES ('study_commit','abc'),('built_at','today');
    CREATE TABLE entities(entity_key,namespace,subject,session,task,run,acquisition,suffix,echo);
    INSERT INTO entities VALUES ('one','raw','s03','01','goNogo','1',NULL,'bold',NULL),('two','raw','s03','02','goNogo','1',NULL,'bold',NULL),('rest','raw','s03','01','rest','1',NULL,'bold',NULL);
    CREATE TABLE stage_attempts(stage,scope,state); INSERT INTO stage_attempts VALUES ('scan-decisions-approved','dataset','success');
    CREATE TABLE findings(entity_key,finding_type,evidence_json);
    CREATE TABLE decisions(entity_key,scope,decision,reason,reviewer);
    INSERT INTO decisions VALUES ('one','preprocessing','keep',NULL,'LB'),('one','task_first_level','exclude','timing','LB'),('two','preprocessing','drop','aborted','LB');
    CREATE TABLE artifacts(path,kind,commit_hash);
    CREATE TABLE artifact_versions(id,dataset_id,path,content_id);
    CREATE TABLE artifact_observations(artifact_id,commit_hash,availability);
    ''')
    for n,name in enumerate(['echo-1_bold.nii.gz','space-T1w_desc-preproc_bold.nii.gz','desc-confounds_timeseries.tsv','events.tsv']):
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?)',(str(n),'raw','sub-s03_ses-01_task-goNogo_run-1_'+name,'sha256:'+str(n)))
        db.execute('INSERT INTO artifact_observations VALUES (?,?,?)',(str(n),'commit','available'))
    for identity, path in [('oldtwo','sub-s03_ses-02_task-goNogo_run-1_echo-1_bold.nii.gz'),('restbold','sub-s03_ses-01_task-rest_run-1_echo-1_bold.nii.gz')]:
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?)',(identity,'raw',path,'sha256:old'))
        db.execute('INSERT INTO artifact_observations VALUES (?,?,?)',(identity,None,'historical'))
    return db


def test_scope_exclusions_propagate_without_inventing_approval():
    db=database()
    pre=analysis_manifest(db,'preprocessing');task=analysis_manifest(db,'task_first_level');ts=analysis_manifest(db,'timeseries')
    selected=lambda m,key:next(s for s in m['scans'] if s['entity_key']==key)
    assert selected(pre,'one')['selection']=='candidate'
    assert selected(task,'one')['selection']=='excluded'
    assert selected(ts,'one')['selection']=='candidate'
    assert selected(task,'two')['selection']=='excluded'
    assert selected(task,'two')['reasons']==['aborted']
    assert selected(ts,'rest')['selection']=='undecided'
    assert selected(task,'rest')['selection']=='not_applicable'
    assert selected(ts,'one')['inputs']['preprocessed_bold'][0]['commit_hash']=='commit'


def test_filters_and_missing_inputs_and_tsv():
    db=database();db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    db.execute("UPDATE artifact_observations SET availability='unavailable' WHERE artifact_id='3'")
    result=analysis_manifest(db,'task_first_level',subject='sub-s03',task='goNogo')
    assert len(result['scans'])==2
    first=next(s for s in result['scans'] if s['entity_key']=='one')
    assert first['selection']=='missing_inputs' and first['missing_inputs']==['events']
    assert 'study_commit' in analysis_tsv(result) and 'abc' in analysis_tsv(result)


def test_archived_derivatives_are_not_reported_missing():
    db=database();db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    db.execute("DELETE FROM artifact_versions WHERE id='1'")
    db.execute('CREATE TABLE archived_inputs(archive_id,member,path,details)')
    path='sub-s03_ses-01_task-goNogo_run-1_space-T1w_desc-preproc_bold.nii.gz'
    details={'path':path,'availability':'archived','archive_content_id':'sha256:archive','commit_hash':'sourcecommit','dataset_id':'fmriprep'}
    db.execute('INSERT INTO archived_inputs VALUES (?,?,?,?)',('zip','fMRIPrep/'+path,path,json.dumps(details)))
    confounds='sub-s03_ses-01_task-goNogo_run-1_desc-confounds_timeseries.tsv'
    db.execute('INSERT INTO archived_inputs VALUES (?,?,?,?)',('zip','fMRIPrep/'+confounds,confounds,json.dumps({**details,'path':confounds})))
    scan=analysis_manifest(db,'task_first_level')['scans'][0]
    assert scan['selection']=='candidate_archived'
    assert scan['missing_inputs']==[]
    assert scan['inputs']['preprocessed_bold'][0]['archive_member']=='fMRIPrep/'+path


def test_padded_run_names_match_and_mixed_campaign_inputs_do_not():
    db=database();db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    db.execute("UPDATE artifact_versions SET path=replace(path,'run-1','run-01')")
    assert analysis_manifest(db,'task_first_level')['scans'][0]['selection']=='candidate'
    db.execute("UPDATE artifact_versions SET dataset_id='different-campaign' WHERE id='2'")
    db.execute('CREATE TABLE archived_inputs(archive_id,member,path,details)')
    assert analysis_manifest(db,'task_first_level')['scans'][0]['selection']=='inventory_pending'


def test_partial_decision_is_reported_and_blocks_ambiguous_candidates():
    db=database();db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    db.execute("INSERT INTO entities VALUES ('partial','raw','s03',NULL,'goNogo',NULL,NULL,'bold',NULL)")
    db.execute("INSERT INTO decisions VALUES ('partial','task_first_level','exclude','Needs run ID','LB')")
    result=analysis_manifest(db,'task_first_level')
    assert len(result['scans'])==3
    assert next(s for s in result['scans'] if s['entity_key']=='one')['selection']=='undecided'
    assert result['unmatched_decisions'][0]['entity_key']=='partial'
    assert 'unmatched_decision' in analysis_tsv(result)


def test_legacy_snapshot_does_not_claim_archived_data_are_missing():
    db=database()
    db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    db.execute("DELETE FROM artifact_versions WHERE id='1'")
    assert analysis_manifest(db,'task_first_level')['scans'][0]['selection']=='inventory_pending'


def test_draft_keep_and_pending_flags_are_not_approval():
    db=database()
    db.execute("DELETE FROM stage_attempts")
    assert analysis_manifest(db,'preprocessing')['scans'][0]['selection']=='undecided'
    db.execute("INSERT INTO stage_attempts VALUES ('scan-decisions-approved','dataset','success')")
    db.execute("INSERT INTO findings VALUES ('one','scan-review',?)",(json.dumps({'approval_required':'yes','approved':'no'}),))
    assert analysis_manifest(db,'preprocessing')['scans'][0]['selection']=='undecided'


def test_task_filter_keeps_subject_level_exclusions():
    db=database();db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    db.execute("INSERT INTO entities VALUES ('partial','raw','s03',NULL,NULL,NULL,NULL,'bold',NULL)")
    db.execute("INSERT INTO decisions VALUES ('partial','task_first_level','exclude','Subject exclusion','LB')")
    result=analysis_manifest(db,'task_first_level',task='goNogo')
    assert result['unmatched_decisions'][0]['entity_key']=='partial'
    assert result['scans'][0]['selection']=='undecided'


def test_archive_inventory_is_per_scan_and_absence_is_explicit():
    db=database();db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    db.execute("DELETE FROM artifact_versions WHERE id='1'")
    db.execute('CREATE TABLE archived_inputs(archive_id,member,path,details)')
    assert analysis_manifest(db,'task_first_level')['scans'][0]['selection']=='inventory_pending'
    path='sub-s03_ses-01_task-goNogo_run-1_space-T1w_desc-preproc_bold.nii.gz'
    value={'path':path,'availability':'archived_unavailable','archive_content_id':'sha256:zip'}
    db.execute('INSERT INTO archived_inputs VALUES (?,?,?,?)',('zip','missing',path,json.dumps(value)))
    assert analysis_manifest(db,'task_first_level')['scans'][0]['selection']=='archived_unavailable'


def test_multiple_complete_campaigns_require_a_choice():
    db=database();db.execute("DELETE FROM decisions WHERE scope='task_first_level'")
    for identity in ['1','2']:
        row=db.execute('SELECT path,content_id FROM artifact_versions WHERE id=?',(identity,)).fetchone()
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?)',('other'+identity,'other',*row))
        db.execute('INSERT INTO artifact_observations VALUES (?,?,?)',('other'+identity,'othercommit','available'))
    scan=analysis_manifest(db,'task_first_level')['scans'][0]
    assert scan['selection']=='ambiguous_derivative_set'
    assert scan['inputs']['preprocessed_bold']==[]
    assert len(scan['derivative_sets'])==2
