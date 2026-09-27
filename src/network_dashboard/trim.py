"""Compare recorded global-signal counts without borrowing later MRIQC metrics."""
import csv
from fastapi import HTTPException
from network_dashboard.artifacts import content_path
from network_dashboard.records import dataset_roots
from network_dashboard.stages import stage_record, global_signal_label


def trim_summary(db, study, subject, fetcher=None):
    record = stage_record(db, study, subject, 'trim')
    roots = dataset_roots(db, study)
    reports, counts, errors = {}, {}, []
    for artifact in record['outputs']:
        root = roots.get(artifact['dataset_id'])
        label = global_signal_label(root, artifact['path']) if root else None
        if not label:
            continue
        kind = 'metrics' if artifact['path'].endswith('.tsv') else 'report'
        if kind in reports.setdefault(label, {}):
            errors.append(f'Ambiguous {label} {kind}; cannot choose a file version')
            reports[label][kind] = None
        else:
            reports[label][kind] = artifact
    for label, files in reports.items():
        artifact = files.get('metrics')
        if not artifact:
            continue
        try:
            path = fetcher(artifact['id']) if fetcher else content_path(db, study, artifact)
            if path.stat().st_size > 5 * 1024 * 1024:
                raise ValueError('metrics table exceeds 5 MB')
            with path.open(newline='') as stream:
                for row in csv.DictReader(stream, delimiter='\t'):
                    if row.get('subject', '').removeprefix('sub-') != subject:
                        continue
                    key = (row['session'].removeprefix('ses-'), row['task'], row['run'])
                    n = int(row['n_volumes'])
                    if n <= 0 or label in counts.setdefault(key, {}):
                        raise ValueError('invalid or duplicate scan volume count')
                    counts[key][label] = n
        except (HTTPException, OSError, ValueError, KeyError, csv.Error) as error:
            errors.append(f'{label}: {getattr(error, "detail", str(error))}')
            for value in counts.values():
                value.pop(label, None)
    scans = []
    for (session, task, run), value in sorted(counts.items()):
        before, after = value.get('pretrim'), value.get('posttrim')
        scans.append({'session': session, 'task': task, 'run': run, 'before': before,
                      'after': after, 'removed': before - after if before is not None and after is not None else None})
    return {'subject': subject, 'reports': reports, 'scans': scans, 'errors': errors,
            'source': 'Checksum-verified global-signal metrics (echo-2). Missing counts are not inferred.'}
