"""Stage boundaries use recorded file identities, never later raw replacements."""
import json
import re
from typing import Literal

from network_dashboard.records import dataset_roots, rows

Stage = Literal['source', 'bids', 'trim', 'events', 'b0', 'mriqc', 'review', 'surfaces', 'fmriprep', 'registration']
PRODUCERS = {
    'source': {'flywheel-selection'},
    'bids': {'conversion', 'defacing', 'bids-assembled'},
    'trim': {'trim_dummy', 'gs-pretrim', 'dummy-volumes-trimmed', 'gs-posttrim'},
    'events': {'events', 'bids-events-generated', 'behavioral-sourcedata-ingested', 'participants-ingested'},
    'b0': {'b0-fieldmaps-linked', 'bids-precuration-validated'},
    'mriqc': {'mriqc', 'mriqc-complete'},
    'review': {'scan-decisions-generated', 'scan-decisions-approved', 'mriqc-curated', 'bids-curated-validated'},
    'surfaces': {'fsqc', 'freesurfer', 'freesurfer-complete', 'surface-evidence-extraction', 'surface-review-approved'},
    'fmriprep': {'fmriprep', 'fmriprep-complete', 'fmriprep-report-extraction'},
    'registration': {'fmriprepviz'},
}
FINDINGS = {
    'source': {'flywheel-acquisition'}, 'bids': set(), 'trim': set(),
    'events': {'behavior-truncation'}, 'b0': set(), 'mriqc': {'mriqc'},
    'review': {'scan-review'}, 'surfaces': {'surface-review', 'surface-qc'},
    'fmriprep': {'fmriprep-output-check'},
    'registration': {'registration-output', 'final-output-review'},
}


def stage_record(db, study, subject, stage):
    """Separate exact transformations from current files owned by this stage."""
    processing = []
    for row in rows(db, 'SELECT evidence_json FROM processing_attempts'):
        value = json.loads(row['evidence_json'])
        scope = value.get('scope', '')
        if value.get('stage') in PRODUCERS[stage] and (scope in ('dataset', f'sub-{subject}') or scope.startswith(f'sub-{subject}/')):
            processing.append(value)
    ids = {p['id'] for p in processing}
    links = [l for l in rows(db, 'SELECT * FROM lineage_links') if l['attempt'] in ids]
    roots = dataset_roots(db, study)
    pattern = re.compile(r'(?:^|[/_])sub-' + re.escape(subject) + r'(?:[/_.]|$)')
    files = rows(db, 'SELECT * FROM artifact_versions')
    subject_ids = {f['id'] for f in files if pattern.search(f['path'])}
    links = [link for link in links if link['output'] in subject_ids]
    inputs = {link['input'] for link in links}
    outputs = {link['output'] for link in links}
    input_files = [f for f in files if f['id'] in inputs]
    output_files = [{**f, 'stage_basis': 'recorded_transformation'} for f in files if f['id'] in outputs and pattern.search(f['path'])]
    metadata = dict(db.execute('SELECT key,value FROM metadata'))
    active = json.loads(metadata.get('active_projects', '{}'))
    active_key = {'surfaces': 'freesurfer', 'registration': 'fmriprepviz'}.get(stage, stage)
    active_path = active.get(active_key, {}).get('path')

    def owned(root):
        name = root.name.lower()
        return (stage == 'mriqc' and name.startswith('mriqc-') or
                stage == 'surfaces' and name.startswith(('freesurfer-8.', 'fsqc-')) or
                stage == 'fmriprep' and name.startswith('fmriprep-') and '+anat+' not in name or
                stage == 'registration' and name.startswith('fmriprepviz-'))

    # Derivative files are current stage outputs, not a historical Git snapshot.
    # Raw BIDS replacements are deliberately excluded from this fallback.
    current_ids = set()
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='artifact_observations'").fetchone():
        current_ids = {r[0] for r in db.execute("SELECT artifact_id FROM artifact_observations WHERE commit_hash IS NOT NULL AND availability IN ('available','unavailable')")}
    seen = {f['id'] for f in output_files}
    for file in files:
        root = roots.get(file['dataset_id'])
        if stage == 'trim' and root and file['id'] in current_ids and global_signal_label(root, file['path']):
            if file['id'] not in seen:
                output_files.append({**file, 'stage_basis': 'current_stage_dataset'})
                seen.add(file['id'])
            continue
        if not root or not owned(root) or file['id'] not in current_ids or not pattern.search(file['path']):
            continue
        expected = active_path
        if stage == 'surfaces' and root.name.startswith('fsqc-') and active_path:
            expected = re.sub(r'FreeSurfer-8\.[^+]+', 'fsqc-2.1.4', active_path)
        if expected and str(root.relative_to(study)) not in {expected, expected + '+review'}:
            continue
        if file['id'] not in seen:
            output_files.append({**file, 'stage_basis': 'current_stage_dataset'})
            seen.add(file['id'])
    findings = [f for f in rows(db, 'SELECT f.* FROM findings f JOIN entities e USING(entity_key) WHERE e.subject=?', (subject,)) if f['finding_type'] in FINDINGS[stage]]
    if stage == 'surfaces' and active_path:
        findings = [f for f in findings if f['finding_type'] != 'surface-qc' or json.loads(f['evidence_json']).get('source_project') == active_path]
        output_files = [f for f in output_files if not (roots.get(f['dataset_id']) and roots[f['dataset_id']].name.startswith('fsqc-')) or str(roots[f['dataset_id']].relative_to(study)) == re.sub(r'FreeSurfer-8\.[^+]+', 'fsqc-2.1.4', active_path)]
    decisions = rows(db, 'SELECT d.* FROM decisions d JOIN entities e USING(entity_key) WHERE e.subject=?', (subject,))
    scopes = {'review': {'preprocessing', 'task_first_level', 'timeseries'}, 'surfaces': {'surface'}, 'registration': {'output'}}.get(stage, set())
    decisions = [d for d in decisions if d['scope'] in scopes]
    milestones = [a for a in rows(db, "SELECT * FROM stage_attempts WHERE scope IN (?, 'dataset') OR scope LIKE ?", (f'sub-{subject}', f'sub-{subject}/%')) if a['stage'] in PRODUCERS[stage]]
    supporting_files = stage_supporting_files(files, current_ids, roots, study, subject, stage)
    return {'stage': stage, 'subject': subject, 'processing': processing,
            'supporting_files': supporting_files,
            'inputs': input_files, 'outputs': output_files, 'findings': findings,
            'decisions': decisions, 'milestones': milestones,
            'snapshot_kind': 'recorded_stage_evidence',
            'note': 'Recorded transformations identify exact file versions. Current derivative files are labeled separately. A complete historical checkout is not implied; absent records remain unknown.'}


