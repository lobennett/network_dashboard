"""Serve through localhost; use SSH forwarding for remote studies."""
import argparse
from pathlib import Path
import sys
import subprocess

import uvicorn

from network_dashboard.api import create_app


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == 'connect':
        return connect_main(argv[1:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True, type=Path)
    parser.add_argument("--study", required=True, type=Path)
    parser.add_argument("--web", type=Path)
    parser.add_argument("--port", type=int, default=18782)
    parser.add_argument("--get-artifact", help="fetch one registered file with DataLad, verify it, and exit")
    parser.add_argument("--allow-origin", action="append", default=[], help="exact HTTPS frontend origin allowed to read this local API")
    args = parser.parse_args(argv)
    if not args.index.is_file() or not args.study.is_dir():
        parser.error("index and study must exist")
    if args.get_artifact:
        from fastapi import HTTPException
        from network_dashboard.fetch import fetch_artifact
        try:
            print(fetch_artifact(args.index, args.study, args.get_artifact))
        except HTTPException as error:
            parser.error(str(error.detail))
        return
    uvicorn.run(create_app(args.index, args.study, args.web, allowed_origins=args.allow_origin), host="127.0.0.1", port=args.port)


def connect_main(argv):
    from fastapi import HTTPException
    from .remote import RemoteStudy, DEFAULT_STUDY, DEFAULT_INDEX, ORIGIN
    parser = argparse.ArgumentParser(description='Connect to Oak and cache review files when opened. Requires SSH only.')
    parser.add_argument('--ssh', required=True, help='your SUNetID@login.sherlock.stanford.edu or SSH host alias')
    parser.add_argument('--study', type=Path, default=Path(DEFAULT_STUDY))
    parser.add_argument('--index', type=Path, default=Path(DEFAULT_INDEX))
    parser.add_argument('--cache', type=Path, help='cache directory (default: separate cache per connection under ~/.cache/network-dashboard)')
    parser.add_argument('--origin', default=ORIGIN)
    parser.add_argument('--port', type=int, default=18782)
    parser.add_argument('--web', type=Path, help='serve a locally built frontend (development/demo)')
    parser.add_argument('--reference-study', type=Path, help='completed pilot study in the same Oak parent')
    parser.add_argument('--reference-index', type=Path, help='index for that pilot')
    parser.add_argument('--reference-subject', help='subject whose completed pilot outputs should be linked')
    args = parser.parse_args(argv)
    reference_args = (args.reference_study, args.reference_index, args.reference_subject)
    if any(reference_args) and not all(reference_args):
        parser.error('provide --reference-study, --reference-index and --reference-subject together')
    try:
        remote = RemoteStudy(args.ssh, args.study, args.index, args.cache)
        app = create_app(remote.index, remote.study, args.web, allowed_origins=[args.origin], fetcher=remote.fetch,
                         archive_fetcher=remote.fetch_archive)
        remote.authenticate()
        remote.prepare()
        if all(reference_args):
            pilot = RemoteStudy(args.ssh, args.reference_study, args.reference_index)
            pilot.ssh_options = remote.ssh_options
            pilot.prepare()
            remote.add_reference(pilot, args.reference_subject)
    except (HTTPException, ValueError, OSError, subprocess.SubprocessError) as error:
        parser.error(str(getattr(error, 'detail', error)))
    destination = f'http://127.0.0.1:{args.port}' if args.web else args.origin
    print(f'Open {destination}. Leave this terminal running.\nCache: {remote.cache}', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port)
