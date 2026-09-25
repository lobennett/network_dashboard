"""A disposable, checksum-verified Oak cache using only the user's SSH client."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
from threading import RLock

from fastapi import HTTPException

from .artifacts import content_path
from .records import connect, dataset_roots
from .checksums import matches, verifiable

OAK = '/oak/stanford/groups/russpold/data/network_grant'
DEFAULT_STUDY = OAK + '/network-study-pilot-s03'
DEFAULT_INDEX = OAK + '/network-dashboard-cache/records.sqlite'
ORIGIN = 'https://network-dashboard-devloganbennetts-projects.vercel.app'


class RemoteStudy:
    def __init__(self, host: str, source: Path, index: Path, cache: Path, *, runner=subprocess.run):
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]*', host):
            raise ValueError('SSH destination must be a host alias or user@hostname')
        if not source.is_absolute() or not index.is_absolute():
            raise ValueError('Remote study and index paths must be absolute')
        self.host, self.source, self.remote_index = host, source, index
        self.cache = cache.expanduser().resolve()
        self.study, self.index = self.cache / 'study', self.cache / 'records.sqlite'
        self.runner = runner
        self.lock = RLock()
        self.cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.socket = self.cache / 'ssh.sock'
        self.ssh_options = ['-S', str(self.socket)]
        marker = self.cache / 'source.json'
        config = {'ssh': host, 'study': str(source), 'index': str(index)}
        if marker.exists() and json.loads(marker.read_text()) != config:
            raise ValueError('Cache belongs to another study; choose a different --cache directory')
        marker.write_text(json.dumps(config) + '\n')

    def authenticate(self):
        print(f'Connecting to {self.host}. Complete SSH authentication if prompted.', flush=True)
        existing = self.runner(['ssh', '-O', 'check', self.host], capture_output=True)
        if existing.returncode == 0:
            self.ssh_options = []
            return
        self.runner(['ssh', '-S', str(self.socket), '-o', 'ControlMaster=auto',
                     '-o', 'ControlPersist=600', self.host, 'true'], check=True)

    def _download(self, source: Path, target: Path, digest: str | None = None):
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.download-', delete=False) as stream:
            temporary = Path(stream.name)
            try:
                self.runner(['ssh', *self.ssh_options, '-o', 'BatchMode=yes',
                             '-o', 'ConnectTimeout=15', self.host,
                             shlex.join(['cat', '--', str(source)])],
                            stdout=stream, stderr=subprocess.PIPE, check=True, timeout=600)
                stream.flush()
                if digest:
                    if not matches(temporary, digest):
                        raise HTTPException(409, 'Oak content differs from this indexed version; refresh the index')
                os.replace(temporary, target)
            except (OSError, subprocess.SubprocessError) as error:
                raise HTTPException(503, 'SSH download failed. Restart connect to authenticate, or ask the owner to restore the Oak file.') from error
            finally:
                temporary.unlink(missing_ok=True)

    def prepare(self):
        """Refresh the index and privacy receipts; image bytes are fetched on click."""
        incoming = self.cache / 'index.pending'
        try:
            self._download(self.remote_index, incoming)
            with connect(incoming) as db:
                metadata = dict(db.execute('SELECT key,value FROM metadata'))
                if metadata.get('schema_version') != '2' or db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Unsupported or damaged dashboard index')
                roots = dataset_roots(db, self.study)
                for root in roots.values():
                    if not root.resolve().is_relative_to(self.study.resolve()):
                        raise ValueError('Dataset path leaves the local cache')
                    root.mkdir(parents=True, exist_ok=True)
            os.replace(incoming, self.index)
        finally:
            incoming.unlink(missing_ok=True)
        with connect(self.index) as db:
            receipts = db.execute("SELECT * FROM artifact_versions WHERE path LIKE 'code/network_fw2bids/defacing/%.json'").fetchall()
            roots = dataset_roots(db, self.study)
            current = {roots[row['dataset_id']] / row['path'] for row in receipts if row['dataset_id'] in roots}
        for old in self.study.glob('**/code/network_fw2bids/defacing/*.json'):
            if old not in current:
                old.unlink()
        for row in receipts:
            self.fetch(row['id'])

    def fetch(self, identity: str) -> Path:
        with self.lock, connect(self.index) as db:
            row = db.execute('SELECT * FROM artifact_versions WHERE id=?', (identity,)).fetchone()
            if row is None:
                raise HTTPException(404, 'Unknown artifact')
            artifact = dict(row)
            try:
                return content_path(db, self.study, artifact)
            except HTTPException as error:
                # Path and privacy checks precede both missing/mismatched content.
                if error.status_code not in {404, 409}:
                    raise
            root = dataset_roots(db, self.study)[artifact['dataset_id']]
            target = root / artifact['path']
            relative = target.relative_to(self.study)
            if not target.resolve().is_relative_to(self.study.resolve()):
                raise HTTPException(403, 'Cache path leaves the study')
            if not verifiable(artifact['content_id']):
                raise HTTPException(409, 'Artifact has no verifiable content checksum')
            self._download(self.source / relative, target, artifact['content_id'])
            return content_path(db, self.study, artifact)

    def fetch_archive(self, identity: str) -> Path:
        """Internal MRIQC report fallback; archives are never served by the API."""
        with self.lock, connect(self.index) as db:
            row = db.execute('SELECT * FROM artifact_versions WHERE id=?', (identity,)).fetchone()
            if row is None:
                raise HTTPException(404, 'Unknown report archive')
            relative = Path(row['path'])
            root = dataset_roots(db, self.study).get(row['dataset_id'])
            if (root is None or relative.is_absolute() or '..' in relative.parts or '\\' in str(relative)
                    or relative.suffix != '.zip' or not re.fullmatch(r'sha256:[a-f0-9]{64}', row['content_id'])):
                raise HTTPException(403, 'Unsafe report archive')
            target = root / relative
            if not target.resolve().is_relative_to(self.study.resolve()):
                raise HTTPException(403, 'Report archive leaves the cache')
            if target.is_file():
                with target.open('rb') as stream:
                    if 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest() == row['content_id']:
                        return target
            self._download(self.source / target.relative_to(self.study), target, row['content_id'])
            return target