def global_signal_label(root, path):
    """Recognize only the two dedicated global-signal derivative directories."""
    from pathlib import PurePosixPath
    relative = PurePosixPath(path)
    if relative.name not in {'gs_metrics.tsv', 'gs.pdf'}:
        return None
    for label in ('pretrim', 'posttrim'):
        if root.name == f'gs-{label}' or relative.parts == ('derivatives', f'gs-{label}', relative.name):
            return label
    return None


def stage_supporting_files(files, current_ids, roots, study, subject, stage):
    """Offer named current receipts separately from historical image outputs."""
    from pathlib import PurePosixPath
    result=[]
    for file in files:
        if file['id'] not in current_ids or not file['path'].endswith(('.json','.tsv','.txt','.log','.html','.csv')):
            continue
        root=roots.get(file['dataset_id'])
        if root is None:
            continue
        path=PurePosixPath(file['path']);name=path.name
        belongs=False;purpose=''
        # Shared milestones name the producer exactly; they are dataset-wide evidence.
        if file['path'].startswith('code/network_fmri/milestones/') and name[:-5] in PRODUCERS[stage] and name.endswith('.json'):
            belongs=True;purpose='Dataset milestone receipt'
        if stage=='bids' and name==f'sub-{subject}.json' and '/network_fw2bids/' in '/'+file['path']:
            belongs=True;purpose='Defacing receipt' if 'defacing' in path.parts else 'Conversion receipt'
        if stage=='events' and name in {'behavioral_exceptions.tsv','analysis_exclusions.tsv','participants.tsv','participants.json'}:
            belongs=True;purpose='Behavioral exceptions' if 'exceptions' in name else 'Analysis exclusions' if 'exclusions' in name else 'Participant metadata'
        if stage=='b0' and (root.name=='bids-validator' or path.parts[:2]==('derivatives','bids-validator')) and name in {'desc-precuration_validation.json','desc-precuration_validation.log'}:
            belongs=True;purpose='BIDS validator report'
        if stage=='review' and name in {'scan_decisions.tsv','analysis_exclusions.tsv'}:
            belongs=True;purpose='Scan decisions' if name=='scan_decisions.tsv' else 'Analysis exclusions'
        if stage=='surfaces' and root.name.startswith('fsqc-') and name in {'fsqc-results.csv','surface-qc.json'}:
            belongs=True;purpose='FSQC metrics' if name.endswith('.csv') else 'FSQC provenance'
        if stage=='surfaces' and name=='surface_review.tsv':
            belongs=True;purpose='Surface review decisions'
        if stage=='review' and (root.name=='bids-validator' or path.parts[:2]==('derivatives','bids-validator')) and name in {'desc-curated_validation.json','desc-curated_validation.log'}:
            belongs=True;purpose='Curated BIDS validator report'
        if belongs:
            result.append({**file,'purpose':purpose,'stage_basis':'current_supporting_record'})
    return sorted(result,key=lambda f:(f['purpose'],f['path']))
