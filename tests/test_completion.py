"""Completion claims require matching evidence, never just a successful job."""

import json

from test_coverage import db, file


def setup(db):
    db.executescript("""
    CREATE TABLE metadata(key TEXT,value TEXT);
    INSERT INTO metadata VALUES ('study_commit','commit'),('built_at','2026-09-25T00:00:00+00:00');
    CREATE TABLE stage_attempts(stage TEXT,scope TEXT,attempt INTEGER,state TEXT);
    """)
    return db


def item(result, key):
    return next(r for r in result["checks"] if r["id"] == key)


def test_a_completed_job_without_reports_is_not_a_completed_handoff(db):
    from network_dashboard.completion import subject_completion

    setup(db)
    db.execute("INSERT INTO stage_attempts VALUES ('fmriprep','sub-s03',1,'complete')")
    result = subject_completion(db, "s03")
    assert item(result, "fmriprep")["status"] == "complete"
    assert item(result, "reports")["status"] == "pending"
    assert item(result, "alignment")["status"] == "unrecorded"
    assert item(result, "final-review")["status"] == "review"
    assert result["status"] == "incomplete"


def test_latest_attempt_and_subject_approval_control_the_checklist(db):
    from network_dashboard.completion import subject_completion

    setup(db)
    db.executemany(
        "INSERT INTO stage_attempts VALUES (?,?,?,?)",
        [
            ("freesurfer", "sub-s03", 1, "failed"),
            ("freesurfer", "sub-s03", 2, "complete"),
            ("surface-review-approved", "dataset", 1, "success"),
        ],
    )
    result = subject_completion(db, "s03")
    assert (
        item(result, "surfaces")["status"] == "review"
    )  # A dataset milestone alone is insufficient.
    db.execute(
        "INSERT INTO entities VALUES ('surface','anatomical','s03',NULL,NULL,NULL,NULL,NULL,NULL,'surface')"
    )
    db.execute("INSERT INTO decisions VALUES ('surface','surface','yes','LB approved')")
    assert item(subject_completion(db, "s03"), "surfaces")["status"] == "complete"
    db.execute("INSERT INTO stage_attempts VALUES ('freesurfer','sub-s03',3,'failed')")
    assert item(subject_completion(db, "s03"), "surfaces")["status"] == "failed"


def test_missing_behavior_exception_does_not_block_preprocessing(db):
    from network_dashboard.completion import subject_completion

    setup(db)
    db.execute(
        "INSERT INTO findings VALUES (?,?,?)",
        (
            "scan",
            "scan-review",
            json.dumps({"behavioral_status": "reviewed_exception"}),
        ),
    )
    result = subject_completion(db, "s03")
    assert item(result, "events")["status"] == "complete"
    assert "exception" in item(result, "events")["detail"]


def test_output_mismatch_is_visible_and_historical_reports_do_not_count(db):
    from network_dashboard.completion import subject_completion

    setup(db)
    db.execute(
        "INSERT INTO artifacts VALUES ('derivatives/fMRIPrep-25.2.5+full+pilot+review','dataset:fmri','dataset')"
    )
    file(db, "sub-s03.html", dataset="fmri", status="historical")
    db.execute(
        "INSERT INTO findings VALUES (?,?,?)",
        (
            "scan",
            "fmriprep-output-check",
            json.dumps({"issues": ["run-1: confound rows mismatch"], "runs": []}),
        ),
    )
    result = subject_completion(db, "s03")
    assert item(result, "alignment")["status"] == "failed"
    assert "confound rows" in item(result, "alignment")["detail"]
    assert item(result, "reports")["status"] == "pending"


def test_completion_endpoint_is_subject_scoped(db, tmp_path):
    import sqlite3
    from fastapi.testclient import TestClient
    from network_dashboard.api import create_app

    setup(db)
    db.commit()
    index = tmp_path / "records.sqlite"
    with sqlite3.connect(index) as target:
        db.backup(target)
    client = TestClient(create_app(index, tmp_path))
    response = client.get("/api/subjects/s03/completion")
    assert response.status_code == 200
    assert response.json()["subject"] == "s03"
    assert client.get("/api/subjects/s04/completion").status_code == 404


def test_current_campaign_does_not_inherit_old_results(db):
    from network_dashboard.completion import subject_completion

    setup(db)
    db.execute("ALTER TABLE stage_attempts ADD COLUMN log_path TEXT")
    db.execute("ALTER TABLE findings ADD COLUMN evidence_path TEXT")
    db.execute(
        "INSERT INTO metadata VALUES (?,?)",
        (
            "active_projects",
            json.dumps(
                {
                    "fmriprep": {
                        "path": "derivatives/fMRIPrep-25.2.5+full+new",
                        "commit": "newcommit",
                    }
                }
            ),
        ),
    )
    db.execute(
        "INSERT INTO stage_attempts VALUES ('fmriprep','sub-s03',1,'complete','derivatives/fMRIPrep-25.2.5+full+old/logs')"
    )
    db.execute(
        "INSERT INTO stage_attempts VALUES ('fmriprep','dataset',1,'ready',NULL)"
    )
    db.execute(
        "INSERT INTO artifacts VALUES ('derivatives/fMRIPrep-25.2.5+full+old+review','dataset:old','dataset')"
    )
    file(db, "sub-s03.html", dataset="old")
    db.execute(
        "INSERT INTO findings VALUES (?,?,?,?)",
        (
            "scan",
            "fmriprep-output-check",
            json.dumps({"source_commit": "oldcommit", "runs": [{}], "issues": []}),
            "derivatives/fMRIPrep-25.2.5+full+old+review/code/network_fmri/fmriprep-evidence.json",
        ),
    )
    result = subject_completion(db, "s03")
    assert item(result, "fmriprep")["status"] == "pending"
    assert item(result, "reports")["status"] == "pending"
    assert item(result, "alignment")["status"] == "unrecorded"


def test_current_failed_attempt_does_not_depend_on_log_path(db):
    from network_dashboard.completion import subject_completion

    setup(db)
    for log in (None, "logs/10.log", "/scratch/project/logs/10.log"):
        current = [
            dict(
                stage="fmriprep",
                scope="sub-s03",
                attempt=1,
                state="failed",
                log_path=log,
            ),
            dict(stage="fmriprep", scope="dataset", attempt=1, state="active"),
        ]
        db.execute("DELETE FROM metadata WHERE key='active_attempts'")
        db.execute(
            "INSERT INTO metadata VALUES (?,?)",
            ("active_attempts", json.dumps(current)),
        )
        assert item(subject_completion(db, "s03"), "fmriprep")["status"] == "failed"
