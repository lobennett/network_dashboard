"""Study-wide progress and exclusion scope from indexed evidence."""
import csv
import io
import json
from .records import rows
from .stages import PRODUCERS

FINISH = {'source':'conversion','bids':'bids-assembled','trim':'gs-posttrim',
          'events':'bids-events-generated','b0':'bids-precuration-validated',
          'mriqc':'mriqc-complete','review':'scan-decisions-approved',
          'surfaces':'surface-review-approved','fmriprep':'fmriprep-complete','registration':'fmriprepviz'}
FAILED={'failed','error','f','timeout','cancelled','intervention-required'}
RUNNING={'r','running','active'}
QUEUED={'pd','pending','queued','ready','blocked'}


def stage_status(stage, attempts):
    producers=PRODUCERS[stage] | ({'conversion'} if stage=='source' else set())
    relevant=[r for r in attempts if r['stage'] in producers]
    specific=[r for r in relevant if r['scope']!='dataset']
    if specific:
        relevant=specific+[r for r in relevant if r['scope']=='dataset' and r['stage']==FINISH[stage] and r['state'] in {'success','complete','merged'}]
    latest={}
    for row in relevant:
        if row['stage'] not in producers:
            continue
        key=(row['stage'],row['scope'])
        if key not in latest or int(row.get('attempt') or 0)>=int(latest[key].get('attempt') or 0):
            latest[key]=row
    states={str(r['state']).lower() for r in latest.values()}
    if states & FAILED:return 'Failed'
    if states & RUNNING:return 'Running'
    if states & QUEUED:return 'Queued'
    if any(r['stage']==FINISH[stage] and r['state'] in {'success','complete','merged'} for r in latest.values()):
        return 'Approved' if stage in {'review','surfaces'} else 'Complete'
    if states and states<={'success','complete','merged'}:
        return 'Reconstructed' if stage=='surfaces' else 'Complete' if 'complete' in states or 'merged' in states else 'Recorded'
    return 'Unrecorded'


def study_overview(db):
    metadata=dict(db.execute('SELECT key,value FROM metadata'))
    entities=rows(db,'SELECT * FROM entities')
    indexed={e['subject'] for e in entities if e.get('subject')}
    expected=set(json.loads(metadata.get('expected_subjects','[]'))) | indexed
    attempts=rows(db,'SELECT * FROM stage_attempts')
    active=json.loads(metadata.get('active_attempts','[]')) or []
    active_keys={(a['stage'],a['scope']) for a in active}
    # Current campaign jobs supersede historical jobs with the same stage/scope.
    attempts=[a for a in attempts if (a['stage'],a['scope']) not in active_keys]+active
    findings=rows(db,'SELECT * FROM findings')
    decisions=rows(db,'SELECT * FROM decisions')
    subjects=[]
    for subject in sorted(expected,key=lambda s:(len(s),s)):
        own=[e for e in entities if e.get('subject')==subject]
        keys={e['entity_key'] for e in own}
        ds=[d for d in decisions if d['entity_key'] in keys]
        fs=[f for f in findings if f['entity_key'] in keys]
        jobs=[a for a in attempts if a['scope'] in {'dataset',f'sub-{subject}'} or str(a['scope']).startswith(f'sub-{subject}/')]
        states={stage:stage_status(stage,jobs) for stage in PRODUCERS}
        reviews=[json.loads(f['evidence_json']) for f in fs if f['finding_type']=='scan-review']
        required=sum(r.get('approval_required')=='yes' and r.get('approved')!='yes' for r in reviews)
        if required and states['review'] not in {'Failed','Running','Queued'}:states['review']='Awaiting review'
        if states['surfaces']=='Reconstructed' or (states['surfaces']=='Approved' and not any(d['scope']=='surface' and d['decision']=='yes' for d in ds)):
            states['surfaces']='Awaiting review'
        if not own:
            states={stage:'Unrecorded' for stage in PRODUCERS};status='Not indexed'
        elif 'Failed' in states.values():status='Failed'
        elif 'Running' in states.values():status='Running'
        elif 'Queued' in states.values():status='Queued'
        elif 'Awaiting review' in states.values():status='Awaiting review'
        else:
            status='Incomplete'
            if any(f['finding_type']=='final-output-review' for f in fs):
                from .completion import subject_completion
                completion=subject_completion(db,subject)
                if completion['status']=='complete':status='Complete'
                elif completion['status']=='awaiting-review':status='Awaiting review'
        current='registration' if status=='Complete' else next((s for s,v in states.items() if v==status),None)
        subjects.append({'subject':subject,'indexed':bool(own),'status':status,'focus_stage':current,
                         'reference_stages':json.loads(metadata.get('reference_stages','{}')).get(subject,{}),
                         'stages':states,'jobs':[a for a in jobs if a.get('job_id')],
                         'flagged':sum(bool(r.get('flags')) for r in reviews),'review_required':required,
                         'preprocessing_excluded':sum(d['scope']=='preprocessing' and d['decision'] in {'drop','exclude'} for d in ds),
                         'task_excluded':sum(d['scope']=='task_first_level' and d['decision'] in {'drop','exclude'} for d in ds),
                         'source_skipped':sum(json.loads(f['evidence_json']).get('decision')=='skipped' for f in fs if f['finding_type']=='flywheel-acquisition')})
    return {'snapshot':metadata,'expected_subjects':len(expected),'indexed_subjects':len(indexed),
            'subjects':subjects,'datasets':rows(db,"SELECT path,kind,commit_hash FROM artifacts WHERE kind LIKE 'dataset:%'"),
            'note':'Indexed snapshot, not a live scheduler query. Unindexed subjects have unknown status here, even if their jobs are running elsewhere.'}


