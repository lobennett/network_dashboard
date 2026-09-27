"""A conservative checklist derived from the current indexed evidence."""

import json
from pathlib import PurePosixPath

from fastapi import HTTPException

from .coverage import study_coverage
from .records import rows
from .reports import is_subject_report, reports_complete


def latest_state(attempts, stage, subject):
    relevant = [
        a
        for a in attempts
        if a["stage"] == stage and a["scope"] in {f"sub-{subject}", "dataset"}
    ]
    # The producer supplies current attempts explicitly; log paths are not job identities.
    specific = [a for a in relevant if a["scope"] == f"sub-{subject}"]
    dataset = max(
        (a for a in relevant if a["scope"] == "dataset"),
        key=lambda a: a.get("attempt", 0),
        default={},
    )
    current = max(specific or relevant, key=lambda a: a.get("attempt", 0), default={})
    if (
        dataset.get("state") in {"ready", "blocked", "pending", "queued"}
        and not specific
    ):
        current = dataset
    state = str(current.get("state", "")).lower()
    if state in {"success", "complete", "merged"}:
        return "complete"
    if state in {
        "failed",
        "error",
        "f",
        "timeout",
        "cancelled",
        "intervention-required",
    }:
        return "failed"
    if state in {"r", "running", "active"}:
        return "running"
    if state in {"pd", "pending", "queued", "ready", "blocked"}:
        return "pending"
    return "unrecorded"


