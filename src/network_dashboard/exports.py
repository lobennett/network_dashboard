"""Analysis handoff from recorded decisions and exact input identities."""
import csv
import io
import json
import re
from collections import defaultdict

from .records import rows, published_availability

SCOPES = {'preprocessing', 'task_first_level', 'timeseries'}
EXCLUDED = {'drop', 'exclude', 'reject'}


def _key(row):
    values = [str(row.get(name) or '') for name in ('subject', 'session', 'task', 'run', 'acquisition')]
    if values[3].isdigit():
        values[3] = str(int(values[3]))
    return tuple(values)


def _path_key(path):
    entities = dict(re.findall(r'(?:^|_)(sub|ses|task|run|acq)-([^_/.]+)', path.rsplit('/', 1)[-1]))
    return _key(dict(zip(('subject', 'session', 'task', 'run', 'acquisition'),
                        (entities.get(name, '') for name in ('sub', 'ses', 'task', 'run', 'acq')))))


def _role(path):
    if path.endswith('_events.tsv'):
        return 'events'
    if path.endswith('_desc-confounds_timeseries.tsv'):
        return 'confounds'
    if path.endswith(('_bold.dtseries.nii', '_bold.func.gii')) or '_desc-preproc_bold.' in path:
        return 'preprocessed_bold'
    if path.endswith(('_bold.nii.gz', '_bold.nii')) and '_space-' not in path and '_desc-' not in path:
        return 'raw_bold'
    return None


def _inputs(db):
    files = defaultdict(list)
    known_raw = set()
    for row in rows(db, 'SELECT path FROM artifact_versions'):
        if _role(row['path']) == 'raw_bold':
            known_raw.add(_path_key(row['path']))
    for row in rows(db, "SELECT DISTINCT a.*,o.commit_hash,o.availability FROM artifact_versions a JOIN artifact_observations o ON a.id=o.artifact_id WHERE o.commit_hash IS NOT NULL AND o.availability IN ('available','unavailable')"):
        role = _role(row['path'])
        if role:
            row['availability'] = published_availability(db, row['id']) or row['availability']
            item = {k: row[k] for k in ('id', 'dataset_id', 'path', 'content_id', 'commit_hash', 'availability')}
            item['role'] = role
            item['derivative_set'] = f"{row['dataset_id']}@{row['commit_hash']}"
            files[_path_key(row['path'])].append(item)
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='archived_inputs'").fetchone():
        for row in rows(db, 'SELECT * FROM archived_inputs'):
            value = {**json.loads(row['details']), 'archive_id': row['archive_id'], 'archive_member': row['member']}
            if value['availability'] == 'archived_unavailable':
                value['archive_member'] = None
            value['role'] = _role(row['path'])
            value['derivative_set'] = f"archive:{row['archive_id']}"
            files[_path_key(row['path'])].append(value)
    return files, known_raw


def _required_inputs(inputs, scope):
    roles = defaultdict(list)
    for item in inputs:
        roles[item['role']].append(item)
    if scope == 'preprocessing':
        required = {'raw_bold': roles['raw_bold']}
        derivative_sets = []
    else:
        grouped = defaultdict(lambda: defaultdict(list))
        for item in inputs:
            if item['role'] in {'preprocessed_bold', 'confounds'}:
                grouped[item['derivative_set']][item['role']].append(item)
        derivative_sets = [{'id': identity, 'inputs': dict(items),
                            'complete': all(any(f['availability'] in {'available', 'archived'} for f in items[role])
                                            for role in ('preprocessed_bold', 'confounds'))}
                           for identity, items in grouped.items()]
        complete = [group for group in derivative_sets if group['complete']]
        required = {role: [f for group in complete for f in group['inputs'][role]]
                    for role in ('preprocessed_bold', 'confounds')}
        if scope == 'task_first_level':
            required['events'] = roles['events']
    missing = [role for role, items in required.items()
               if not any(f['availability'] in {'available', 'archived'} for f in items)]
    return required, missing, derivative_sets


