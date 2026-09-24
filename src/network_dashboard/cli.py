"""Serve through localhost; use SSH forwarding for remote studies."""
import argparse
from pathlib import Path

import uvicorn

from network_dashboard.api import create_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True, type=Path)
    parser.add_argument("--study", required=True, type=Path)
    parser.add_argument("--web", type=Path)
    parser.add_argument("--port", type=int, default=18782)
    args = parser.parse_args()
    if not args.index.is_file() or not args.study.is_dir():
        parser.error("index and study must exist")
    uvicorn.run(create_app(args.index, args.study, args.web), host="127.0.0.1", port=args.port)
