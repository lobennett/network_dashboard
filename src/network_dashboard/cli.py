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
    parser.add_argument("--get-artifact", help="fetch one registered file with DataLad, verify it, and exit")
    parser.add_argument("--allow-origin", action="append", default=[], help="exact HTTPS frontend origin allowed to read this local API")
    args = parser.parse_args()
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
