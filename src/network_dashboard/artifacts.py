"""Serve registered file versions, enforcing content and anatomical privacy."""
import json
import re
from pathlib import Path
import subprocess
from functools import lru_cache

from fastapi import HTTPException

from network_dashboard.records import dataset_roots, published_location
from network_dashboard.checksums import matches


def allowed_path(db, study: Path, artifact: dict) -> Path:
    """Check path and privacy without reading image bytes (used by file lists)."""
    relative = Path(artifact["path"])
    name = relative.name
    if relative.is_absolute() or ".." in relative.parts or "\\" in str(relative):
        raise HTTPException(403, "File path is outside the allowed dataset")
    if not name.endswith((".html", ".json", ".tsv", ".csv", ".txt", ".log", ".pdf", ".png", ".jpg",
                          ".nii", ".nii.gz", ".mgz", ".white", ".pial", ".inflated", ".gii", ".svg")):
        raise HTTPException(403, "This file type is not served")
    roots = dataset_roots(db, study)
    root = roots.get(artifact["dataset_id"])
    if root is None:
        raise HTTPException(403, "Content is not in a registered local dataset")
    root = root.resolve()
    image = name.endswith((".nii", ".nii.gz", ".mgz", ".white", ".pial", ".inflated", ".gii"))
    fieldmap = relative.parent.name == 'fmap' and bool(re.fullmatch(
        r'sub-[A-Za-z0-9]+(?:_[A-Za-z0-9]+-[A-Za-z0-9]+)*_(?:fieldmap|magnitude)\.nii(?:\.gz)?', name))
    if image and not fieldmap and not name.endswith(("_bold.nii", "_bold.nii.gz")):
        if not _has_defacing_evidence(db, artifact, roots):
            raise HTTPException(403, "Image preview requires recorded defacing evidence")
    try:
        location = published_location(db, artifact)
    except ValueError as error:
        raise HTTPException(403, str(error)) from error
    if location:
        target = (study / location).resolve()
        if not target.is_relative_to(study.resolve()):
            raise HTTPException(403, 'Published file link leaves the study')
        return target
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
    return target


def content_path(db, study: Path, artifact: dict) -> Path:
    target = allowed_path(db, study, artifact)
    if not target.is_file():
        raise HTTPException(404, "Content is unavailable locally; retrieve it with DataLad")
    if not matches(target, artifact["content_id"]):
        raise HTTPException(409, "Local content differs from this recorded file version")
    return target


def _has_defacing_evidence(db, artifact, roots):
    def cleared(item, ancestors):
        if item["id"] in ancestors:
            return False
        ancestors = ancestors | {item["id"]}
        root = roots.get(item["dataset_id"])
        if root:
            for row in db.execute("SELECT path,content_id FROM artifact_versions WHERE dataset_id=? AND path LIKE 'code/network_fw2bids/defacing/%.json'", (item['dataset_id'],)):
                receipt = root / row['path']
                if not receipt.is_file() or not receipt.resolve().is_relative_to(root.resolve()):
                    continue
                stat = receipt.stat()
                value = _receipt(receipt, stat.st_mtime_ns, stat.st_size, row['content_id'])
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


@lru_cache(maxsize=512)
def _receipt(path, modified, size, digest):
    # The small privacy receipt must match its indexed version too.
    if not matches(path, digest):
        return {}
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
