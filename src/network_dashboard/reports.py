"""Render report figures from verified local artifacts without external requests."""
import base64
from contextlib import ExitStack
import hashlib
import json
from pathlib import PurePosixPath
import posixpath
import re
import zipfile
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException

from network_dashboard.artifacts import content_path
from network_dashboard.records import dataset_roots


def inline_figures(db, study, artifact, path):
    original = path.read_text()
    stack = ExitStack()
    archived = None

    def replace_object(match):
        nonlocal archived
        source = re.search(r'\b(?:data|src)\s*=\s*([\"\x27])(.*?)\1', match.group(0), re.I | re.S)
        if not source:
            return match.group(0)
        url = urlsplit(source.group(2))
        if url.scheme or url.netloc or not url.path.endswith('.svg'):
            return match.group(0)
        relative = posixpath.normpath(posixpath.join(str(PurePosixPath(artifact['path']).parent), unquote(url.path)))
        if relative.startswith('/') or '..' in PurePosixPath(relative).parts:
            raise HTTPException(403, 'Report figure leaves its dataset')
        candidates = db.execute('SELECT * FROM artifact_versions WHERE dataset_id=? AND path=?',
                                (artifact['dataset_id'], relative)).fetchall()
        if not candidates:
            if archived is None:
                archived = _report_archive(db, study, artifact, original, stack)
            archive, prefix = archived
            member = prefix + relative
            if archive.namelist().count(member) != 1:
                raise HTTPException(404, 'Report figure is missing or ambiguous in the result archive')
            encoded = base64.b64encode(archive.read(member)).decode('ascii')
            return f'<img alt="MRIQC figure" style="max-width:100%;height:auto" src="data:image/svg+xml;base64,{encoded}">'
        error = None
        for candidate in candidates:
            try:
                figure = content_path(db, study, dict(candidate))
                encoded = base64.b64encode(figure.read_bytes()).decode('ascii')
                return f'<img alt="MRIQC figure" style="max-width:100%;height:auto" src="data:image/svg+xml;base64,{encoded}">'
            except HTTPException as failure:
                error = failure
        raise error

    with stack:
        rendered = re.sub(r'<object\b[^>]*>.*?</object\s*>|<img\b[^>]*>', replace_object, original, flags=re.I | re.S)
        return rendered if rendered != original else None


def _report_archive(db, study, artifact, original, stack):
    row = db.execute('SELECT * FROM artifact_versions WHERE dataset_id=? AND path=?',
                     (artifact['dataset_id'], 'code/network_fmri/mriqc-evidence.json')).fetchone()
    if row is None:
        raise HTTPException(404, 'Report figure is not indexed')
    receipt = json.loads(content_path(db, study, dict(row)).read_text())
    root = dataset_roots(db, study).get(receipt['source_dataset_id'])
    if root is None:
        raise HTTPException(404, 'Report archive dataset is unavailable')
    for item in receipt['archives']:
        relative = PurePosixPath(item['path'])
        if relative.is_absolute() or '..' in relative.parts or '\\' in str(relative):
            raise HTTPException(403, 'Unsafe report archive path')
        source = (root / relative).resolve()
        if not source.is_relative_to(root.resolve()):
            raise HTTPException(403, 'Report archive leaves its local dataset')
        if not source.is_file():
            continue
        with source.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != item['sha256']:
            raise HTTPException(409, 'Report archive differs from its evidence receipt')
        archive = stack.enter_context(zipfile.ZipFile(source))
        suffix = '/' + artifact['path']
        matches = [name for name in archive.namelist() if name.endswith(suffix)]
        if len(matches) == 1 and archive.read(matches[0]).decode() == original:
            return archive, matches[0][:-len(artifact['path'])]
    raise HTTPException(404, 'Verified archive for this report is unavailable')
