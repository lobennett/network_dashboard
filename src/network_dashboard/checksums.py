"""Verify image bytes using their recorded digest, including legacy annex MD5 keys."""
import hashlib
from pathlib import Path
import re


def verifiable(content_id: str) -> bool:
    return bool(re.fullmatch(r'(?:sha256:[a-f0-9]{64}|md5:[a-f0-9]{32})', content_id))


def matches(path: Path, content_id: str) -> bool:
    if not verifiable(content_id):
        return False
    algorithm, expected = content_id.split(':', 1)
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest() == expected