def subject_completion(db, subject):
    entities = rows(db, "SELECT * FROM entities WHERE subject=?", (subject,))
    if not entities:
        raise HTTPException(404, "Unknown subject")
    keys = {e["entity_key"] for e in entities}
    attempts = rows(db, "SELECT * FROM stage_attempts")
    findings = [
        f for f in rows(db, "SELECT * FROM findings") if f["entity_key"] in keys
    ]
    decisions = [
        d for d in rows(db, "SELECT * FROM decisions") if d["entity_key"] in keys
    ]
    coverage = study_coverage(db, subject)
    metadata = dict(db.execute("SELECT key,value FROM metadata"))
    active = json.loads(metadata.get("active_projects", "{}"))
    active_attempts = json.loads(metadata.get("active_attempts", "null"))
    project = active.get("fmriprep", {})
    current_path = project.get("path")
    datasets = {
        d["kind"][8:]: d["path"]
        for d in rows(db, "SELECT * FROM artifacts WHERE kind LIKE 'dataset:%'")
    }
    files = rows(
        db,
        "SELECT DISTINCT a.* FROM artifact_versions a JOIN artifact_observations o ON o.artifact_id=a.id WHERE o.commit_hash IS NOT NULL AND o.availability IN ('available','unavailable')",
    )
    for file in files:
        file["study_path"] = str(
            PurePosixPath(datasets.get(file["dataset_id"], ".")) / file["path"]
        )

    def evidence(*suffixes):
        return [
            {"id": f["id"], "path": f["study_path"]}
            for f in files
            if any(f["study_path"].endswith(s) for s in suffixes)
        ]

    def state(stage):
        current = [a for a in (active_attempts or []) if a["stage"] == stage]
        if stage in active:
            # Older indexes with no explicit active jobs cannot establish subject success.
            current = current or [
                a for a in attempts if a["stage"] == stage and a["scope"] == "dataset"
            ]
        return latest_state(
            current if current or stage in active else attempts, stage, subject
        )

    checks = []

    def add(key, title, status, detail, stage, proof=()):
        checks.append(
            {
                "id": key,
                "title": title,
                "status": status,
                "detail": detail,
                "stage": stage,
                "evidence": list(proof),
            }
        )

    def milestone(key, title, producer, stage, detail):
        add(
            key,
            title,
            state(producer),
            detail,
            stage,
            evidence(f"/milestones/{producer}.json"),
        )

    sources = [f for f in findings if f["finding_type"] == "flywheel-acquisition"]
    add(
        "source",
        "Flywheel inventory",
        "complete" if sources else "unrecorded",
        f"{len(sources)} acquisition records. A current inventory is not proof of an earlier conversion.",
        "source",
        evidence(f"/selection/sub-{subject}.json"),
    )
    gaps = [s for s in coverage["scans"] if s["status"] == "Missing scan files"]
    add(
        "raw",
        "BIDS scan files",
        "failed" if gaps else "complete" if coverage["scans"] else "unrecorded",
        f"{len(gaps)} scans with missing expected files; {len(coverage['scans'])} recorded scans checked. See Data completeness for filenames.",
        "bids",
    )
    add(
        "defacing",
        "Anatomical defacing",
        state("defacing"),
        "Recorded defacing receipt; image access separately checks the image checksum and ancestry.",
        "bids",
        evidence(f"/defacing/sub-{subject}.json"),
    )
    milestone(
        "trim",
        "Trimming and global signal",
        "gs-posttrim",
        "trim",
        "Post-trim milestone; canonical inputs must not be trimmed again.",
    )
    task_runs = [s for s in coverage["scans"] if s["events_status"] != "Not applicable"]
    missing = [s for s in task_runs if s["events_status"] == "Missing"]
    exceptions = [
        s for s in task_runs if s["events_status"] == "Missing (reviewed exception)"
    ]
    add(
        "events",
        "Events and behavioral exceptions",
        "failed" if missing else "complete" if task_runs else "unrecorded",
        f"{len(missing)} unexplained missing event files; {len(exceptions)} reviewed exception(s). Exceptions retain BOLD and constrain analysis use.",
        "events",
        evidence(
            "/behavioral_exceptions.tsv",
            "/analysis_exclusions.tsv",
            "/milestones/bids-events-generated.json",
        ),
    )
    milestone(
        "b0", "B0 fieldmap linkage", "b0-fieldmaps-linked", "b0",
        "Recorded linking milestone. Use Check links to verify current sidecar identifiers per scan.",
    )
    milestone(
        "precuration-validation", "Prepared BIDS validation", "bids-precuration-validated", "b0",
        "Validation after B0 linking, before MRIQC and FreeSurfer.",
    )
    milestone(
        "validation",
        "Curated BIDS validation",
        "bids-curated-validated",
        "review",
        "Recorded validator milestone; inspect the report for warnings and issues.",
    )
    checks[-1]["evidence"] += evidence(
        "/desc-curated_validation.json", "/desc-fieldmaprepair_validation.json"
    )
    add(
        "mriqc",
        "MRIQC processing",
        state("mriqc"),
        "Latest recorded subject attempt; scan approval is checked separately.",
        "mriqc",
    )
    reviews = [
        json.loads(f["evidence_json"])
        for f in findings
        if f["finding_type"] == "scan-review"
    ]
    unapproved = sum(
        r.get("approval_required") == "yes" and r.get("approved") != "yes"
        for r in reviews
    )
    unresolved = sum(
        d["scope"] == "preprocessing"
        and d["decision"] not in {"keep", "drop", "exclude"}
        for d in decisions
    )
    approved = (
        state("scan-decisions-approved") == "complete"
        and bool(reviews)
        and not (unapproved or unresolved)
    )
    add(
        "scan-review",
        "Scan decisions",
        "complete" if approved else "review",
        f"{unapproved} required approvals outstanding; preprocessing and task-model decisions remain separate.",
        "review",
        evidence("/scan_decisions.tsv", "/milestones/scan-decisions-approved.json"),
    )
    surface_state = state("freesurfer")
    surface_approved = any(
        d["scope"] == "surface" and d["decision"] == "yes" for d in decisions
    )
    add(
        "surfaces",
        "FreeSurfer surfaces and approval",
        "complete"
        if surface_state == "complete"
        and surface_approved
        and state("surface-review-approved") == "complete"
        else "review"
        if surface_state == "complete"
        else surface_state,
        "Requires the subject’s reconstruction and recorded surface approval; legacy anatomical runs do not satisfy this check.",
        "surfaces",
        evidence("/surface_review.tsv", "/milestones/surface-review-approved.json"),
    )
    add(
        "fmriprep",
        "fMRIPrep processing",
        state("fmriprep"),
        "Latest recorded subject state. A successful job does not establish report availability or output review.",
        "fmriprep",
    )
    output_checks = [
        json.loads(f["evidence_json"])
        for f in findings
        if f["finding_type"] == "fmriprep-output-check"
        and (
            not current_path
            or (
                str(f.get("evidence_path") or "").startswith(current_path + "+review/")
                and project.get("commit") is not None
                and json.loads(f["evidence_json"]).get("source_commit")
                == project["commit"]
            )
        )
    ]
    reports = [
        {"id": f["id"], "path": f["study_path"]}
        for f in files
        if is_subject_report(f["path"], subject)
        and current_path
        and output_checks
        and f["study_path"].startswith(current_path + "+review/")
    ]
    add(
        "reports",
        "fMRIPrep reports",
        "complete" if reports_complete(
            {PurePosixPath(r["path"]).name for r in reports}, subject,
            [run for check in output_checks for run in check.get("runs", [])],
        ) else "pending",
        "Current anatomical and session reports; historical and archived-only reports do not count.",
        "fmriprep",
        reports,
    )
    issues = [issue for f in output_checks for issue in f.get("issues", [])]
    add(
        "alignment",
        "Output lengths and TRs",
        "failed"
        if issues
        else "complete"
        if current_path and output_checks and all(f.get("runs") for f in output_checks)
        else "unrecorded",
        "; ".join(issues)
        if issues
        else "Checks BOLD/CIFTI lengths, confound rows and TRs against trimmed inputs. This does not validate an analysis-specific design.",
        "fmriprep",
        [
            e
            for e in evidence("/fmriprep-evidence.json")
            if current_path and e["path"].startswith(current_path + "+review/")
        ],
    )
    registration_roots = []
    for finding in findings:
        if finding["finding_type"] != "registration-output":
            continue
        value = json.loads(finding["evidence_json"])
        if (
            current_path
            and value.get("source_project") == current_path
            and project.get("commit")
            and value.get("source_commit") == project["commit"]
        ):
            registration_roots.append(finding["evidence_path"].split("/code/")[0])
    registration = [
        {"id": f["id"], "path": f["study_path"]}
        for f in files
        if any(f["study_path"].startswith(root + "/") for root in registration_roots)
        and f["path"] == f"sub-{subject}/sub-{subject}_desc-registration.html"
    ]
    add(
        "registration",
        "Registration viewer",
        "complete"
        if registration and state("fmriprepviz") == "complete"
        else "pending",
        "fmriprepviz output using the approved FreeSurfer ribbon; visual inspection remains required.",
        "registration",
        registration,
    )
    final_reviews = [json.loads(f["evidence_json"]) for f in findings
                     if f["finding_type"] == "final-output-review"]
    current_reviews = [r for r in final_reviews if current_path and project.get("commit")
                       and r.get("inputs", {}).get("source_project") == current_path
                       and r.get("inputs", {}).get("source_commit") == project["commit"]]
    review = max(current_reviews, key=lambda r: r.get("reviewed_at", ""), default={})
    approved = review.get("decision") == "approved"
    rejected = review.get("decision") == "needs-correction"
    add(
        "final-review",
        "Final output review",
        "complete" if approved else "failed" if rejected else "review",
        (f"{'Approved' if approved else 'Needs correction'} by {review['reviewer']} · {review['reviewed_at']}"
         + (f" — {review['notes']}" if review.get("notes") else "")) if review else
        "Inspect fMRIPrep reports and registration before release. Record approval or a correction request with processing review-output.",
        "registration",
        evidence(f"/output_review/sub-{subject}.json"),
    )
    return {
        "subject": subject,
        "snapshot": metadata,
        "status": "complete" if all(c["status"] == "complete" for c in checks)
        else "awaiting-review"
        if not rejected and all(c["status"] == "complete" for c in checks[:-1])
        else "incomplete",
        "checks": checks,
        "note": "Snapshot evidence, not live job status or approval for every analysis. Indexed files are checksum-verified when opened.",
    }
