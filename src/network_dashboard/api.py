"""Local read-only API for Network study records and review artifacts."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from network_dashboard.artifacts import content_path
from network_dashboard.records import connect, rows


def create_app(index: Path, study: Path, web: Path | None = None) -> FastAPI:
    index, study = Path(index), Path(study).resolve()
    app = FastAPI(title="Network pipeline", docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])

    @app.middleware("http")
    async def same_origin(request, call_next):
        origin = request.headers.get("origin")
        expected = f"{request.url.scheme}://{request.headers.get('host', '')}"
        if (origin is not None and origin != expected) or request.headers.get("sec-fetch-site") == "cross-site":
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

    @app.get("/api/artifacts")
    def artifacts(q: str = "", limit: int = Query(200, ge=1, le=1000)):
        with connect(index) as db:
            return rows(db, "SELECT * FROM artifact_versions WHERE instr(path,?)>0 ORDER BY path LIMIT ?", (q, limit))

    def get_artifact(db, identity):
        found = rows(db, "SELECT * FROM artifact_versions WHERE id=?", (identity,))
        if not found:
            raise HTTPException(404, "Unknown artifact")
        return found[0]

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

    @app.get("/api/attempts/{identity}")
    def attempt(identity: str):
        with connect(index) as db:
            found = db.execute("SELECT evidence_json FROM processing_attempts WHERE id=?", (identity,)).fetchone()
            if not found:
                raise HTTPException(404, "Unknown attempt")
            return json.loads(found[0])

    @app.get("/api/artifacts/{identity}/content")
    def content(identity: str):
        with connect(index) as db:
            artifact = get_artifact(db, identity)
            path = content_path(db, study, artifact)
        headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"}
        if artifact["path"].endswith(".html"):
            headers["Content-Security-Policy"] = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"
        return FileResponse(path, filename=Path(artifact["path"]).name,
                            content_disposition_type="inline", headers=headers)

    if web is not None:
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
