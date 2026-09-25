import json
import sqlite3

from network_dashboard.manifest import subject_manifest, scan_tsv


def test_manifest_keeps_analysis_exclusion_separate_and_does_not_invent_approval():
    db = sqlite3.connect(':memory:'); db.row_factory = sqlite3.Row
    db.executescript('''
    CREATE TABLE metadata(key,value);
    INSERT INTO metadata VALUES ('study_commit','abc123'),('built_at','2026-09-25T00:00:00Z');
    CREATE TABLE entities(entity_key,namespace,subject,session,task,run,acquisition,suffix,echo);
    INSERT INTO entities VALUES ('scan','raw','s03','11','stopSignalWDirectedForgetting','1',NULL,'bold',NULL),
       ('other','raw','s03','01','goNogo','1',NULL,'bold',NULL),
       ('echo','raw','s03','01','goNogo','1',NULL,'bold','2');
    CREATE TABLE findings(entity_key,finding_type,evidence_json);
    CREATE TABLE decisions(entity_key,scope,decision,reason,reviewer);
    INSERT INTO decisions VALUES ('scan','preprocessing','keep',NULL,'LB'),
       ('scan','task_first_level','exclude','Nonmonotonic onsets','LB');
    CREATE TABLE processing_attempts(evidence_json);
    CREATE TABLE artifacts(path,kind,commit_hash);
    INSERT INTO artifacts VALUES ('sourcedata/raw','dataset:raw','def456');
    CREATE TABLE artifact_versions(id,dataset_id,path,content_id);
    CREATE TABLE artifact_observations(artifact_id,commit_hash,availability);
    ''')
    db.execute('INSERT INTO findings VALUES (?,?,?)', ('scan','scan-review',json.dumps({'original_tr_count':'100','tr_count':'93','approved':'yes'})))
    result = subject_manifest(db, 's03')
    assert len(result['scans']) == 2
    scan = next(r for r in result['scans'] if r['session'] == '11')
    assert scan['preprocessing'] == 'keep' and scan['task_first_level'] == 'exclude'
    assert scan['timeseries_analysis'] == 'no_decision_recorded'
    assert scan['volumes_removed'] == 7
    other = next(r for r in result['scans'] if r['session'] == '01')
    assert other['preprocessing'] == 'unrecorded' and other['task_first_level'] == 'no_exclusion_recorded'
    assert other['volumes_removed'] is None
    assert result['datasets'][0]['commit_hash'] == 'def456'
    text = scan_tsv(result)
    assert 'abc123' in text and 'Nonmonotonic onsets' in text
    db.close()
