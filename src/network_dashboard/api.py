"""Local read-only API for Network study records and review artifacts."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.cors import CORSMiddleware

from network_dashboard.artifacts import content_path
from network_dashboard.checksums import verifiable
from network_dashboard.records import connect, rows, dataset_roots


def create_app(index: Path, study: Path, web: Path | None = None, *, allowed_origins: list[str] | None = None, fetcher=None, archive_fetcher=None) -> FastAPI:
    index, study = Path(index), Path(study).resolve()
    allowed_origins = allowed_origins or []
    for origin in allowed_origins:
        parsed = urlsplit(origin)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or '*' in origin:
            raise ValueError('Allowed dashboard origins must be exact HTTPS origins')
    app = FastAPI(title="Network pipeline", docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])
    app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=['GET'],
                       allow_headers=['Range'], allow_credentials=True,
                       allow_private_network=bool(allowed_origins))

    @app.middleware("http")
    async def same_origin(request, call_next):
        origin = request.headers.get("origin")
        expected = f"{request.url.scheme}://{request.headers.get('host', '')}"
        trusted_frontend = origin in allowed_origins
        if not trusted_frontend and ((origin is not None and origin != expected) or request.headers.get("sec-fetch-site") == "cross-site"):
            return JSONResponse({"detail": "Cross-origin access is forbidden"}, status_code=403)
        return await call_next(request)

    @app.get("/api/metadata")
    def metadata():
        with connect(index) as db:
            value = {row["key"]: row["value"] for row in db.execute("SELECT * FROM metadata")}
        if value.get("schema_version") != "2":
            raise HTTPException(409, "Rebuild the index with the current network_fmri")
        with connect(index) as db:
            conversion_links = db.execute("SELECT COUNT(*) FROM lineage_links WHERE relation='conversion'").fetchone()[0]
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(value["built_at"])).total_seconds()
        except (KeyError, ValueError, TypeError):
            age = None
        return {**value, "age_seconds": age, "stale": age is None or age > 900,
                "conversion_links": conversion_links}

    @app.get("/api/subjects")
    def subjects():
        with connect(index) as db:
            return rows(db, "SELECT DISTINCT subject FROM entities WHERE subject IS NOT NULL ORDER BY subject")

    @app.get('/api/coverage')
    def coverage(subject: str | None = None):
        if subject is not None and not re.fullmatch(r'[A-Za-z0-9]+', subject):
            raise HTTPException(400, 'Invalid subject')
        from network_dashboard.coverage import study_coverage
        with connect(index) as db:
            return study_coverage(db, subject)

    @app.get("/api/subjects/{subject}")
    def subject_detail(subject: str):
        if not re.fullmatch(r"[A-Za-z0-9]+", subject):
            raise HTTPException(404, "Unknown subject")
        with connect(index) as db:
            entities = rows(db, "SELECT * FROM entities WHERE subject=?", (subject,))
            if not entities:
                raise HTTPException(404, "Unknown subject")
            return {"entities": entities,
                    "attempts": rows(db, "SELECT * FROM stage_attempts WHERE scope IN (?, 'dataset') OR scope LIKE ?",
                                     ("sub-" + subject, "sub-" + subject + "/%")),
                    "decisions": rows(db, "SELECT d.* FROM decisions d JOIN entities e ON e.entity_key=d.entity_key WHERE e.subject=?", (subject,)),
                    "findings": rows(db, "SELECT f.* FROM findings f JOIN entities e ON e.entity_key=f.entity_key WHERE e.subject=?", (subject,))}

    @app.get('/api/subjects/{subject}/completion')
    def completion(subject: str):
        from network_dashboard.completion import subject_completion
        if not re.fullmatch(r'[A-Za-z0-9]+', subject):
            raise HTTPException(404, 'Unknown subject')
        with connect(index) as db:
            return subject_completion(db, subject)

    @app.get("/api/artifacts")
    def artifacts(q: str = "", limit: int = Query(200, ge=1, le=1000), preview: bool = False,
                  subject: str | None = None,
                  dataset_stage: Literal['freesurfer', 'fmriprep', 'fmriprepviz'] | None = None,
                  include_subject_report: bool = False):
        with connect(index) as db:
            if subject is not None and not re.fullmatch(r'[A-Za-z0-9]+', subject):
                raise HTTPException(400, 'Invalid subject')
            if include_subject_report and subject:
                report = f'sub-{subject}.html'
                found = rows(db, "SELECT * FROM artifact_versions WHERE instr(path,?)>0 OR path=? OR path LIKE ? ORDER BY path",
                             (q, report, '%/' + report))
            else:
                found = rows(db, "SELECT * FROM artifact_versions WHERE instr(path,?)>0 ORDER BY path", (q,))
            if subject:
                pattern = re.compile(r'(?:^|[/_])sub-' + re.escape(subject) + r'(?:[/_.]|$)')
                found = [item for item in found if pattern.search(item['path'])]
            if dataset_stage:
                roots = dataset_roots(db, study)
                def matches_stage(item):
                    root = roots.get(item['dataset_id'])
                    if root is None:
                        return False
                    # Canonical derivative dataset names distinguish standalone FS8
                    # from the legacy fMRIPrep anatomical-only campaign.
                    name = root.name.lower()
                    if dataset_stage == 'freesurfer':
                        return name.startswith('freesurfer-8.')
                    if dataset_stage == 'fmriprepviz':
                        return name.startswith('fmriprepviz-')
                    return name.startswith('fmriprep-') and '+anat+' not in name
                found = [item for item in found if matches_stage(item)]
            if preview:
                found = [item for item in found if item['path'].endswith(
                    ('.html', '.nii', '.nii.gz', '.mgz', '.white', '.pial', '.inflated', '.gii'))]
            found = found[:limit]
            if preview:
                for item in found:
                    try:
                        content_path(db, study, item)
                        item['preview_available'] = True
                    except HTTPException as error:
                        item.update(preview_available=False, preview_reason=error.detail,
                                    fetch_available=bool(fetcher and error.status_code in {404, 409}
                                                         and verifiable(item['content_id'])))
            return found

    def get_artifact(db, identity):
        found = rows(db, "SELECT * FROM artifact_versions WHERE id=?", (identity,))
        if not found:
            raise HTTPException(404, "Unknown artifact")
        return found[0]

    @app.get("/api/subjects/{subject}/manifest")
    def manifest(subject: str, format: Literal['json', 'tsv'] = 'json'):
        from network_dashboard.manifest import subject_manifest, scan_tsv
        if not re.fullmatch(r'[A-Za-z0-9]+', subject):
            raise HTTPException(404, 'Unknown subject')
        with connect(index) as db:
            value = subject_manifest(db, subject)
        headers = {'Cache-Control': 'no-store',
                   'Content-Disposition': f'attachment; filename="sub-{subject}_manifest.{format}"'}
        if format == 'tsv':
            return Response(scan_tsv(value), media_type='text/tab-separated-values', headers=headers)
        return JSONResponse(value, headers=headers)

    @app.get("/api/artifacts/{identity}/table")
    def table(identity: str):
        from network_dashboard.tables import read_table, table_kind
        with connect(index) as db:
            artifact = get_artifact(db, identity)
            if not table_kind(artifact['path']):
                raise HTTPException(400, 'This artifact is not an events or saved design table')
            path = fetcher(identity) if fetcher else content_path(db, study, artifact)
            return {**read_table(path, name=artifact['path']), 'artifact': artifact}

    @app.get("/api/artifacts/{identity}/lineage")
    def lineage(identity: str):
        with connect(index) as db:
            selected = get_artifact(db, identity)
            links = rows(db, "SELECT * FROM lineage_links WHERE input=? OR output=?", (identity, identity))
            related = {link[key] for link in links for key in ("input", "output")}
            artifacts = [get_artifact(db, key) for key in sorted(related)]
            attempts = []
            for key in sorted({link["attempt"] for link in links}):
                row = db.execute("SELECT evidence_json FROM processing_attempts WHERE id=?", (key,)).fetchone()
                if row:
                    attempts.append(json.loads(row[0]))
            return {"artifact": selected, "artifacts": artifacts, "links": links, "attempts": attempts,
                    "ancestry": "recorded" if any(link["output"] == identity for link in links) else "unrecorded"}

    @app.get("/api/artifacts/{identity}/tree")
    def tree(identity: str):
        from network_dashboard.provenance import ancestry_tree
        with connect(index) as db:
            return ancestry_tree(db, identity)

    @app.get("/api/attempts/{identity}")
    def attempt(identity: str):
        with connect(index) as db:
            found = db.execute("SELECT evidence_json FROM processing_attempts WHERE id=?", (identity,)).fetchone()
            if not found:
                raise HTTPException(404, "Unknown attempt")
            return json.loads(found[0])

    @app.get("/api/artifacts/{identity}/content")
    def content(identity: str):
        rendered = None
        with connect(index) as db:
            artifact = get_artifact(db, identity)
            path = fetcher(identity) if fetcher else content_path(db, study, artifact)
            if artifact["path"].endswith(".html"):
                from network_dashboard.reports import inline_figures
                rendered = inline_figures(db, study, artifact, path, fetcher=fetcher, archive_fetcher=archive_fetcher)
        headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"}
        if artifact["path"].endswith(".html"):
            headers["Content-Security-Policy"] = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"
        elif artifact["path"].endswith(".svg"):
            headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
        if rendered is not None:
            return HTMLResponse(rendered, headers=headers)
        return FileResponse(path, filename=Path(artifact["path"]).name,
                            content_disposition_type="inline", headers=headers)

    if web is not None:
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
