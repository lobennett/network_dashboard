import hashlib
import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def study(tmp_path):
    root = tmp_path / "study"
    root.mkdir()
    report = root / "report.html"
    report.write_text("<h1>Report</h1>")
    index = tmp_path / "records.sqlite"
    with sqlite3.connect(index) as db:
        db.executescript('''
        CREATE TABLE metadata (key TEXT, value TEXT);
        CREATE TABLE entities (entity_key TEXT, subject TEXT, session TEXT, task TEXT);
        CREATE TABLE stage_attempts (stage TEXT, scope TEXT, state TEXT);
        CREATE TABLE findings (entity_key TEXT, finding_type TEXT, evidence_json TEXT);
        CREATE TABLE decisions (entity_key TEXT, scope TEXT, decision TEXT);
        CREATE TABLE artifacts (id INTEGER, path TEXT, kind TEXT, stage TEXT, commit_hash TEXT);
        CREATE TABLE artifact_versions (id TEXT, dataset_id TEXT, path TEXT, content_id TEXT, source_ids TEXT);
        CREATE TABLE lineage_links (input TEXT, output TEXT, attempt TEXT, relation TEXT);
        CREATE TABLE processing_attempts (id TEXT, evidence_json TEXT);
        INSERT INTO metadata VALUES ('schema_version','2'),('study_id','study'),('built_at','2026-01-01T00:00:00Z');
        INSERT INTO entities VALUES ('scan','s03','11','stopSignalWDirectedForgetting');
        INSERT INTO decisions VALUES ('scan','preprocessing','keep'),('scan','task_first_level','exclude');
        INSERT INTO stage_attempts VALUES ('anatomical','sub-s03','active');
        ''')
        db.execute("INSERT INTO artifact_versions VALUES (?,?,?,?,?)", ("report", "study", "report.html",
            "sha256:" + hashlib.sha256(report.read_bytes()).hexdigest(), "{}"))
    return root, index


def client(study):
    from network_dashboard.api import create_app
    return TestClient(create_app(index=study[1], study=study[0]))


def test_subject_keeps_analysis_and_preprocessing_decisions_separate(study):
    response = client(study).get("/api/subjects/s03")
    assert response.status_code == 200
    assert {row["scope"]: row["decision"] for row in response.json()["decisions"]} == {
        "preprocessing": "keep", "task_first_level": "exclude"}


def test_metadata_exposes_refresh_age_and_source(study):
    result = client(study).get("/api/metadata").json()
    assert result["schema_version"] == "2"
    assert result["stale"] is True
    assert result["conversion_links"] == 0


def test_content_is_registered_hashed_and_sandboxed(study):
    response = client(study).get("/api/artifacts/report/content")
    assert response.status_code == 200
    assert "sandbox" in response.headers["content-security-policy"]
    assert client(study).get("/api/artifacts/unknown/content").status_code == 404
    (study[0] / "report.html").write_text("changed")
    assert client(study).get("/api/artifacts/report/content").status_code == 409


@pytest.mark.parametrize("path", ["../secret.txt", "/etc/passwd", "scan.dcm", "scan.zip", "sub-s03_T1w.nii.gz"])
def test_unsafe_or_unverified_content_is_forbidden(study, path):
    with sqlite3.connect(study[1]) as db:
        db.execute("UPDATE artifact_versions SET path=? WHERE id='report'", (path,))
    assert client(study).get("/api/artifacts/report/content").status_code == 403


def test_subject_query_cannot_inject_sql(study):
    assert client(study).get("/api/subjects/s03%27%20OR%201=1--").status_code == 404


