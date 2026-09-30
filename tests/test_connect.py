import hashlib
import json
from pathlib import Path
import shlex
import sqlite3

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from test_api import study


def transport(root):
    """Real local fixture bytes in place of the SSH subprocess."""
    def run(command, **kwargs):
        args = shlex.split(command[-1])
        assert args[:2] == ['cat', '--']
        source = Path(args[2])
        assert source.is_relative_to(root)
        kwargs['stdout'].write(source.read_bytes())
    return run


def test_uv_connect_fetches_only_opened_files_and_caches_verified_bytes(study, tmp_path):
    from network_dashboard.remote import RemoteStudy
    from network_dashboard.api import create_app
    root, index = study
    cache = tmp_path / 'cache'
    remote = RemoteStudy('user@host', root, index, cache, runner=transport(tmp_path))
    remote.prepare()
    assert not (remote.study / 'report.html').exists()
    api = TestClient(create_app(remote.index, remote.study, fetcher=remote.fetch))
    files = api.get('/api/artifacts?preview=true').json()
    assert files[0]['fetch_available'] is True
    assert not (remote.study / 'report.html').exists()
    response = api.get('/api/artifacts/report/content')
    assert response.status_code == 200
    assert response.text == '<h1>Report</h1>'
    (root / 'report.html').unlink()
    assert api.get('/api/artifacts/report/content').status_code == 200


def test_completed_pilot_report_fetches_from_its_original_oak_location(study, tmp_path):
    from network_dashboard.remote import RemoteStudy
    root,index = study
    pilot = root.parent / 'network-study-pilot-s03'
    pilot.mkdir()
    report = pilot/'report.html'
    report.write_text('<h1>Completed pilot</h1>')
    with sqlite3.connect(index) as db:
        db.execute('INSERT INTO artifacts VALUES (1,?,?,?,NULL)',('references/pilot-s03','dataset:pilot','dataset'))
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',('pilot-report','pilot','report.html','sha256:'+hashlib.sha256(report.read_bytes()).hexdigest(),'{}'))
        context={'mount':'references/pilot-s03','source_study':str(pilot)}
        db.execute('INSERT INTO metadata VALUES (?,?)',('reference_stages',json.dumps({'s03':{'fmriprep':context}})))
    remote = RemoteStudy('user@host',root,index,tmp_path/'cache',runner=transport(tmp_path))
    remote.prepare()
    assert remote.fetch('pilot-report').read_text()=='<h1>Completed pilot</h1>'
    with sqlite3.connect(remote.index) as db:
        context['source_study']='/etc'
        db.execute("UPDATE metadata SET value=? WHERE key='reference_stages'",(json.dumps({'s03':{'fmriprep':context}}),))
        with pytest.raises(HTTPException,match='Unsafe reference'):
            remote.source_path(db,Path('references/pilot-s03/report.html'))


def test_reference_connection_requires_all_three_arguments(capsys):
    from network_dashboard.cli import connect_main
    with pytest.raises(SystemExit):
        connect_main(['--ssh','sherlock','--reference-subject','s03'])
    assert 'provide --reference-study, --reference-index and --reference-subject together' in capsys.readouterr().err


def test_failed_checksum_leaves_no_cached_file(study, tmp_path):
    from network_dashboard.remote import RemoteStudy
    remote = RemoteStudy('user@host', study[0], study[1], tmp_path / 'cache', runner=transport(tmp_path))
    remote.prepare()
    (study[0] / 'report.html').write_text('changed on Oak')
    with pytest.raises(HTTPException, match='differs'):
        remote.fetch('report')
    assert not (remote.study / 'report.html').exists()


def test_remote_fetch_verifies_annex_md5_and_rejects_pointer_identity(study, tmp_path):
    from network_dashboard.remote import RemoteStudy
    from network_dashboard.api import create_app
    root, index = study
    digest = hashlib.md5((root / 'report.html').read_bytes()).hexdigest()
    with sqlite3.connect(index) as db:
        db.execute('UPDATE artifact_versions SET content_id=?', ('md5:' + digest,))
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)',
                   ('pointer', 'study', 'sub-s03_echo-1_bold.nii.gz', 'gitblob:' + 'a'*40, '{}'))
    remote = RemoteStudy('user@host', root, index, tmp_path / 'cache', runner=transport(tmp_path))
    remote.prepare()
    api = TestClient(create_app(remote.index, remote.study, fetcher=remote.fetch))
    assert api.get('/api/artifacts/report/content').status_code == 200
    pointer = api.get('/api/artifacts?q=echo-1&preview=true').json()[0]
    assert pointer['fetch_available'] is False
    (remote.study / 'report.html').unlink()
    (root / 'report.html').write_text('different bytes')
    assert api.get('/api/artifacts/report/content').status_code == 409
    assert not (remote.study / 'report.html').exists()