def exclusions(db):
    entities={e['entity_key']:e for e in rows(db,'SELECT * FROM entities')}
    decisions=rows(db,'SELECT * FROM decisions')
    output=[]
    def row(entity,stage,scope,decision,reason,**extra):
        return {'subject':entity.get('subject'),'session':entity.get('session'),'task':entity.get('task'),
                'run':entity.get('run'),'stage':stage,'scope':scope,'decision':decision,'reason':reason,
                'reviewer':extra.get('reviewer'),'reviewed_at':extra.get('reviewed_at'),
                'preprocessing':extra.get('preprocessing'),'source_id':extra.get('source_id'),'label':extra.get('label')}
    for f in rows(db,"SELECT * FROM findings WHERE finding_type='flywheel-acquisition'"):
        value=json.loads(f['evidence_json'])
        if value.get('decision')=='skipped':
            entity={**entities.get(f['entity_key'],{}),'session':value.get('session')}
            output.append(row(entity,'source','source_acquisition','skipped',value.get('reason'),source_id=value.get('acquisition_id'),label=value.get('label')))
    for d in decisions:
        if d['decision'] not in {'drop','exclude'}:continue
        entity=entities.get(d['entity_key'],{})
        retained=next((p['decision'] for p in decisions if p['entity_key']==d['entity_key'] and p['scope']=='preprocessing'),'unrecorded')
        output.append(row(entity,'review',d['scope'],d['decision'],d.get('reason'),reviewer=d.get('reviewer'),reviewed_at=d.get('reviewed_at'),preprocessing=retained))
    return {'rows':output,'snapshot':dict(db.execute('SELECT key,value FROM metadata')),
            'note':'Source skips, preprocessing drops and analysis exclusions have different scopes. Missing decisions are not approval.'}


def exclusions_tsv(value):
    stream=io.StringIO()
    fields=['snapshot_built_at','study_commit','subject','session','task','run','stage','scope','decision','reason','reviewer','reviewed_at','preprocessing','source_id','label']
    writer=csv.DictWriter(stream,fieldnames=fields,delimiter='\t',lineterminator='\n');writer.writeheader()
    for row in value['rows']:
        writer.writerow({'snapshot_built_at':value['snapshot'].get('built_at'),'study_commit':value['snapshot'].get('study_commit'),**row})
    return stream.getvalue()