@pytest.mark.parametrize('suffix', ['fieldmap', 'magnitude'])
def test_fieldmap_pair_is_viewable_without_anatomical_defacing(study, suffix):
    root, index = study
    path = root / f'sub-s03/ses-01/fmap/sub-s03_ses-01_run-1_{suffix}.nii.gz'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'fieldmap')
    with sqlite3.connect(index) as db:
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',
                   ('fmap', 'study', path.relative_to(root).as_posix(),
                    'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest(), '{}'))
    assert client(study).get('/api/artifacts/fmap/content').status_code == 200


def test_unregistered_symlink_target_is_forbidden(study, tmp_path):
    report = study[0] / "report.html"
    report.unlink()
    outside = tmp_path / "private.html"
    outside.write_text("private")
    report.symlink_to(outside)
    assert client(study).get("/api/artifacts/report/content").status_code == 403


def test_report_embeds_registered_local_figures_without_external_requests(study):
    root,index = study
    report = root / 'report.html'
    report.write_text('<html><body><object data="./plot.svg" type="image/svg+xml"></object></body></html>')
    svg = root / 'plot.svg'
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"><text>QC</text></svg>')
    with sqlite3.connect(index) as db:
        db.execute("UPDATE artifact_versions SET content_id=? WHERE id='report'", ('sha256:'+hashlib.sha256(report.read_bytes()).hexdigest(),))
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',('figure','study','plot.svg','sha256:'+hashlib.sha256(svg.read_bytes()).hexdigest(),'{}'))
    response=client(study).get('/api/artifacts/report/content')
    assert response.status_code == 200
    assert 'data:image/svg+xml;base64,' in response.text
    assert '<object' not in response.text
    svg.write_text('changed')
    assert client(study).get('/api/artifacts/report/content').status_code == 409


@pytest.mark.parametrize('tag', ['<object data="sub-s03/figures/plot.svg"></object>', '<img src="./sub-s03/figures/plot.svg"/>'])
def test_report_can_read_figures_from_its_verified_result_archive(study, tag):
    import json, zipfile
    root,index = study
    report=root/'report.html'
    report.write_text(tag)
    source=root/'derivatives/origin';source.mkdir(parents=True)
    archive=source/'results.zip'
    with zipfile.ZipFile(archive,'w') as z:
        z.writestr('MRIQC/report.html',report.read_bytes())
        z.writestr('MRIQC/sub-s03/figures/plot.svg','<svg xmlns="http://www.w3.org/2000/svg"/>')
    receipt=root/'code/network_fmri/mriqc-evidence.json';receipt.parent.mkdir(parents=True)
    receipt.write_text(json.dumps({'source_dataset_id':'source','archives':[{
        'path':'results.zip','sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}]}))
    with sqlite3.connect(index) as db:
        db.execute("UPDATE artifact_versions SET content_id=? WHERE id='report'",('sha256:'+hashlib.sha256(report.read_bytes()).hexdigest(),))
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',('receipt','study',receipt.relative_to(root).as_posix(),'sha256:'+hashlib.sha256(receipt.read_bytes()).hexdigest(),'{}'))
        db.execute("INSERT INTO artifacts VALUES (1,'derivatives/origin','dataset:source','dataset',NULL)")
    response=client(study).get('/api/artifacts/report/content')
    assert response.status_code == 200
    assert 'data:image/svg+xml;base64,' in response.text
    with archive.open('ab') as stream: stream.write(b'changed')
    assert client(study).get('/api/artifacts/report/content').status_code == 409


@pytest.mark.parametrize("headers", [
    {"Origin": "https://untrusted.example"},
    {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
    {"Host": "untrusted.example"},
])
def test_other_websites_cannot_read_local_study(study, headers):
    assert client(study).get("/api/subjects", headers=headers).status_code in (400, 403)


def test_same_origin_requests_and_range_reads_work(study):
    response = client(study).get("/api/artifacts/report/content", headers={
        "Origin": "http://testserver", "Range": "bytes=0-3"})
    assert response.status_code == 206
    assert response.content == b"<h1>"


def test_subject_includes_session_jobs_but_not_other_subjects(study):
    with sqlite3.connect(study[1]) as db:
        db.executemany("INSERT INTO stage_attempts VALUES (?,?,?)", [
            ("mriqc", "sub-s03/ses-11", "failed"),
            ("mriqc", "sub-s030/ses-11", "running")])
    result = client(study).get("/api/subjects/s03").json()
    assert [(a["scope"], a["state"]) for a in result["attempts"]] == [
        ("sub-s03", "active"), ("sub-s03/ses-11", "failed")]


@pytest.mark.parametrize("relation", ["fmriprep", "dependency"])
def test_one_defaced_input_does_not_clear_another_undefaced_image(study, relation):
    root, index = study
    paths = {"safe": "sub-s03_T1w.nii.gz", "unsafe": "sub-s03_T2w.nii.gz", "output": "sub-s03_desc-preproc_T2w.nii.gz"}
    for identity, path in paths.items():
        (root / path).write_bytes(b"safe" if identity == "safe" else b"undefaced")
    with sqlite3.connect(index) as db:
        for identity, path in paths.items():
            db.execute("INSERT INTO artifact_versions VALUES (?,?,?,?,?)", (
                identity, "study", path, "sha256:" + hashlib.sha256((root / path).read_bytes()).hexdigest(), "{}"))
        db.executemany("INSERT INTO lineage_links VALUES (?,?,?,?)", [
            ("safe", "output", "attempt", relation), ("unsafe", "output", "attempt", relation)])
    receipt = root / "code/network_fw2bids/defacing/sub-s03.json"
    receipt.parent.mkdir(parents=True)
    import json
    receipt.write_text(json.dumps({"status": "success", "images": [
        {"path": paths["safe"], "output_sha256": hashlib.sha256(b"safe").hexdigest()}]}))
    assert client(study).get("/api/artifacts/safe/content").status_code == 200
    assert client(study).get("/api/artifacts/output/content").status_code == 403


def test_preview_search_marks_missing_and_unsafe_files_without_serving_them(study):
    with sqlite3.connect(study[1]) as db:
        db.executemany('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', [
            ('missing','study','missing_bold.nii.gz','sha256:absent','{}'),
            ('unsafe','study','sub-s03_T1w.nii.gz','sha256:absent','{}')])
    result = client(study).get('/api/artifacts?preview=true').json()
    availability = {r['id']:r['preview_available'] for r in result}
    assert availability == {'missing':False,'report':True,'unsafe':False}
    assert 'defacing' in next(r for r in result if r['id']=='unsafe')['preview_reason']


def test_stage_files_include_subject_level_outputs_without_neighbor_subjects(study):
    with sqlite3.connect(study[1]) as db:
        db.execute("INSERT INTO artifacts VALUES (2,'derivatives/FreeSurfer-8.2.0','dataset:fs','dataset',NULL)")
        db.executemany('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', [
            ('surface','fs','subjects/sub-s03/surf/lh.white','sha256:missing','{}'),
            ('neighbor','fs','subjects/sub-s030/surf/lh.white','sha256:missing','{}'),
            ('raw','study','sub-s03/ses-01/sub-s03_T1w.nii.gz','sha256:missing','{}')])
    result = client(study).get('/api/artifacts?subject=s03&dataset_stage=freesurfer').json()
    assert [r['id'] for r in result] == ['surface']


def test_fmriprep_acquisition_and_subject_report_are_filtered_before_limit(study):
    with sqlite3.connect(study[1]) as db:
        db.execute("INSERT INTO artifacts VALUES (2,'derivatives/fMRIPrep-25.2.5+pilot','dataset:fprep','dataset',NULL)")
        db.executemany('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', [
            ('early','fprep','sub-s03/ses-01/func/sub-s03_ses-01_task-rest_bold.nii.gz','sha256:missing','{}'),
            ('later','fprep','sub-s03/ses-11/func/sub-s03_ses-11_task-rest_bold.nii.gz','sha256:missing','{}'),
            ('subject-report','fprep','sub-s03.html','sha256:missing','{}')])
    result = client(study).get('/api/artifacts?subject=s03&dataset_stage=fmriprep&q=sub-s03_ses-11_task-rest_&include_subject_report=true&limit=2').json()
    assert {r['id'] for r in result} == {'later','subject-report'}


def test_only_explicit_shared_frontend_can_read_local_api(study):
    from network_dashboard.api import create_app
    shared = TestClient(create_app(study[1], study[0], allowed_origins=['https://network.example.org']))
    headers={'Origin':'https://network.example.org','Sec-Fetch-Site':'cross-site'}
    response=shared.get('/api/subjects',headers=headers)
    assert response.status_code==200
    assert response.headers['access-control-allow-origin']=='https://network.example.org'
    assert shared.get('/api/subjects',headers={'Origin':'https://attacker.example'}).status_code==403
    response=shared.options('/api/subjects',headers={**headers,'Access-Control-Request-Method':'GET','Access-Control-Request-Private-Network':'true'})
    assert response.status_code==200
    assert response.headers['access-control-allow-private-network']=='true'