def test_anatomy_without_defacing_receipt_is_never_fetched(study, tmp_path):
    from network_dashboard.remote import RemoteStudy
    root, index = study
    with sqlite3.connect(index) as db:
        db.execute("UPDATE artifact_versions SET path='sub-s03_T1w.nii.gz'")
    remote = RemoteStudy('user@host', root, index, tmp_path / 'cache', runner=transport(tmp_path))
    remote.prepare()
    with pytest.raises(HTTPException, match='defacing'):
        remote.fetch('report')


def test_receipts_are_fetched_before_anatomical_preview(study, tmp_path):
    from network_dashboard.remote import RemoteStudy
    root, index = study
    image = root / 'sub-s03_T1w.nii.gz'
    image.write_bytes(b'defaced')
    digest = hashlib.sha256(image.read_bytes()).hexdigest()
    receipt = root / 'code/network_fw2bids/defacing/sub-s03.json'
    receipt.parent.mkdir(parents=True)
    receipt.write_text(json.dumps({'status': 'success', 'images': [{'path': image.name, 'output_sha256': digest}]}))
    with sqlite3.connect(index) as db:
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', ('image', 'study', image.name, 'sha256:'+digest, '{}'))
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', ('receipt', 'study', receipt.relative_to(root).as_posix(), 'sha256:'+hashlib.sha256(receipt.read_bytes()).hexdigest(), '{}'))
    remote = RemoteStudy('user@host', root, index, tmp_path / 'cache', runner=transport(tmp_path))
    remote.prepare()
    assert remote.fetch('image').read_bytes() == b'defaced'
    # Retired privacy evidence must stop authorizing even already cached bytes.
    with sqlite3.connect(index) as db:
        db.execute("DELETE FROM artifact_versions WHERE id='receipt'")
    receipt.unlink()
    remote.prepare()
    with pytest.raises(HTTPException, match='defacing'):
        remote.fetch('image')


def test_refresh_keeps_new_versions_fetchable(study, tmp_path):
    from network_dashboard.remote import RemoteStudy
    from network_dashboard.api import create_app
    root, index = study
    remote = RemoteStudy('user@host', root, index, tmp_path / 'cache', runner=transport(tmp_path))
    remote.prepare()
    remote.fetch('report')
    (root / 'report.html').write_text('New report')
    with sqlite3.connect(index) as db:
        db.execute('UPDATE artifact_versions SET content_id=?', ('sha256:'+hashlib.sha256(b'New report').hexdigest(),))
    remote.prepare()
    api = TestClient(create_app(remote.index, remote.study, fetcher=remote.fetch))
    assert api.get('/api/artifacts?preview=true').json()[0]['fetch_available'] is True
    assert api.get('/api/artifacts/report/content').text == 'New report'


@pytest.mark.parametrize('prefix', ['', 'sub-s03_'])
def test_remote_mriqc_report_retrieves_verified_archive_figures(study, tmp_path, prefix):
    import zipfile
    from network_dashboard.remote import RemoteStudy
    from network_dashboard.api import create_app
    root, index = study
    report = '<html><body><object data="plot.svg"></object></body></html>'
    report_name = prefix + 'report.html'
    (root / report_name).write_text(report)
    archive = root / (prefix + 'result.zip')
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr('MRIQC/' + report_name, report)
        z.writestr('MRIQC/plot.svg', '<svg/>')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    receipt = root / 'code/network_fmri/mriqc-evidence.json'
    receipt.parent.mkdir(parents=True)
    missing_name = prefix + 'missing.zip'
    receipt.write_text(json.dumps({'source_dataset_id': 'study', 'archives':[{'path': missing_name, 'sha256':'a'*64}, {'path': archive.name, 'sha256':digest}]}))
    with sqlite3.connect(index) as db:
        db.execute('UPDATE artifact_versions SET path=?, content_id=?', (report_name, 'sha256:'+hashlib.sha256(report.encode()).hexdigest()))
        db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', ('missing','study',missing_name,'sha256:'+'a'*64,'{}'))
        for identity, file in [('archive', archive), ('receipt', receipt)]:
            db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?)', (identity, 'study', file.relative_to(root).as_posix(), 'sha256:'+hashlib.sha256(file.read_bytes()).hexdigest(), '{}'))
    remote = RemoteStudy('user@host', root, index, tmp_path / 'cache', runner=transport(tmp_path))
    remote.prepare()
    api = TestClient(create_app(remote.index, remote.study, fetcher=remote.fetch, archive_fetcher=remote.fetch_archive))
    response = api.get('/api/artifacts/report/content')
    assert response.status_code == 200
    assert 'data:image/svg+xml;base64,' in response.text
    assert api.get('/api/artifacts/archive/content').status_code == 403


