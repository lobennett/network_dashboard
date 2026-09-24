"""Serve registered file versions, enforcing content and anatomical privacy."""
import hashlib
import json
from pathlib import Path
import subprocess

from fastapi import HTTPException

from network_dashboard.records import dataset_roots


def content_path(db, study: Path, artifact: dict) -> Path:
    relative = Path(artifact["path"])
    name = relative.name
    if relative.is_absolute() or ".." in relative.parts or "\\" in str(relative):
        raise HTTPException(403, "File path is outside the allowed dataset")
    if not name.endswith((".html", ".json", ".tsv", ".txt", ".log", ".pdf", ".png", ".jpg",
                          ".nii", ".nii.gz", ".mgz", ".white", ".pial", ".inflated", ".gii", ".svg")):
        raise HTTPException(403, "This file type is not served")
    roots = dataset_roots(db, study)
    root = roots.get(artifact["dataset_id"])
    if root is None:
        raise HTTPException(403, "Content is not in a registered local dataset")
    root = root.resolve()
    image = name.endswith((".nii", ".nii.gz", ".mgz", ".white", ".pial", ".inflated", ".gii"))
    if image and not name.endswith(("_bold.nii", "_bold.nii.gz")):
        if not _has_defacing_evidence(db, artifact, roots):
            raise HTTPException(403, "Image preview requires recorded defacing evidence")
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        # Worktree/submodule annex stores can live outside their working trees.
        try:
            gitdir = subprocess.check_output(("git", "rev-parse", "--absolute-git-dir"),
                                            cwd=root, text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
        except (OSError, subprocess.SubprocessError):
            gitdir = ""
        if not gitdir or not target.is_relative_to((Path(gitdir) / "annex/objects").resolve()):
            raise HTTPException(403, "File link leaves its registered dataset")
    if not target.is_file():
        raise HTTPException(404, "Content is unavailable locally; retrieve it with DataLad")
    with target.open("rb") as stream:
        identity = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
    if identity != artifact["content_id"]:
        raise HTTPException(409, "Local content differs from this recorded file version")
    return target


def _has_defacing_evidence(db, artifact, roots):
    def cleared(item, ancestors):
        if item["id"] in ancestors:
            return False
        ancestors = ancestors | {item["id"]}
        root = roots.get(item["dataset_id"])
        if root:
            for receipt in root.glob("code/network_fw2bids/defacing/*.json"):
                value = json.loads(receipt.read_text())
                if value.get("status") == "success" and any(
                    row.get("path") == item["path"] and "sha256:" + row.get("output_sha256", "") == item["content_id"]
                    for row in value.get("images", [])
                ):
                    return True
        parents = [dict(row) for row in db.execute(
            "SELECT a.*,l.relation FROM artifact_versions a JOIN lineage_links l ON l.input=a.id WHERE l.output=?",
            (item["id"],))]
        # A dataset dependency says nothing about which image bytes were used.
        # Only exact image transformations can propagate clearance, and every
        # image input must be cleared. Unknown archive inputs fail closed.
        if not parents or any(row["relation"] not in {"defacing", "freesurfer", "fmriprep", "trim_dummy"}
                              for row in parents):
            return False
        images = []
        for parent in parents:
            name = parent["path"]
            if name.endswith((".nii", ".nii.gz", ".mgz", ".white", ".pial", ".inflated", ".gii")):
                images.append(parent)
            elif not name.endswith((".json", ".tsv", ".txt")):
                return False
        return bool(images) and all(cleared(parent, ancestors) for parent in images)
    return cleared(artifact, set())