def analysis_manifest(db, scope, *, subject=None, task=None):
    if scope not in SCOPES:
        raise ValueError('Unknown analysis scope')
    metadata = dict(db.execute('SELECT key,value FROM metadata'))
    decisions = defaultdict(list)
    for row in rows(db, 'SELECT * FROM decisions'):
        decisions[row['entity_key']].append(row)
    files, known_raw = _inputs(db)
    archive_inventory = bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='archived_inputs'").fetchone())
    entities = rows(db, "SELECT * FROM entities WHERE namespace='raw' AND suffix='bold' AND (echo IS NULL OR echo='') ORDER BY subject,session,task,run")
    matches = lambda entity: ((not subject or entity['subject'] == subject.removeprefix('sub-'))
                              and (not task or entity['task'] == task.removeprefix('task-')))
    scans = []
    unmatched = []
    for entity in filter(matches, entities):
        ds = decisions[entity['entity_key']]
        if _key(entity) not in known_raw:
            unmatched.extend({**d, 'match_status': 'no_indexed_raw_scan',
                              'entities': {k: entity.get(k) for k in ('subject', 'session', 'task', 'run', 'acquisition')}}
                             for d in ds if d['scope'] in {scope, 'preprocessing'})
            continue
        pre = [d for d in ds if d['scope'] == 'preprocessing']
        chosen = [d for d in ds if d['scope'] == scope]
        excluded = [d for d in pre + chosen if d['decision'] in EXCLUDED]
        explicit_keep = any(d['decision'] in {'keep', 'include', 'approve'} for d in pre)
        required, missing, derivative_sets = _required_inputs(files[_key(entity)], scope)
        if excluded:
            selection = 'excluded'
        elif scope == 'task_first_level' and entity['task'] == 'rest':
            selection = 'not_applicable'
        elif not explicit_keep:
            selection = 'undecided'
        elif missing:
            selection = ('inventory_pending' if scope!='preprocessing' and not archive_inventory
                         and {'preprocessed_bold','confounds'} & set(missing) else 'missing_inputs')
        elif any(items and all(f['availability'] == 'archived' for f in items) for items in required.values()):
            selection = 'candidate_archived'
        else:
            selection = 'candidate'
        scans.append({**{k: entity.get(k) for k in ('entity_key', 'subject', 'session', 'task', 'run', 'acquisition')},
                      'selection': selection,
                      'reasons': list(dict.fromkeys(d.get('reason') or 'Recorded exclusion' for d in excluded)),
                      'missing_inputs': missing, 'preprocessing_decisions': pre,
                      'scope_decisions': chosen, 'inputs': required, 'derivative_sets': derivative_sets})
    for scan in scans:
        ambiguous = [row for row in unmatched if all(not value or str(scan.get(key) or '') == str(value)
                                                     for key, value in row['entities'].items())]
        if ambiguous and scan['selection'] not in {'excluded', 'not_applicable'}:
            scan['selection'] = 'undecided'
            scan['reasons'].append('A partial or unmatched decision may apply; review unmatched_decisions before analysis.')
    return {'schema_version': 1, 'scope': scope,
            'snapshot': {k: metadata.get(k) for k in ('study_id', 'study_commit', 'built_at', 'publication_audited_at')},
            'filters': {'subject': subject, 'task': task},
            'interpretation': 'Candidate means recorded preprocessing retention with a complete input set and no recorded exclusion for this scope. Candidate_archived requires extraction of the pinned archive members. Inventory_pending means archive membership has not yet been published; it does not establish missing data. Choose one complete derivative set; never mix campaigns. This is not approval of a model or every time-series method. Review unmatched decisions before using the manifest. Do not trim canonical BOLD/confounds or shift canonical events again.',
            'datasets': rows(db, "SELECT path,kind,commit_hash FROM artifacts WHERE kind='dataset' OR kind LIKE 'dataset:%'"),
            'counts': {state: sum(s['selection'] == state for s in scans) for state in
                       ('candidate', 'candidate_archived', 'excluded', 'undecided', 'inventory_pending', 'missing_inputs', 'not_applicable')},
            'unmatched_decisions': unmatched, 'scans': scans}


def analysis_tsv(manifest):
    stream = io.StringIO()
    fields = ['scope', 'study_commit', 'snapshot_built_at', 'subject', 'session', 'task', 'run', 'acquisition',
              'selection', 'reasons', 'missing_inputs', 'preprocessing_decisions', 'scope_decisions', 'inputs',
              'derivative_sets']
    writer = csv.DictWriter(stream, fieldnames=fields, delimiter='\t', lineterminator='\n')
    writer.writeheader()
    scans = manifest['scans'] + [{**row['entities'], 'selection': 'unmatched_decision',
                                 'scope_decisions': [row], 'reasons': [row.get('reason')]} for row in manifest['unmatched_decisions']]
    for scan in scans:
        row = {key: scan.get(key) for key in fields}
        row.update(scope=manifest['scope'], study_commit=manifest['snapshot']['study_commit'],
                   snapshot_built_at=manifest['snapshot']['built_at'])
        for key, value in row.items():
            if isinstance(value, (dict, list)):
                row[key] = json.dumps(value, sort_keys=True, separators=(',', ':'))
            elif isinstance(value, str) and value.startswith(('=', '+', '-', '@')):
                row[key] = "'" + value
        writer.writerow(row)
    return stream.getvalue()