@pytest.mark.parametrize('host', ['-oProxyCommand=bad', 'host;touch bad', 'user@host bad'])
def test_rejects_ssh_option_injection(tmp_path, host):
    from network_dashboard.remote import RemoteStudy
    with pytest.raises(ValueError, match='SSH'):
        RemoteStudy(host, Path('/study'), Path('/index'), tmp_path)


def test_correcting_hostname_uses_separate_default_cache_without_deleting_old_files(tmp_path, monkeypatch):
    from network_dashboard.remote import RemoteStudy
    monkeypatch.setattr(Path, 'home', classmethod(lambda cls: tmp_path))
    legacy = tmp_path / '.cache/network-dashboard'
    old = RemoteStudy('logben@ogin.sherlock.stanford.edu', Path('/study'), Path('/index'), legacy)
    (old.cache / 'keep.txt').write_text('cached bytes')
    corrected = RemoteStudy('logben@login.sherlock.stanford.edu', Path('/study'), Path('/index'))
    assert corrected.cache != legacy
    assert corrected.cache.parent == legacy
    assert (legacy / 'keep.txt').read_text() == 'cached bytes'
    assert json.loads((legacy / 'source.json').read_text())['ssh'] == 'logben@ogin.sherlock.stanford.edu'
    assert RemoteStudy('logben@login.sherlock.stanford.edu', Path('/study'), Path('/index')).cache == corrected.cache


def test_existing_matching_default_cache_is_reused(tmp_path, monkeypatch):
    from network_dashboard.remote import RemoteStudy
    monkeypatch.setattr(Path, 'home', classmethod(lambda cls: tmp_path))
    legacy = tmp_path / '.cache/network-dashboard'
    RemoteStudy('sherlock', Path('/study'), Path('/index'), legacy)
    assert RemoteStudy('sherlock', Path('/study'), Path('/index')).cache == legacy


def test_default_caches_isolate_accounts_studies_and_indexes(tmp_path, monkeypatch):
    from network_dashboard.remote import RemoteStudy
    monkeypatch.setattr(Path, 'home', classmethod(lambda cls: tmp_path))
    variants = [('user@host','/study','/index'),('other@host','/study','/index'),
                ('user@host','/other','/index'),('user@host','/study','/other-index')]
    caches = {RemoteStudy(host,Path(study),Path(index)).cache for host,study,index in variants}
    assert len(caches) == len(variants)


def test_explicit_cache_cannot_be_reassigned(tmp_path):
    from network_dashboard.remote import RemoteStudy
    RemoteStudy('old@host', Path('/study'), Path('/index'), tmp_path)
    with pytest.raises(ValueError, match='different'):
        RemoteStudy('new@host', Path('/study'), Path('/index'), tmp_path)
    assert json.loads((tmp_path/'source.json').read_text())['ssh'] == 'old@host'


@pytest.mark.parametrize('code,stderr,status,hint', [
    (1, b'cat: /oak/shared/records.sqlite: Permission denied\n', 403, 'Oak read access'),
    (1, b'cat: /oak/shared/records.sqlite: No such file or directory\n', 404, 'missing'),
    (255, b'user@host: Permission denied (publickey,password).\n', 503, 'authenticate'),
    (255, b'Connection timed out\n', 503, 'SSH connection'),
])
def test_download_reports_real_cause_and_preserves_cache(tmp_path, code, stderr, status, hint):
    import subprocess
    from network_dashboard.remote import RemoteStudy
    def fail(command, **kwargs):
        kwargs['stdout'].write(b'partial transfer')
        raise subprocess.CalledProcessError(code, command, stderr=stderr)
    remote = RemoteStudy('user@host', Path('/study'), Path('/oak/shared/records.sqlite'), tmp_path, runner=fail)
    target = tmp_path / 'records.sqlite'
    target.write_bytes(b'previous valid index')
    with pytest.raises(HTTPException) as raised:
        remote._download(remote.remote_index, target)
    assert raised.value.status_code == status
    assert str(remote.remote_index) in raised.value.detail
    assert stderr.decode().strip() in raised.value.detail
    assert hint in raised.value.detail
    assert target.read_bytes() == b'previous valid index'
    assert not list(tmp_path.glob('.download-*'))


def test_local_write_failure_does_not_recommend_ssh_authentication(tmp_path):
    from network_dashboard.remote import RemoteStudy
    def fail(command, **kwargs):
        raise OSError('No space left on device')
    remote = RemoteStudy('user@host', Path('/study'), Path('/index'), tmp_path, runner=fail)
    with pytest.raises(HTTPException) as raised:
        remote._download(Path('/index'), tmp_path / 'index')
    assert 'No space left on device' in raised.value.detail
    assert 'local' in raised.value.detail
    assert 'authenticate' not in raised.value.detail
