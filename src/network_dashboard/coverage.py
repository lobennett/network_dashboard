"""Compare recorded acquisition expectations with the current tracked inventory."""

import json
import re
from pathlib import PurePosixPath
from .records import rows

FIELDS = ("subject", "session", "datatype", "task", "run", "acquisition", "suffix")
LABELS = {
    "sub": "subject",
    "ses": "session",
    "task": "task",
    "acq": "acquisition",
    "run": "run",
    "echo": "echo",
}


def identity(path):
    parts = PurePosixPath(path).parts
    name = re.sub(r"\.(nii\.gz|nii|json|csv|tsv)$", "", parts[-1])
    values = {
        LABELS[k]: v
        for k, v in re.findall(r"(?:^|_)(sub|ses|task|run|acq|echo)-([^_]+)", name)
    }
    if values.get("run", "").isdigit():
        values["run"] = str(int(values["run"]))
    values["datatype"] = next(
        (p for p in parts if p in {"anat", "func", "fmap", "beh"}), ""
    )
    values["suffix"] = name.split("_")[-1] if "-" not in name.split("_")[-1] else ""
    return values


def key(scan):
    return tuple(str(scan.get(k) or "") for k in FIELDS)


def prefix(scan):
    name = "_".join(
        f"{label}-{scan[field]}"
        for label, field in LABELS.items()
        if label != "echo" and scan.get(field)
    )
    folder = "/".join(
        x
        for x in (
            f"sub-{scan['subject']}",
            f"ses-{scan['session']}" if scan.get("session") else "",
            scan["datatype"],
        )
        if x
    )
    return folder + "/" + name


