"""Add completed reference outputs without replacing the active campaign.

The reference study must be mounted at ``mount`` within the served study on Oak.
All original artifact identities and ancestry are retained for checksum/privacy
checks. Only fMRIPrep and registration findings enter the subject view.
"""
import json
from pathlib import Path
import re
import sqlite3


def import_reference(index: Path, reference: Path, output: Path, *, subject: str,
                     mount: str, label: str, source_study: str | None = None) -> None:
    prefix = Path(mount)
    if (not re.fullmatch(r'[A-Za-z0-9]+', subject) or prefix.is_absolute()
            or '..' in prefix.parts or len(prefix.parts) != 2 or prefix.parts[0] != 'references'
            or '\\' in mount):
        raise ValueError('Reference mount must be references/<name> and subject must be a BIDS label')
    if output.resolve() in {index.resolve(), reference.resolve()}:
        raise ValueError('Write the combined index to a separate file')
    with sqlite3.connect(index.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(output) as db, sqlite3.connect(reference.as_uri() + '?mode=ro', uri=True) as pilot:
        source.backup(db)
        pilot.row_factory = sqlite3.Row
        metadata = dict(pilot.execute('SELECT key,value FROM metadata'))
        if metadata.get('schema_version') != '2':
            raise ValueError('Reference requires schema version 2')
        projects = json.loads(metadata.get('active_projects', '{}'))
        paths = {stage: (prefix / value['path']).as_posix() for stage, value in projects.items()}
        roots = pilot.execute("SELECT * FROM artifacts WHERE kind LIKE 'dataset:%'").fetchall()
        for row in roots:
            path = Path(row['path'])
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe reference dataset path')
            kind = row['kind']
            if db.execute('SELECT 1 FROM artifacts WHERE kind=?', (kind,)).fetchone():
                raise ValueError(f'Reference dataset already belongs to the active study: {kind}')
        # Ancestry includes defaced raw inputs and the original surface handoff.
        # Do not copy pilot scan decisions, stage states, or raw scan inventory.
        for table in ('artifact_versions', 'artifact_observations', 'lineage_links'):
            for row in pilot.execute(f'SELECT * FROM {table}'):
                if table == 'artifact_versions':
                    previous = db.execute('SELECT dataset_id,path,content_id FROM artifact_versions WHERE id=?', (row['id'],)).fetchone()
                    if previous and previous != (row['dataset_id'], row['path'], row['content_id']):
                        raise ValueError('Conflicting reference artifact identity')
                placeholders = ','.join('?' for _ in row)
                db.execute(f'INSERT OR IGNORE INTO {table} VALUES ({placeholders})', tuple(row))
        for row in pilot.execute('SELECT * FROM processing_attempts'):
            values = dict(row)
            evidence = json.loads(values['evidence_json'])
            evidence['reference_subject'] = subject
            evidence['reference_study_commit'] = metadata['study_commit']
            values['evidence_json'] = json.dumps(evidence)
            columns = ','.join(values)
            placeholders = ','.join('?' for _ in values)
            db.execute(f'INSERT OR IGNORE INTO processing_attempts ({columns}) VALUES ({placeholders})', tuple(values.values()))
        seen_roots = set()
        for row in roots:
            if row['kind'] in seen_roots:
                continue
            seen_roots.add(row['kind'])
            values = {k: row[k] for k in row.keys() if k != 'id'}
            values['path'] = (prefix / row['path']).as_posix()
            columns = ','.join(values)
            placeholders = ','.join('?' for _ in values)
            db.execute(f'INSERT INTO artifacts ({columns}) VALUES ({placeholders})', tuple(values.values()))
        types = ('fmriprep-output-check', 'registration-output', 'final-output-review')
        for row in pilot.execute('SELECT f.* FROM findings f JOIN entities e USING(entity_key) WHERE e.subject=?', (subject,)):
            if row['finding_type'] not in types:
                continue
            entity = pilot.execute('SELECT * FROM entities WHERE entity_key=?', (row['entity_key'],)).fetchone()
            db.execute('INSERT OR IGNORE INTO entities VALUES (' + ','.join('?' for _ in entity) + ')', tuple(entity))
            values = {k: row[k] for k in row.keys() if k != 'id'}
            values['evidence_path'] = (prefix / row['evidence_path']).as_posix()
            evidence = json.loads(values['evidence_json'])
            evidence['reference_study_commit'] = metadata['study_commit']
            values['evidence_json'] = json.dumps(evidence)
            db.execute('INSERT OR IGNORE INTO findings (' + ','.join(values) + ') VALUES (' + ','.join('?' for _ in values) + ')', tuple(values.values()))
        final = [dict(r) for r in pilot.execute("SELECT d.* FROM decisions d JOIN entities e USING(entity_key) WHERE e.subject=? AND d.scope='output'", (subject,))]
        context = {'label': label, 'study_commit': metadata['study_commit'],
                   'study_id': metadata['study_id'], 'mount': mount, 'projects': paths,
                   'source_projects': projects, 'decisions': []}
        if source_study:
            context['source_study'] = source_study
        # Registration datasets are not part of active_projects in older indexes.
        for row in roots:
            if Path(row['path']).name.startswith('fmriprepviz-'):
                context['projects']['fmriprepviz'] = (prefix / row['path']).as_posix()
        existing = db.execute("SELECT value FROM metadata WHERE key='reference_stages'").fetchone()
        contexts = json.loads(existing[0]) if existing else {}
        contexts[subject] = {'fmriprep': context, 'registration': {**context, 'decisions': final}}
        db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', ('reference_stages', json.dumps(contexts)))
        db.commit()
