"""Inspect current B0 relationships without inventing historical lineage."""
import json
import re
from fastapi import HTTPException
from .artifacts import content_path
from .coverage import identity
from .records import rows

BASIS = 'Current checksum-verified sidecars; not a historical stage snapshot.'


def current_files(db, subject):
    datasets = {d['kind'][8:] for d in rows(db, "SELECT path,kind FROM artifacts WHERE kind LIKE 'dataset:%'")
                if d['path'] in {'sourcedata/raw', 'sourcedata/rawbids'}}
    files = rows(db, "SELECT DISTINCT a.* FROM artifact_versions a JOIN artifact_observations o ON o.artifact_id=a.id WHERE o.commit_hash IS NOT NULL AND o.availability IN ('available','unavailable')")
    return [f for f in files if f['dataset_id'] in datasets and f['path'].startswith('sub-') and identity(f['path']).get('subject') == subject]


def inventory(db, subject):
    groups = {}
    for file in current_files(db, subject):
        scan = identity(file['path'])
        if scan['datatype'] != 'func' or scan['suffix'] != 'bold' or not file['path'].endswith('.json'):
            continue
        key = (file['dataset_id'], re.sub(r'_echo-[^_]+', '', file['path']))
        group = groups.setdefault(key, {'id': file['id'], 'session': scan.get('session',''),
                                      'task': scan.get('task',''), 'run': scan.get('run',''), 'echoes': []})
        group['echoes'].append(file)
    return {'basis': BASIS, 'scans': sorted(groups.values(), key=lambda s: (s['session'],s['task'],s['run']))}


def identifiers(value):
    if isinstance(value,str) and value.strip():
        return [value]
    if isinstance(value,list) and value and all(isinstance(v,str) and v.strip() for v in value):
        return sorted(set(value))
    return []


def check(db, study, subject, scan_id, fetcher=None):
    scan = next((s for s in inventory(db,subject)['scans'] if s['id']==scan_id),None)
    if scan is None:
        raise HTTPException(404,'Unknown current BOLD scan')
    def read(file):
        path = fetcher(file['id']) if fetcher else content_path(db,study,file)
        if path.stat().st_size > 1024 * 1024:
            raise ValueError('Sidecar exceeds 1 MB')
        value=json.loads(path.read_text())
        if not isinstance(value,dict):
            raise ValueError('Sidecar is not a JSON object')
        return value
    files=current_files(db,subject)
    dataset=scan['echoes'][0]['dataset_id']
    maps=[]
    for file in files:
        meta=identity(file['path'])
        if file['dataset_id']!=dataset or meta.get('session','')!=scan['session'] or meta['datatype']!='fmap' or meta['suffix'] not in {'fieldmap','magnitude'} or not file['path'].endswith('.json'):
            continue
        row={'file':file,'identifiers':[],'images':[f for f in files if f['dataset_id']==dataset and f['path'] in {file['path'][:-5]+'.nii.gz',file['path'][:-5]+'.nii'}]}
        try:
            row['identifiers']=identifiers(read(file).get('B0FieldIdentifier'))
        except (HTTPException,OSError,ValueError) as error:
            row['error']=str(getattr(error,'detail',error))
        maps.append(row)
    echoes=[]
    for file in scan['echoes']:
        row={'file':file,'source':[],'matches':[],'status':'Unavailable'}
        try:
            source=identifiers(read(file).get('B0FieldSource'))
            row['source']=source
            row['matches']=[m['file']['id'] for m in maps if identity(m['file']['path'])['suffix']=='fieldmap' and set(source)&set(m['identifiers'])]
            matched={i for m in maps if identity(m['file']['path'])['suffix']=='fieldmap' for i in m['identifiers']}
            row['status']='Missing link' if not source else ('Matched' if set(source)<=matched else ('Unavailable' if any('error' in m for m in maps) else 'No matching fieldmap'))
        except (HTTPException,OSError,ValueError) as error:
            row['error']=str(getattr(error,'detail',error))
        echoes.append(row)
    return {'basis':BASIS,'scan':scan,'echoes':echoes,'fieldmaps':maps,
            'note':'Matched confirms sidecar identifiers only. Inspect fieldmap/magnitude images and later fMRIPrep reports for image quality and distortion correction.'}
