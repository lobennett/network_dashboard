import { element, details, type RecordRow } from './review';
import { reviewMetrics, humanize, type Stage, type Subject } from './pipeline';
import { acquisitionRecords } from './flywheel';
import { scanPrefix } from './scans';
export type StageFile = {id:string;path:string;dataset_id:string;content_id:string;stage_basis?:string};
export type StageRecord = {stage:string;subject:string;processing:RecordRow[];inputs:StageFile[];outputs:StageFile[];findings:RecordRow[];decisions:RecordRow[];milestones:RecordRow[];snapshot_kind:string;note:string};
export const stageMethods: Record<Stage,{tools:string;inputs:string;outputs:string;change:string}> = {
 source:{tools:'network_fw2bids · Flywheel API',inputs:'Flywheel acquisitions: DICOM archives and GE P-files.',outputs:'Selection records with acquisition IDs and reasons.',change:'Select supported acquisitions; skip qa-reject scans and unsupported acquisition types before download.'},
 bids:{tools:'network_fw2bids · dcm2niix · CNI spiral-recon · PyDeface',inputs:'Selected DICOMs; existing CNI fieldmap/magnitude reconstructions.',outputs:'BIDS NIfTI/JSON files and conversion/defacing receipts.',change:'Convert DICOMs, import CNI fieldmap/magnitude pairs, and deface anatomy before storage.'},
 trim:{tools:'network_fmri · global_signal_plots · NiBabel',inputs:'Converted functional images.',outputs:'Trimmed BOLD plus gs-pretrim and gs-posttrim derivatives.',change:'Remove the first 7 volumes from each functional scan. This changes time-series length; it does not exclude the scan.'},
 events:{tools:'network_events · network_fmri · BIDS Validator',inputs:'Canonical behavioral files, participant metadata, BOLD sidecars and fieldmaps.',outputs:'Events, participants and B0 linkage; validation logs.',change:'Generate events against upstream-trimmed BOLD, link fieldmaps, and validate BIDS. Behavioral timing findings inform later analysis decisions.'},
 mriqc:{tools:'MRIQC 24.0.2 · network_fmri',inputs:'Prepared BIDS images.',outputs:'Image-quality metrics (IQMs), HTML reports and extraction receipts.',change:'Measure image quality. MRIQC does not exclude scans; its metrics inform the scan-review stage.'},
 review:{tools:'network_qa · network_fmri · manual review',inputs:'MRIQC metrics, echo completeness, scan lengths and behavioral findings.',outputs:'scan_decisions.tsv, approval records and curated BIDS.',change:'Record preprocessing retention separately from task-model exclusions. High motion is a review flag, not an automatic exclusion.'},
 surfaces:{tools:'FreeSurfer 8.2.0 · network_fmri · manual review',inputs:'Selected, defaced anatomical scans.',outputs:'Reconstruction, ribbon, white/pial surfaces and surface_review.tsv.',change:'Reconstruct surfaces in parallel with MRIQC. Inspect and approve the reconstruction before fMRIPrep.'},
 fmriprep:{tools:'fMRIPrep 25.2.5 · BABS / MechaBABS · network_fmri',inputs:'Retained BIDS scans and the approved FreeSurfer 8.2 reconstruction.',outputs:'Preprocessed BOLD, surfaces, confounds, transforms and reports.',change:'Preprocess retained scans using approved surfaces. Do not trim canonical data again.'},
 registration:{tools:'fmriprepviz 0.1.0 · network_fmri · manual review',inputs:'T1w-space BOLD references and the approved FreeSurfer ribbon.',outputs:'Registration flipbook, input checksums and final approval.',change:'Overlay the ribbon on BOLD references to inspect alignment across runs. Final approval does not override analysis exclusions.'},
 current:{tools:'All recorded stages',inputs:'Current study inventory.',outputs:'Currently registered files, metrics and decisions.',change:'This view combines current results across stages. It is not a historical stage snapshot.'},
};
export function stageMetrics(data:Subject,scan:RecordRow,stage:Stage):RecordRow {
 if(stage==='review'||stage==='current') return reviewMetrics(data,scan);
 if(stage!=='mriqc') return {};
 const echo=data.entities.find(e=>e.echo==='2' && e.suffix===scan.suffix && scanPrefix(e)===scanPrefix(scan));
 const finding=data.findings.find(f=>f.finding_type==='mriqc' && f.entity_key===(echo?.entity_key??scan.entity_key));
 try {return finding ? JSON.parse(String(finding.evidence_json)):{};} catch{return {};}
}
export function evidenceExplanation(type:string):string {
 return ({
  'flywheel-acquisition':'Acquisition metadata and selection reasons queried from Flywheel. A current inventory audit is not evidence of an earlier conversion selection.',
  'mriqc':'Image-quality metrics computed by MRIQC from an input image. Functional motion review uses echo-2; FD percentages must have a recorded 0.5 mm threshold.',
  'scan-review':'Review rows assembled by network_qa from MRIQC, echo completeness, TR counts and behavioral evidence. Flags are review prompts, not automatic exclusions. Decisions record reviewer and scope.',
  'behavior-truncation':'network_events timing reconciliation records where behavioral rows were truncated or could not align with the scan. A timing finding does not itself drop BOLD.',
  'fmriprep-output-check':'network_fmri checks extracted fMRIPrep outputs and image headers against the retained scan inventory. This is a completeness check, not a visual approval.',
  'registration-output':'fmriprepviz overlays the approved FreeSurfer ribbon on each T1w-space BOLD reference. Recorded checksums identify its inputs.',
  'final-output-review':'A manual decision bound to the recorded fMRIPrep, review and registration output commits. It remains distinct from task-model eligibility.',
 } as Record<string,string>)[type]??'A recorded pipeline result. Expand the original fields to inspect its source and parameters; absent methodology remains unrecorded.';
}
export function evidenceCard(row:RecordRow):HTMLElement {
 const card=element('details','','evidence-card');
 card.append(element('summary',humanize(row.finding_type)),element('p',evidenceExplanation(String(row.finding_type))));
 if(row.evidence_path)card.append(element('p',`Source record: ${row.evidence_path}`,'file-path'));
 let value:RecordRow={};try{value=JSON.parse(String(row.evidence_json));}catch{}
 const raw=element('details');raw.append(element('summary','Recorded fields'),details(Object.keys(value).length?value:row));card.append(raw);return card;
}
function softwareText(software:unknown):string {
 if(!software||typeof software!=='object')return 'Executed software version unrecorded';
 return Object.entries(software).map(([key,value])=>`${humanize(key)}: ${typeof value==='object'?JSON.stringify(value):value??'unrecorded'}`).join(' · ');
}
export function stageReport(data:Subject,stage:Stage,record:StageRecord|undefined,open:(file:StageFile,trace?:boolean)=>void):HTMLElement {
 const panel=element('section','','stage-report'), method=stageMethods[stage];
 const overview=element('div','','stage-overview');
 overview.append(element('h2',stage==='current'?'Current files and decisions':'What happened at this stage'),element('p',method.change));
 const io=element('dl','','stage-io');
 for(const [key,value] of [['Inputs',method.inputs],['Outputs',method.outputs],['Configured tools',method.tools]])io.append(element('dt',key),element('dd',value));
 overview.append(io);panel.append(overview);
 if(record){const download=element('button','Download stage record (JSON)','text-button');download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const link=element('a');link.href=url;link.download=`sub-${record.subject}_${stage}_record.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};overview.append(download);} 
 if(stage==='current')return panel;
 if(!record){panel.append(element('p','Loading recorded stage evidence…','muted'));return panel;}
 const versions=element('details','','software-records');versions.append(element('summary','Executed software and parameters'));
 for(const p of record.processing){const text=softwareText(p.software);const item=element('details');item.append(element('summary',`${humanize(p.stage)} · ${p.scope??"Scope unrecorded"} — ${text}`),details(p));versions.append(item);}
 if(!record.processing.length)versions.append(element('p','Execution versions unrecorded. Configured tools above describe the workflow, not proof of an execution.','muted'));
 panel.append(versions);
 const changes=element('section','','stage-changes');changes.append(element('h3','Exclusions and flags'));
 if(stage==='source'){
  const rows=acquisitionRecords(data),historical=rows.length>0&&rows.every(r=>r.snapshot_kind==='conversion_selection');
  changes.append(element('p',rows.length?`${rows.filter(r=>r.decision==='selected').length} selected / ${rows.filter(r=>r.decision==='skipped').length} not selected in the ${historical?'conversion selection':'current Flywheel audit'}. Reasons are listed below.`:'Source selection unrecorded; upstream exclusions are unknown.'));
 }else if(stage==='review'){
  const flagged=record.findings.filter(f=>{try{return Boolean(JSON.parse(String(f.evidence_json)).flags);}catch{return false;}});
  const exclusions=record.decisions.filter(d=>['drop','exclude'].includes(String(d.decision)));
  changes.append(element('p',`${flagged.length} flagged review rows. ${exclusions.length} recorded exclusion decisions.`));
  for(const d of exclusions){const e=data.entities.find(e=>e.entity_key===d.entity_key);const block=element('div','','exclusion-row');block.append(element('strong',e?`${scanPrefix(e)} ${e.suffix}`:String(d.entity_key)),element('p',`${d.scope==='task_first_level'?'Task models only — BOLD retained unless separately dropped':d.scope==='preprocessing'?'Excluded from preprocessing':humanize(d.scope)}: ${d.reason??'Reason unrecorded'}${d.reviewer?` · ${d.reviewer}`:''}`));changes.append(block);}
  if(!record.findings.length&&!record.decisions.length)changes.append(element('p','Review decisions unrecorded; no retention or exclusion can be inferred.','gap'));
 }else if(stage==='mriqc')changes.append(element('p','MRIQC produces metrics and reports. Scan exclusions belong to Scan review.'));
 else if(stage==='events')changes.append(element('p',`${record.findings.length} behavioral timing findings recorded. Task-model decisions belong to Scan review.`));
 else if(stage==='trim')changes.append(element('p','Volumes are removed, not whole scans. Actual removal counts require a recorded trimming receipt.'));
 else changes.append(element('p','This stage does not decide scan exclusions. See Flywheel for source selection and Scan review for preprocessing and task-model decisions.'));
 panel.append(changes);
 if(stage==='surfaces'||stage==='registration'){
  const approvals=element('section','','stage-approvals');approvals.append(element('h3',stage==='registration'?'Final output decisions':'Surface decisions'));
  if(!record.decisions.length)approvals.append(element('p','Approval unrecorded.','muted'));
  for(const d of record.decisions)approvals.append(element('p',`${humanize(d.decision)}${d.reviewer?` · ${d.reviewer}`:''}${d.reviewed_at?` · ${d.reviewed_at}`:''} — ${d.reason??'Reason unrecorded'}`));
  panel.append(approvals);
 }
 if(stage!=='source'){
  const files=element('details','','stage-output-files');files.append(element('summary',`Stage outputs (${record.outputs.length} recorded file versions)`));
  if(!record.outputs.length)files.append(element('p','Historical file inventory unrecorded. Current BIDS files are available under Current files; they are not substituted here.','gap'));
  else {files.append(element('p','Exact transformation outputs and current stage derivatives are labeled separately. Older versions may be unavailable.','muted'));
   for(const file of record.outputs.slice(0,100)){const row=element('div','','stage-file-row'),button=element('button',file.path,'text-button');button.onclick=()=>open(file);row.append(button,element('small',file.stage_basis==='recorded_transformation'?'Exact transformation output':'Current stage derivative'));files.append(row);}
   if(record.outputs.length>100)files.append(element('p',`Showing the first 100 of ${record.outputs.length} files. Select a scan below to narrow the list.`,'muted'));
  }
  panel.append(files);
  const inputs=element('details','','stage-input-files');inputs.append(element('summary',`Recorded inputs (${record.inputs.length} file versions)`));
  if(!record.inputs.length)inputs.append(element('p','Exact input file links unrecorded. The workflow inputs above describe the expected data.','muted'));
  for(const file of record.inputs.slice(0,100)){const button=element('button',file.path,'text-button');button.title='Trace input history; original source images are not previewed here';button.onclick=()=>open(file,true);inputs.append(button);}
  if(record.inputs.length>100)inputs.append(element('p','Showing the first 100 inputs. Download the stage record for the complete list.','muted'));
  panel.append(inputs);
 }
 const evidence=element('details','','stage-evidence');evidence.append(element('summary',`Evidence and processing records (${record.findings.length} findings / ${record.milestones.length} milestones)`));
 for(const f of record.findings.filter(f=>f.finding_type!=='flywheel-acquisition').slice(0,100))evidence.append(evidenceCard(f));
 for(const row of record.milestones){const card=element('details');card.append(element('summary',`${humanize(row.stage)}: ${humanize(row.state)}`),details(row));evidence.append(card);}
 panel.append(evidence);return panel;
}

export function stageSubject(data:Subject,stage:Stage,record?:StageRecord):Subject {
 if(stage==='current')return data;
 const findings=record?.findings??[],decisions=record?.decisions??[],outputs=record?.outputs??[];
 const keys=new Set([...findings,...decisions].map(r=>r.entity_key));
 const mentioned=data.entities.filter(e=>keys.has(e.entity_key));
 const entities=data.entities.filter(e=>{
  if(e.namespace!=='raw'||e.echo)return true;
  const prefix=scanPrefix(e)+'_';
  return keys.has(e.entity_key)||mentioned.some(m=>scanPrefix(m)===scanPrefix(e)&&m.suffix===e.suffix)||outputs.some(f=>{
   const basename=f.path.split('/').pop()??'';
   return basename.startsWith(prefix)&&new RegExp('_'+String(e.suffix)+'[.]').test(basename);
  });
 });
 return {...data,entities,findings,decisions};
}
