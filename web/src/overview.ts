import {element} from './review';
import {apiUrl} from './api';
import {stages,type Stage} from './pipeline';
type Snapshot=Record<string,string>;
type Progress={subject:string;indexed:boolean;status:string;focus_stage?:string|null;stages:Record<string,string>;flagged:number;review_required:number;preprocessing_excluded:number;task_excluded:number;source_skipped:number;jobs:Record<string,unknown>[]};
export type Overview={snapshot:Snapshot;expected_subjects:number;indexed_subjects:number;note:string;subjects:Progress[];datasets:{path:string;commit_hash:string|null;kind:string}[]};
export type Exclusion={subject?:string;session?:string;task?:string;run?:string;stage:string;scope:string;decision:string;reason?:string;reviewer?:string;reviewed_at?:string;preprocessing?:string;source_id?:string;label?:string};
export type Exclusions={snapshot:Snapshot;note:string;rows:Exclusion[]};
const title=(id:string)=>stages.find(s=>s.id===id)?.title??id;
const session=(value?:string)=>value?(value.startsWith('ses-')?value:`ses-${value}`):'';
function snapshot(value:Snapshot){return element('p',`Snapshot: ${value.built_at?new Date(value.built_at).toLocaleString():'Time unrecorded'}`,'muted');}
export function overviewPage(value:Overview,select:(subject:string,stage:Stage)=>void){
 const panel=element('section','','study-overview');
 panel.append(element('h1','Study progress'),snapshot(value.snapshot),element('p',`${value.indexed_subjects} of ${value.expected_subjects} subjects indexed · ${value.subjects.filter(s=>s.status==='Running').length} running · ${value.subjects.filter(s=>s.status==='Awaiting review').length} awaiting review · ${value.subjects.filter(s=>s.status==='Failed').length} failed`),element('p',value.note,'muted'));
 const filters=element('div','','overview-filters'),search=element('input'),filter=element('select');search.type='search';search.placeholder='Find subject';search.setAttribute('aria-label','Find subject');filter.setAttribute('aria-label','Progress status');
 for(const state of ['All subjects','Running','Queued','Awaiting review','Failed','Complete','Incomplete','Not indexed']){const option=element('option',state);option.value=state;filter.append(option);}filters.append(search,filter);panel.append(filters);
 const scroll=element('div','','overview-table'),table=element('table'),head=element('thead'),heading=element('tr'),body=element('tbody');
 for(const text of ['Subject','Status','Needs review','Excluded','Stages'])heading.append(element('th',text));head.append(heading);table.append(head,body);scroll.append(table);panel.append(scroll);
 function render(){body.replaceChildren();for(const row of value.subjects.filter(s=>s.subject.toLowerCase().includes(search.value.toLowerCase())&&(filter.value==='All subjects'||s.status===filter.value))){
  const tr=element('tr'),subject=element('td'),status=element('td'),excluded=element('td'),history=element('td');
  const focus=row.focus_stage as Stage|null|undefined;
  if(row.indexed){const button=element('button',`sub-${row.subject}`,'text-button');button.onclick=()=>select(row.subject,focus??'source');subject.append(button);}else subject.textContent=`sub-${row.subject}`;
  status.append(element('strong',row.status));if(focus)status.append(element('div',title(focus),'muted'));
  if(row.indexed)excluded.append(element('div',`${row.preprocessing_excluded} preprocessing`),element('div',`${row.task_excluded} task models`),element('small',`${row.source_skipped} source acquisitions skipped`));
  else excluded.textContent='Unknown';
  const details=element('details');details.append(element('summary','Stage status'));
  for(const stage of stages){const state=row.stages[stage.id]??'Unrecorded';if(row.indexed){const button=element('button',`${stage.title}: ${state}`,'text-button');button.onclick=()=>select(row.subject,stage.id);details.append(button);}else details.append(element('p',`${stage.title}: ${state}`,'muted'));}
  if(row.jobs.length){const jobs=element('details');jobs.append(element('summary','Recorded jobs'));for(const job of row.jobs)jobs.append(element('p',`${job.stage} · ${job.job_id} · ${job.state}${job.error?` — ${job.error}`:''}`));details.append(jobs);}
  history.append(details);tr.append(subject,status,element('td',row.indexed?`${row.review_required} pending / ${row.flagged} flagged scans`:'Unknown'),excluded,history);body.append(tr);
 }if(!body.children.length){const tr=element('tr'),td=element('td','No subjects match this filter.');td.colSpan=5;tr.append(td);body.append(tr);}}
 search.oninput=render;filter.onchange=render;render();
 const versions=element('details','','snapshot-details');versions.append(element('summary','Dataset versions'),element('p',`Study commit: ${value.snapshot.study_commit??'Unrecorded'}`,'file-path'));
 for(const dataset of value.datasets)versions.append(element('p',`${dataset.path} · ${dataset.commit_hash??'Commit unrecorded'}`,'file-path'));panel.append(versions);return panel;
}
export function exclusionsPage(value:Exclusions,select:(subject:string,stage:Stage)=>void){
 const panel=element('section','','study-exclusions');panel.append(element('h1','Exclusions'),snapshot(value.snapshot),element('p',value.note,'muted'));
 const download=element('a','Download exclusions (TSV)');download.href=apiUrl('exclusions?format=tsv');panel.append(download);
 const filters=element('div','','overview-filters'),search=element('input'),filter=element('select');search.type='search';search.placeholder='Find subject, scan or reason';search.setAttribute('aria-label','Find exclusion');filter.setAttribute('aria-label','Exclusion scope');
 for(const [id,text] of [['all','All scopes'],['source_acquisition','Source acquisition skips'],['preprocessing','Preprocessing exclusions'],['task_first_level','Task models only'],['timeseries','Time-series analysis']]){const option=element('option',text);option.value=id;filter.append(option);}filters.append(search,filter);panel.append(filters);
 const scroll=element('div','','overview-table'),table=element('table'),head=element('thead'),heading=element('tr'),body=element('tbody');for(const text of ['Subject / scan','Excluded from','Reason','Review'])heading.append(element('th',text));head.append(heading);table.append(head,body);scroll.append(table);panel.append(scroll);
 function render(){body.replaceChildren();for(const row of value.rows.filter(r=>(filter.value==='all'||r.scope===filter.value)&&Object.values(r).join(' ').toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>({task_first_level:0,preprocessing:1,timeseries:2,source_acquisition:3}[a.scope]??4)-({task_first_level:0,preprocessing:1,timeseries:2,source_acquisition:3}[b.scope]??4))){const tr=element('tr'),scan=element('td'),scope=element('td');
  const name=[row.subject&&`sub-${row.subject}`,row.session&&session(row.session),row.task||row.label,row.run&&`run-${row.run}`].filter(Boolean).join(' / ');
  const button=element('button',name,'text-button');button.onclick=()=>row.subject&&select(row.subject,row.stage as Stage);scan.append(button);
  scope.append(element('strong',row.scope==='source_acquisition'?'Source acquisition':row.scope==='preprocessing'?'Preprocessing':row.scope==='task_first_level'?'Task models only':'Time-series analysis'));
  if(row.scope==='task_first_level')scope.append(element('p',row.preprocessing==='keep'?'BOLD retained for preprocessing':`Preprocessing: ${row.preprocessing??'Unrecorded'}`,'muted'));
  tr.append(scan,scope,element('td',row.reason??'Reason unrecorded'),element('td',row.scope==='source_acquisition'?`Upstream label / selection${row.source_id?` · ${row.source_id}`:''}`:`${row.reviewer??'Reviewer unrecorded'}${row.reviewed_at?` · ${row.reviewed_at}`:''}`));body.append(tr);
 }if(!body.children.length){const tr=element('tr'),td=element('td','No exclusions recorded for this filter. This is not approval for analysis.');td.colSpan=4;tr.append(td);body.append(tr);}}
 search.oninput=render;filter.onchange=render;render();return panel;
}
