"""Export recorded scan decisions without turning absent reviews into approvals."""
import csv
import io
import json

from fastapi import HTTPException
from network_dashboard.records import rows


def subject_manifest(db, subject):
    entities = rows(db, "SELECT * FROM entities WHERE subject=? AND namespace='raw' AND suffix='bold' AND (echo IS NULL OR echo='') ORDER BY session,task,run", (subject,))
    if not entities:
        raise HTTPException(404, 'No functional scans indexed for this subject')
    metadata = dict(db.execute('SELECT key,value FROM metadata'))
    decisions = rows(db, 'SELECT d.* FROM decisions d JOIN entities e USING(entity_key) WHERE e.subject=?', (subject,))
    findings = rows(db, 'SELECT f.* FROM findings f JOIN entities e USING(entity_key) WHERE e.subject=?', (subject,))
    scans = []
    for entity in entities:
        key = entity['entity_key']
        review = next((json.loads(f['evidence_json']) for f in findings if f['entity_key'] == key and f['finding_type'] == 'scan-review'), {})
        by_scope = {d['scope']: d for d in decisions if d['entity_key'] == key}
        preprocessing = by_scope.get('preprocessing', {})
        task = by_scope.get('task_first_level', {})
        original, current = review.get('original_tr_count'), review.get('tr_count')
        try:
            removed = int(original) - int(current)
        except (TypeError, ValueError):
            removed = None
        scans.append({**{k: entity.get(k) for k in ('entity_key', 'subject', 'session', 'task', 'run', 'acquisition')},
                      'preprocessing': preprocessing.get('decision', 'unrecorded'),
                      'preprocessing_reason': preprocessing.get('reason'),
                      'review_required': review.get('approval_required', 'unrecorded'),
                      'review_approved': review.get('approved', 'unrecorded'),
                      'reviewer': preprocessing.get('reviewer'),
                      'flags': review.get('flags'),
                      'task_first_level': task.get('decision', 'not_applicable' if entity['task'] == 'rest' else 'no_exclusion_recorded'),
                      'task_first_level_reason': task.get('reason'),
                      'timeseries_analysis': by_scope.get('timeseries', {}).get('decision', 'no_decision_recorded'),
                      'original_tr_count': original, 'tr_count': current,
                      'volumes_removed': removed, 'event_status': review.get('event_status', 'unrecorded'),
                      'behavioral_status': review.get('behavioral_status', 'unrecorded'),
                      'fd_mean_mm': review.get('fd_mean'), 'dvars_std': review.get('dvars_std')})
    attempts = rows(db, "SELECT evidence_json FROM processing_attempts")
    software = [json.loads(a['evidence_json']) for a in attempts]
    software = [a for a in software if a.get('scope') in ('dataset', f'sub-{subject}') or f'sub-{subject}/' in a.get('scope', '')]
    # Include observations verbatim: a registered version can be historical or unavailable.
    files = rows(db, "SELECT a.*,o.commit_hash,o.availability FROM artifact_versions a LEFT JOIN artifact_observations o ON o.artifact_id=a.id WHERE instr('/' || a.path,?)>0 OR instr('/' || a.path,?)>0 ORDER BY a.path", (f'/sub-{subject}/', f'/sub-{subject}_'))
    return {'schema_version': 1, 'subject': subject, 'snapshot': metadata,
            'release_status': 'snapshot_not_a_frozen_release',
            'interpretation': {'no_exclusion_recorded': 'Absence of a recorded exclusion is not analysis approval.',
                               'timeseries_analysis': 'Preprocessing retention does not certify suitability for every time-series analysis.',
                               'timing': 'Canonical outputs are trimmed upstream. Do not trim BOLD/confounds or shift canonical event onsets again. Check per-run sidecars and recorded volume counts.',
                               'designs': 'Event files are not fitted designs. Validate the saved analysis-specific design against the matching BOLD and confounds.'},
            'scans': scans, 'decisions': decisions,
            'datasets': rows(db, "SELECT path,kind,commit_hash FROM artifacts WHERE kind='dataset' OR kind LIKE 'dataset:%'"),
            'processing': software, 'files': files}


def scan_tsv(manifest):
    stream = io.StringIO()
    fields = ['study_commit', 'snapshot_built_at', *manifest['scans'][0].keys()]
    writer = csv.DictWriter(stream, fieldnames=fields, delimiter='\t', lineterminator='\n')
    writer.writeheader()
    for scan in manifest['scans']:
        writer.writerow({'study_commit': manifest['snapshot'].get('study_commit'),
                         'snapshot_built_at': manifest['snapshot'].get('built_at'), **scan})
    return stream.getvalue()
