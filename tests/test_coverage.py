import json
import sqlite3
import pytest
from network_dashboard.coverage import study_coverage


@pytest.fixture
def db():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript("""
    CREATE TABLE entities(entity_key TEXT,namespace TEXT,subject TEXT,session TEXT,datatype TEXT,task TEXT,run TEXT,acquisition TEXT,echo TEXT,suffix TEXT);
    CREATE TABLE findings(entity_key TEXT,finding_type TEXT,evidence_json TEXT);
    CREATE TABLE decisions(entity_key TEXT,scope TEXT,decision TEXT,reason TEXT);
    CREATE TABLE artifacts(path TEXT,kind TEXT,stage TEXT);
    CREATE TABLE artifact_versions(id TEXT,dataset_id TEXT,path TEXT,content_id TEXT);
    CREATE TABLE artifact_observations(artifact_id TEXT,commit_hash TEXT,availability TEXT);
    INSERT INTO artifacts VALUES ('sourcedata/raw','dataset:raw','raw');
    INSERT INTO entities VALUES ('scan','raw','s03','01','func','goNogo','1',NULL,NULL,'bold');
    """)
    return db


def file(db, path, status="available", dataset="raw"):
    db.execute(
        "INSERT INTO artifact_versions VALUES (?,?,?,?)",
        (path, dataset, path, "sha256:aaa"),
    )
    db.execute(
        "INSERT INTO artifact_observations VALUES (?,?,?)",
        (path, "commit" if status != "historical" else None, status),
    )


def test_echo_missing_is_explicit_and_historical_content_does_not_hide_it(db):
    base = "sub-s03/ses-01/func/sub-s03_ses-01_task-goNogo_run-1"
    for echo in (1, 3):
        for ext in (".nii.gz", ".json"):
            file(db, base + f"_echo-{echo}_bold" + ext)
    file(db, base + "_echo-2_bold.nii.gz", "historical")
    result = study_coverage(db)["scans"][0]
    assert result["observed_echoes"] == ["1", "3"]
    assert result["missing_files"] == [
        base + "_echo-2_bold.nii.gz",
        base + "_echo-2_bold.json",
    ]
    assert result["events_status"] == "Missing"
    assert result["behavior_status"] == "Unrecorded"


def test_skipped_acquisition_is_not_reported_as_missing(db):
    db.execute('INSERT INTO findings VALUES (?,?,?)', ('scan', 'flywheel-acquisition', json.dumps({'decision':'skipped','bids_prefix':None,'reason':'localizer'})))
    for decision, run in [("selected", "2"), ("skipped", "3")]:
        db.execute(
            "INSERT INTO findings VALUES (?,?,?)",
            (
                "scan",
                "flywheel-acquisition",
                json.dumps(
                    {
                        "decision": decision,
                        "reason": "qa-reject" if decision == "skipped" else "dicom",
                        "bids_prefix": f"sub-s03/ses-01/fmap/sub-s03_ses-01_run-{run}",
                    }
                ),
            ),
        )
    results = study_coverage(db)
    fmaps = [r for r in results["scans"] if r["datatype"] == "fmap"]
    assert len(fmaps) == 2
    assert {r["suffix"] for r in fmaps} == {"fieldmap", "magnitude"}
    assert all(r["run"] == "2" for r in fmaps)
    assert results["skipped_acquisitions"] == 2


def test_preprocessing_drop_and_task_exclusion_remain_distinct(db):
    db.execute(
        "INSERT INTO decisions VALUES ('scan','preprocessing','drop','Reviewed false start')"
    )
    result = study_coverage(db)["scans"][0]
    assert result["status"] == "Excluded from preprocessing"
    db.execute("DELETE FROM decisions")
    db.execute(
        "INSERT INTO decisions VALUES ('scan','task_first_level','exclude','Nonmonotonic timing')"
    )
    result = study_coverage(db)["scans"][0]
    assert result["status"] == "Missing scan files"
    assert result["task_first_level"] == "Excluded"
    assert result["exclusion_reason"] == "Nonmonotonic timing"


def test_behavior_without_imaging_is_a_gap_but_out_of_scanner_is_separate(db):
    db.execute(
        "INSERT INTO artifacts VALUES ('sourcedata/raw/sourcedata/behavioral/in_scanner','dataset:behavior','raw')"
    )
    db.execute(
        "INSERT INTO artifacts VALUES ('sourcedata/raw/sourcedata/behavioral/out_of_scanner','dataset:outside','raw')"
    )
    file(
        db,
        "sub-s03/ses-02/beh/sub-s03_ses-02_task-nBack_run-1_beh.csv",
        dataset="behavior",
    )
    file(db, "sub-s03/beh/sub-s03_task-survey_beh.csv", dataset="outside")
    result = study_coverage(db)
    orphan = next(s for s in result["scans"] if s.get("task") == "nBack")
    assert orphan["status"] == "Missing scan files"
    assert orphan["behavior_status"] == "Indexed"
    assert len(orphan["missing_files"]) == 6
    assert not any(s.get("task") == "survey" for s in result["scans"])
    assert {f["setting"] for f in result["behavior_sources"]} == {
        "in_scanner",
        "out_of_scanner",
    }


def test_anatomical_acquisition_prefix_matches_bids_order(db):
    path = "sub-s03/ses-01/anat/sub-s03_ses-01_acq-MPRAGE_run-1_T1w"
    file(db, path + ".nii.gz")
    file(db, path + ".json")
    scan = next(s for s in study_coverage(db)["scans"] if s["suffix"] == "T1w")
    assert scan["missing_files"] == []