def study_coverage(db, subject=None):
    entities = rows(db, "SELECT * FROM entities")
    subjects = sorted(
        {
            e["subject"]
            for e in entities
            if e.get("subject") and (subject is None or e["subject"] == subject)
        }
    )
    targets = {
        key(e): dict(e)
        for e in entities
        if e.get("namespace") == "raw"
        and not e.get("echo")
        and e.get("suffix") in {"bold", "T1w", "T2w", "fieldmap", "magnitude"}
        and e["subject"] in subjects
    }
    findings = rows(db, "SELECT * FROM findings")
    entity_subjects = {e['entity_key']: e.get('subject') for e in entities}
    skipped = 0
    for f in findings:
        if f["finding_type"] != "flywheel-acquisition":
            continue
        acquisition = json.loads(f["evidence_json"])
        path = acquisition.get("bids_prefix")
        source_subject = identity(path).get('subject') if path else entity_subjects.get(f['entity_key'])
        if source_subject in subjects and acquisition.get('decision') == 'skipped':
            skipped += 1
            continue
        if not path:
            continue
        scan = identity(path)
        if scan.get("subject") not in subjects:
            continue
        if acquisition.get("decision") != "selected":
            continue
        suffixes = {"func": ["bold"], "fmap": ["fieldmap", "magnitude"]}.get(
            scan["datatype"], [scan["suffix"]]
        )
        for suffix in suffixes:
            if suffix not in {"bold", "T1w", "T2w", "fieldmap", "magnitude"}:
                continue
            expected = {**scan, "suffix": suffix}
            targets.setdefault(key(expected), expected)
    datasets = rows(db, "SELECT path,kind FROM artifacts WHERE kind LIKE 'dataset:%'")
    raw_ids = {
        d["kind"][8:]
        for d in datasets
        if d["path"] in {"sourcedata/raw", "sourcedata/rawbids"}
    }
    # Historical lineage is not proof that a file remains in the canonical dataset.
    files = rows(
        db,
        "SELECT DISTINCT a.* FROM artifact_versions a JOIN artifact_observations o ON o.artifact_id=a.id WHERE o.commit_hash IS NOT NULL AND o.availability IN ('available','unavailable')",
    )
    behavior_datasets = {
        d["kind"][8:]: d["path"].split("/")[-1]
        for d in datasets
        if "/behavioral/" in d["path"]
    }
    behavior_sources = []
    for file in files:
        setting = behavior_datasets.get(file["dataset_id"])
        scan = identity(file["path"])
        if not setting or scan.get("subject") not in subjects:
            continue
        behavior_sources.append(
            {**file, "setting": setting, "subject": scan["subject"]}
        )
        if setting == "in_scanner" and file["path"].endswith("_beh.csv"):
            expected = {**scan, "datatype": "func", "suffix": "bold"}
            targets.setdefault(key(expected), expected)
    imaging = {}
    for f in files:
        if f["dataset_id"] not in raw_ids or not f["path"].startswith("sub-"):
            continue
        scan = identity(f["path"])
        if scan.get("subject") not in subjects or scan["suffix"] not in {
            "bold",
            "T1w",
            "T2w",
            "fieldmap",
            "magnitude",
            "events",
        }:
            continue
        imaging.setdefault(key(scan), []).append((scan, f))
        if scan["suffix"] != "events":
            targets.setdefault(key(scan), {**scan, "echo": None})
    reviews = {
        f["entity_key"]: json.loads(f["evidence_json"])
        for f in findings
        if f["finding_type"] == "scan-review"
    }
    truncations = {
        f["entity_key"]: json.loads(f["evidence_json"])
        for f in findings
        if f["finding_type"] == "behavior-truncation"
    }
    decisions = rows(db, "SELECT * FROM decisions")
    output = []
    for ident, scan in sorted(targets.items()):
        scan["echo"] = None
        entity_key = scan.get("entity_key")
        review = reviews.get(entity_key, {})
        found = imaging.get(ident, [])
        # A subject-level missing-anatomy record is satisfied by that anatomy in any session.
        if scan["datatype"] == "anat" and not scan.get("session"):
            found = [
                pair
                for k, values in imaging.items()
                if k[0] == scan["subject"] and k[-1] == scan["suffix"]
                for pair in values
            ]
        paths = {f["path"] for _, f in found}
        observed = sorted(
            {
                s["echo"]
                for s, f in found
                if s.get("echo") and f["path"].endswith((".nii", ".nii.gz"))
            }
        )
        base = prefix(scan)
        missing = []
        stems = (
            [base + f"_echo-{echo}_bold" for echo in ("1", "2", "3")]
            if scan["suffix"] == "bold"
            else [base + "_" + scan["suffix"]]
        )
        for stem in stems:
            if scan["datatype"] == "anat" and not scan.get("session") and found:
                continue
            if not ({stem + ".nii.gz", stem + ".nii"} & paths):
                missing.append(stem + ".nii.gz")
            if stem + ".json" not in paths:
                missing.append(stem + ".json")
        scoped = (
            {d["scope"]: d for d in decisions if d["entity_key"] == entity_key}
            if entity_key
            else {}
        )
        processing = scoped.get("preprocessing", {})
        task = scoped.get("task_first_level", {})
        event_key = (*ident[:-1], "events")
        events = [
            f
            for _, f in imaging.get(event_key, [])
            if f["path"].endswith("_events.tsv")
        ]
        behavior = review.get("behavioral_status", "unrecorded")
        not_task = scan["suffix"] != "bold" or scan.get("task") == "rest"
        candidates = [
            f
            for f in files
            if PurePosixPath(f["path"]).name.startswith(base.split("/")[-1] + "_")
        ]
        behavior_files = [
            f
            for f in candidates
            if f["path"].endswith("_beh.csv")
            and behavior_datasets.get(f["dataset_id"]) == "in_scanner"
        ]
        designs = [
            f
            for f in candidates
            if re.search(
                r"(?:designmatrix|design_matrix|design-matrix).*\.(csv|tsv)$",
                f["path"],
                re.I,
            )
        ]
        output.append(
            {
                **scan,
                "prefix": base,
                "observed_echoes": observed,
                "missing_files": missing,
                "status": "Excluded from preprocessing"
                if processing.get("decision") in {"drop", "exclude"}
                else "Missing scan files"
                if missing
                else "Scan files indexed",
                "events_status": "Not applicable"
                if not_task
                else "Indexed"
                if events
                else "Missing (reviewed exception)"
                if behavior == "reviewed_exception"
                else "Missing",
                "behavior_status": "Not applicable"
                if not_task
                else "Indexed"
                if behavior_files
                else {
                    "available": "Available (review record)",
                    "reviewed_exception": "Reviewed exception",
                }.get(behavior, "Unrecorded"),
                "task_first_level": "Not applicable"
                if not_task
                else "Excluded"
                if task.get("decision") == "exclude"
                else "No exclusion recorded",
                "exclusion_reason": task.get("reason"),
                "preprocessing_reason": processing.get("reason"),
                "events": events,
                "behavior_files": behavior_files,
                "designs": designs,
                "truncation": truncations.get(entity_key, {}),
                "flags": review.get("flags", ""),
            }
        )
    return {
        "subjects": subjects,
        "scans": output,
        "skipped_acquisitions": skipped,
        "behavior_sources": sorted(
            behavior_sources, key=lambda f: (f["setting"], f["path"])
        ),
        "basis": "Recorded Flywheel selections, in-scanner behavioral files, current raw files and review records; BOLD requires echoes 1–3 and JSON sidecars. No complete protocol inventory is recorded here, so wholly unrecorded acquisitions and subjects are unknown, not confirmed missing.",
        "inventory_note": "Indexed means tracked in this snapshot, not downloaded or verified readable on Oak.",
    }
