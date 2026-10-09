"""A disposable, checksum-verified Oak cache using only the user's SSH client."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
from threading import RLock, Event, Thread
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import HTTPException

from .artifacts import content_path
from .records import connect, dataset_roots
from .checksums import matches, verifiable

OAK = '/oak/stanford/groups/russpold/data/network_grant'
DEFAULT_STUDY = OAK + '/bids'
DEFAULT_INDEX = OAK + '/network-dashboard-v1/records.sqlite'
ORIGIN = 'https://network-dashboard-devloganbennetts-projects.vercel.app'


def default_cache(config: dict) -> Path:
    """Reuse matching legacy downloads; isolate other connections automatically."""
    base = Path.home() / '.cache/network-dashboard'
    marker = base / 'source.json'
    if marker.is_file():
        try:
            if json.loads(marker.read_text()) == config:
                return base
        except (ValueError, OSError):
            pass
    identity = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
    return base / identity


class RemoteStudy:
    def __init__(self, host: str, source: Path, index: Path, cache: Path | None = None, *, runner=subprocess.run, progress=False):
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]*', host):
            raise ValueError('SSH destination must be a host alias or user@hostname')
        if not source.is_absolute() or not index.is_absolute():
            raise ValueError('Remote study and index paths must be absolute')
        self.host, self.source, self.remote_index = host, source, index
        config = {'ssh': host, 'study': str(source), 'index': str(index)}
        cache = cache if cache is not None else default_cache(config)
        self.cache = cache.expanduser().resolve()
        self.study, self.index = self.cache / 'study', self.cache / 'records.sqlite'
        self.runner = runner
        self.progress = progress
        self.index_size = 0
        self.lock = RLock()
        self.artifact_locks = {}
        self.cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.socket = self.cache / 'ssh.sock'
        self.ssh_options = ['-S', str(self.socket)]
        marker = self.cache / 'source.json'
        if marker.exists() and json.loads(marker.read_text()) != config:
            raise ValueError(f'Cache {self.cache} belongs to a different SSH connection, study, or index. '
                             'Omit --cache to select a separate cache automatically, or choose a different directory.')
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
            stop = Event()
            monitor = None
            if self.progress and source == self.remote_index:
                def report():
                    started = time.monotonic()
                    while not stop.wait(1):
                        size = temporary.stat().st_size
                        elapsed = time.monotonic() - started
                        rate = size / elapsed
                        percent = min(100, size * 100 / self.index_size) if self.index_size else 0
                        eta = f'{max(0, self.index_size-size)/rate:.0f}s remaining' if rate and self.index_size else 'estimating time…'
                        bar = '#' * int(percent / 5) + '-' * (20-int(percent / 5))
                        print(f'\r[{bar}] {percent:5.1f}% · {size/1e6:.1f} MB · {eta}', end='', flush=True)
                monitor = Thread(target=report, daemon=True)
                monitor.start()
            try:
                self.runner(['ssh', *(['-C'] if source == self.remote_index else []), *self.ssh_options, '-o', 'BatchMode=yes',
                             '-o', 'ConnectTimeout=15', self.host,
                             shlex.join(['cat', '--', str(source)])],
                            stdout=stream, stderr=subprocess.PIPE, check=True, timeout=600)
                stream.flush()
                if digest:
                    if not matches(temporary, digest):
                        raise HTTPException(409, 'Oak content differs from this indexed version; refresh the index')
                os.replace(temporary, target)
            except (OSError, subprocess.SubprocessError) as error:
                raise download_error(error, self.host, source) from error
            finally:
                stop.set()
                if monitor:
                    monitor.join()
                    print(flush=True)
                temporary.unlink(missing_ok=True)

    def prepare(self):
        """Refresh the index and privacy receipts; image bytes are fetched on click."""
        incoming = self.cache / 'index.pending'
        signature = None
        marker = self.cache / 'index-source.json'
        if self.progress:
            print('Checking the latest published dashboard snapshot…', flush=True)
            result = self.runner(['ssh', *self.ssh_options, '-o', 'BatchMode=yes', self.host,
                                  shlex.join(['stat', '-c', '%s %Y %i', '--', str(self.remote_index)])],
                                 capture_output=True, text=True, check=True, timeout=30)
            signature = result.stdout.strip()
            self.index_size = int(signature.split()[0])
        cached = bool(signature and self.index.is_file() and marker.is_file() and
                      json.loads(marker.read_text()).get('signature') == signature)
        try:
            if cached:
                print('Snapshot unchanged; using the local cache.', flush=True)
                incoming.write_bytes(self.index.read_bytes())
            else:
                if self.progress:
                    print(f'Downloading dashboard index ({self.index_size/1e6:.1f} MB before compression)…', flush=True)
                self._download(self.remote_index, incoming)
            if self.progress:
                print('Validating the snapshot…', flush=True)
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
            if signature:
                marker.write_text(json.dumps({'signature': signature}) + '\n')
        finally:
            incoming.unlink(missing_ok=True)
        with connect(self.index) as db:
            receipts = db.execute("SELECT * FROM artifact_versions WHERE path LIKE 'code/network_fw2bids/defacing/%.json'").fetchall()
            roots = dataset_roots(db, self.study)
            current = {roots[row['dataset_id']] / row['path'] for row in receipts if row['dataset_id'] in roots}
        for old in self.study.glob('**/code/network_fw2bids/defacing/*.json'):
            if old not in current:
                old.unlink()
        if self.progress:
            print(f'Checking {len(receipts)} privacy receipts (cached files are reused)…', flush=True)
        if self.progress and receipts:
            started = time.monotonic()
            with ThreadPoolExecutor(max_workers=4) as pool:
                pending = [pool.submit(self.fetch, row['id']) for row in receipts]
                for number, future in enumerate(as_completed(pending), 1):
                    future.result()
                    remaining = (time.monotonic() - started) / number * (len(receipts) - number)
                    print(f'\rPrivacy checks: {number}/{len(receipts)} · about {remaining:.0f}s remaining', end='', flush=True)
        else:
            for row in receipts:
                self.fetch(row['id'])
        if self.progress:
            print('\nSnapshot ready. Images and reports load when opened.', flush=True)

    def add_reference(self, pilot: 'RemoteStudy', subject: str):
        """Link completed pilot evidence in this cache; leave both studies unchanged."""
        from .references import import_reference
        if pilot.host != self.host or pilot.source.parent != self.source.parent:
            raise ValueError('Pilot must use the same SSH host and Oak study parent')
        incoming = self.cache / 'reference.pending'
        try:
            import_reference(self.index, pilot.index, incoming, subject=subject,
                             mount=f'references/pilot-{subject}', label=f'Completed {subject} pilot',
                             source_study=str(pilot.source))
            os.replace(incoming, self.index)
        finally:
            incoming.unlink(missing_ok=True)
        with connect(self.index) as db:
            receipts = [r[0] for r in db.execute("SELECT id FROM artifact_versions WHERE path LIKE 'code/network_fw2bids/defacing/%.json'")]
        for identity in receipts:
            self.fetch(identity)

    def fetch(self, identity: str) -> Path:
        with self.lock:
            lock = self.artifact_locks.setdefault(identity, RLock())
        with lock, connect(self.index) as db:
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
            self._download(self.source_path(db, relative), target, artifact['content_id'])
            return content_path(db, self.study, artifact)

    def source_path(self, db, relative: Path) -> Path:
        """Resolve an explicitly linked pilot within the same Oak study parent."""
        row = db.execute("SELECT value FROM metadata WHERE key='reference_stages'").fetchone()
        for stages in json.loads(row[0] if row else '{}').values():
            for context in stages.values():
                mount = Path(context['mount'])
                if not relative.is_relative_to(mount):
                    continue
                source = Path(context.get('source_study', ''))
                if (not source.is_absolute() or source.parent != self.source.parent
                        or not re.fullmatch(r'network-study-pilot-[A-Za-z0-9_-]+', source.name)
                        or mount.is_absolute() or '..' in mount.parts
                        or len(mount.parts) != 2 or mount.parts[0] != 'references'):
                    raise HTTPException(403, 'Unsafe reference study source')
                return source / relative.relative_to(mount)
        return self.source / relative

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
            self._download(self.source_path(db, target.relative_to(self.study)), target, row['content_id'])
            return target


def download_error(error: Exception, host: str, source: Path) -> HTTPException:
    """Keep transport failures distinct from remote permissions and local I/O."""
    location = f'{host}:{source}'
    if isinstance(error, subprocess.CalledProcessError):
        stderr = error.stderr or ''
        if isinstance(stderr, bytes):
            stderr = stderr.decode('utf-8', errors='replace')
        detail = ''.join(c for c in stderr if c.isprintable() or c in '\n\t').strip()[-2000:]
        detail = detail or f'SSH command exited with status {error.returncode}'
        if error.returncode != 255 and 'permission denied' in detail.lower():
            return HTTPException(403, f'Oak read access denied for {location}. '
                                 f'Ask the dataset owner to check file and parent-directory permissions.\n{detail}')
        if error.returncode != 255 and 'no such file or directory' in detail.lower():
            return HTTPException(404, f'Oak file is missing or its symlink target is unavailable: {location}. '
                                 f'Ask the owner to restore the indexed file.\n{detail}')
        hint = ('Restart connect to authenticate.' if 'permission denied' in detail.lower()
                else 'Check the SSH connection to Sherlock.')
        return HTTPException(503, f'Could not download {location}. {hint}\n{detail}')
    if isinstance(error, subprocess.TimeoutExpired):
        return HTTPException(503, f'Download timed out for {location}. Check the SSH connection and retry.')
    if isinstance(error, OSError):
        return HTTPException(503, f'Could not download {location}: local SSH/cache operation failed: {error}')
    return HTTPException(503, f'Could not download {location}: {error}')
