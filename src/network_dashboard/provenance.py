"""Bounded traversal of recorded input ancestry; never infer links from filenames."""
import json
from collections import deque

from fastapi import HTTPException


def ancestry_tree(db, identity):
    selected = db.execute('SELECT * FROM artifact_versions WHERE id=?', (identity,)).fetchone()
    if selected is None:
        raise HTTPException(404, 'Unknown artifact')
    queue, seen = deque([identity]), set()
    artifacts, links, attempts = {}, [], {}
    truncated = False
    while queue:
        current = queue.popleft()
        if current in seen:
            continue
        if len(seen) >= 500 or len(links) >= 2000:
            truncated = True
            break
        seen.add(current)
        row = db.execute('SELECT * FROM artifact_versions WHERE id=?', (current,)).fetchone()
        if row is None:
            continue
        artifacts[current] = dict(row)
        parents = db.execute('SELECT * FROM lineage_links WHERE output=? ORDER BY input,attempt LIMIT ?',
                             (current, 2001-len(links))).fetchall()
        for link in parents:
            if len(links) >= 2000:
                truncated = True
                break
            links.append(dict(link))
            queue.append(link['input'])
            key = link['attempt']
            if key not in attempts:
                attempt = db.execute('SELECT evidence_json FROM processing_attempts WHERE id=?', (key,)).fetchone()
                if attempt:
                    attempts[key] = json.loads(attempt[0])
    return {'artifact': dict(selected), 'artifacts': list(artifacts.values()), 'links': links,
            'attempts': list(attempts.values()), 'truncated': truncated}
