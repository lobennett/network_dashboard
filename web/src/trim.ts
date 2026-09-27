import {element} from './review';
export type TrimFile={id:string;path:string};
export type TrimSummary={subject:string;reports:Record<string,{report?:TrimFile;metrics?:TrimFile}>;scans:{session:string;task:string;run:string;before:number|null;after:number|null;removed:number|null}[];errors:string[];source:string};
export function trimPanel(value:TrimSummary,open:(file:TrimFile)=>void):HTMLElement {
 const panel=element('section','','trim-panel');
 const reports=element('div','','trim-reports');
 for(const [key,title] of [['pretrim','Before trimming'],['posttrim','After trimming']]){
  const block=element('section');block.append(element('h3',title));
  const files=value.reports[key];
  if(files?.report){const button=element('button','View global-signal report');button.onclick=()=>open(files.report!);block.append(button);}
  else block.append(element('p','Global-signal report unrecorded.','muted'));
  if(files?.metrics){const button=element('button','View metrics TSV','text-button');button.onclick=()=>open(files.metrics!);block.append(button);}
  reports.append(block);
 }
 panel.append(reports,element('h3','Scan volume counts'),element('p',value.source,'muted'));
 for(const error of value.errors)panel.append(element('p',error,'gap'));
 const search=element('input');search.type='search';search.placeholder='Find session or task';search.setAttribute('aria-label','Filter trim counts');
 const scroll=element('div','','trim-counts'),table=element('table'),head=element('thead'),heading=element('tr'),body=element('tbody');
 for(const title of ['Session','Task / run','Before','After','Removed'])heading.append(element('th',title));
 head.append(heading);table.append(head,body);scroll.append(table);
 function render(){body.replaceChildren();for(const row of value.scans.filter(row=>`${row.session} ${row.task} ${row.run}`.toLowerCase().includes(search.value.toLowerCase()))){const tr=element('tr');for(const v of [`ses-${row.session}`,`${row.task} / ${row.run}`,row.before??'Unrecorded',row.after??'Unrecorded',row.removed??'Unrecorded'])tr.append(element('td',String(v)));if(row.removed!==null&&row.removed!==7){tr.className='trim-mismatch';tr.title='Volume difference differs from the expected seven; review required';}body.append(tr);}}
 search.oninput=render;render();
 if(!value.scans.length)panel.append(element('p','Volume counts unrecorded. No before/after values can be inferred.','gap'));
 else panel.append(search,scroll);
 panel.append(element('p','Reports cover the dataset. Counts are restricted to this subject; missing values are not estimates.','muted'));
 return panel;
}
