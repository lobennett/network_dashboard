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


def inline_figures(db, study, artifact, path, *, fetcher=None, archive_fetcher=None):
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
                archived = _report_archive(db, study, artifact, original, stack, fetcher=fetcher, archive_fetcher=archive_fetcher)
            archive, prefix = archived
            member = prefix + relative
            if archive.namelist().count(member) != 1:
                raise HTTPException(404, 'Report figure is missing or ambiguous in the result archive')
            encoded = base64.b64encode(archive.read(member)).decode('ascii')
            return f'<img alt="MRIQC figure" style="max-width:100%;height:auto" src="data:image/svg+xml;base64,{encoded}">'
        error = None
        for candidate in candidates:
            try:
                figure = fetcher(candidate['id']) if fetcher else content_path(db, study, dict(candidate))
                encoded = base64.b64encode(figure.read_bytes()).decode('ascii')
                return f'<img alt="MRIQC figure" style="max-width:100%;height:auto" src="data:image/svg+xml;base64,{encoded}">'
            except HTTPException as failure:
                error = failure
        raise error

    with stack:
        rendered = re.sub(r'<object\b[^>]*>.*?</object\s*>|<img\b[^>]*>', replace_object, original, flags=re.I | re.S)
        if rendered == original:
            return None
        note = '<aside style="padding:12px;background:#fff1d8">Read-only report preview. Scoring and comments are not saved here.</aside>'
        return re.sub(r'(<body\b[^>]*>)', lambda match: match.group(0) + note, rendered, count=1, flags=re.I)


def _report_archive(db, study, artifact, original, stack, *, fetcher=None, archive_fetcher=None):
    row = db.execute('SELECT * FROM artifact_versions WHERE dataset_id=? AND path=?',
                     (artifact['dataset_id'], 'code/network_fmri/mriqc-evidence.json')).fetchone()
    if row is None:
        raise HTTPException(404, 'Report figure is not indexed')
    receipt_path = fetcher(row['id']) if fetcher else content_path(db, study, dict(row))
    receipt = json.loads(receipt_path.read_text())
    root = dataset_roots(db, study).get(receipt['source_dataset_id'])
    if root is None:
        raise HTTPException(404, 'Report archive dataset is unavailable')
    failure = None
    subject = re.search(r'(?:^|[/_])(sub-[A-Za-z0-9]+)(?:[/_.]|$)', artifact['path'])
    candidates = receipt['archives']
    if subject:
        candidates = [item for item in candidates if PurePosixPath(item['path']).name.startswith(subject[1] + '_')]
    for item in candidates:
        relative = PurePosixPath(item['path'])
        if relative.is_absolute() or '..' in relative.parts or '\\' in str(relative):
            raise HTTPException(403, 'Unsafe report archive path')
        source = (root / relative).resolve()
        if not source.is_relative_to(root.resolve()):
            raise HTTPException(403, 'Report archive leaves its local dataset')
        if archive_fetcher:
            registered = db.execute('SELECT id FROM artifact_versions WHERE dataset_id=? AND path=? AND content_id=?',
                                    (receipt['source_dataset_id'], str(relative), 'sha256:' + item['sha256'])).fetchone()
            if registered:
                try:
                    source = archive_fetcher(registered['id'])
                except HTTPException as error:
                    if error.status_code == 403:
                        raise
                    failure = error
                    continue
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
    if failure:
        raise failure
    raise HTTPException(404, 'Verified archive for this report is unavailable')


def is_subject_report(path, subject, scan_query=""):
    path = PurePosixPath(path)
    if len(path.parts) != 1 or not re.fullmatch(
        rf"sub-{re.escape(subject)}(?:_anat|(?:_ses-[A-Za-z0-9]+)?_func)?\.html",
        path.name,
    ):
        return False
    session = re.search(r"(?:^|_)(ses-[A-Za-z0-9]+)(?:_|$)", scan_query)
    return not session or path.name in {
        f"sub-{subject}.html", f"sub-{subject}_anat.html",
        f"sub-{subject}_{session[1]}_func.html",
    }


def reports_complete(names, subject, runs):
    if f"sub-{subject}.html" in names:
        return True
    if not runs:
        return False
    required = {f"sub-{subject}_anat.html"}
    for run in runs:
        session = re.search(r"(?:^|_)(ses-[A-Za-z0-9]+)(?:_|$)", run["run"])
        required.add(f"sub-{subject}" + (f"_{session[1]}" if session else "") + "_func.html")
    return required <= names
