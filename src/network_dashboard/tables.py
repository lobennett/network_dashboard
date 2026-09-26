"""Bounded, checksum-verified event and saved-design previews."""
import csv
import math
import re
from pathlib import Path
from fastapi import HTTPException


def table_kind(path: str) -> str | None:
    name = Path(path).name.lower()
    if name.endswith('_events.tsv'):
        return 'events'
    if name.endswith(('.tsv', '.csv')) and any(x in name for x in ('designmatrix', 'design_matrix', 'design-matrix')):
        return 'design'
    return None


def read_table(path: Path, *, name: str | None = None, max_rows=5000, max_columns=128):
    name = name or str(path)
    kind = table_kind(name)
    if not kind:
        raise HTTPException(400, 'Choose an events TSV or a saved design-matrix CSV/TSV')
    if path.stat().st_size > 20 * 1024 * 1024:
        raise HTTPException(413, 'Table exceeds the 20 MB preview limit; download it to inspect locally')
    with path.open(newline='', encoding='utf-8-sig') as stream:
        reader = csv.DictReader(stream, delimiter=',' if name.endswith('.csv') else '\t')
        fields = reader.fieldnames or []
        if not fields or len(set(fields)) != len(fields):
            raise HTTPException(422, 'Table must have distinct column names')
        if kind == 'events' and not {'onset', 'duration'}.issubset(fields):
            raise HTTPException(422, 'Events require onset and duration columns')
        shown, total, backwards, previous = [], 0, 0, None
        trials = []
        for row in reader:
            total += 1
            if None in row or any(v is None for v in row.values()):
                raise HTTPException(422, 'Table contains a malformed row')
            if kind == 'events':
                if row.get('trial_id') == 'test_trial':
                    trials.append({key: row.get(key) for key in ('trial_id','trial_type','choice_acc','response_time','key_press','correct_response')})
                try:
                    onset = float(row['onset'])
                    if math.isfinite(onset):
                        backwards += int(previous is not None and onset < previous)
                        previous = onset
                except ValueError:
                    pass
            if len(shown) < max_rows:
                shown.append({k: row[k] for k in fields[:max_columns]})
    from network_dashboard.behavior import summarize_behavior
    task_match = re.search(r"(?:^|_)task-([^_]+)", Path(name).name)
    task = task_match.group(1) if task_match else ""
    return {'kind': kind, 'columns': fields[:max_columns], 'rows': shown,
            'behavior': summarize_behavior(trials, task=task) if kind == 'events' else None,
            'total_rows': total, 'total_columns': len(fields),
            'truncated': total > max_rows or len(fields) > max_columns,
            'nonmonotonic_pairs': backwards if kind == 'events' else None}
