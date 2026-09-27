import {element} from './review';
import type {Coverage,CoverageScan} from './coverage';
type File={id:string;path:string};
export function eventsStage(value:Coverage,inspect:(scan:CoverageScan,host:HTMLElement)=>void,open:(file:File)=>void){
 const panel=element('section','','events-stage');panel.append(element('h3','Current behavioral and event files'),element('p','Current registered files, not a historical event-generation snapshot. Inspect canonical events for trial timing and descriptive behavior; exclusions remain separate decisions.','muted'));
 const display=element('section','','event-stage-display');panel.append(display);
 const search=element('input');search.type='search';search.placeholder='Find session or task';search.setAttribute('aria-label','Filter behavioral scans');
 const scroll=element('div','','trim-counts'),table=element('table'),head=element('thead'),heading=element('tr'),body=element('tbody');
 for(const title of ['Session / task','Behavior → events','Analysis use','Inspect'])heading.append(element('th',title));head.append(heading);table.append(head,body);scroll.append(table);
 function render(){body.replaceChildren();for(const scan of value.scans.filter(s=>s.suffix==='bold'&&s.task!=='rest'&&`${s.session} ${s.task}`.toLowerCase().includes(search.value.toLowerCase()))){
  const tr=element('tr'),files=element('td'),analysis=element('td'),actions=element('td');
  files.append(element('div',`Behavior: ${scan.behavior_status}`),element('div',`Events: ${scan.events_status}`));
  analysis.append(element('div',scan.task_first_level==='Excluded'?'Task models excluded':scan.task_first_level));
  if(scan.exclusion_reason)analysis.append(element('p',String(scan.exclusion_reason),'gap'));
  if(Object.keys(scan.truncation).length){const info=element('details');info.append(element('summary','Timing correction'));for(const [key,v] of Object.entries(scan.truncation))info.append(element('p',`${key}: ${typeof v==='object'?JSON.stringify(v):v}`));analysis.append(info);}
  if(scan.events.length){const button=element('button','Inspect events','text-button');button.onclick=()=>{display.replaceChildren(element('h4',`ses-${scan.session} · ${scan.task} / ${scan.run}`));inspect(scan,display);display.scrollIntoView?.({block:'nearest'});};actions.append(button);}
  for(const file of scan.behavior_files??[]){const button=element('button','View raw behavior','text-button');button.onclick=()=>open(file);actions.append(button);}
  if(!actions.children.length)actions.append(element('span','Files not indexed','muted'));
  tr.append(element('td',`ses-${scan.session} / ${scan.task} / ${scan.run}`),files,analysis,actions);body.append(tr);
 }if(!body.children.length){const tr=element('tr'),td=element('td','No task runs match this filter.');td.colSpan=4;tr.append(td);body.append(tr);}}
 search.oninput=render;render();panel.append(search,scroll);return panel;
}
