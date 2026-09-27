import {element,details,type RecordRow} from './review';
import {label} from './labels';
/** Show recorded receipt values; never infer missing checks or execution versions. */
export function receiptSummary(value:RecordRow,path:string,text:string){
 const panel=element('section','','receipt-summary');
 panel.append(element('p','Checksum-verified recorded file. These fields describe the recorded execution; image bytes are verified separately when opened.','muted'));
 const known:RecordRow={};
 for(const key of ['stage','status','subject','label','timestamp','input_commit','output_commit','returncode'])if(value[key]!==undefined)known[key]=value[key];
 if(Object.keys(known).length)panel.append(details(known));
 if(value.software){panel.append(element('h3','Recorded software'),details(value.software as RecordRow));}
 if(Array.isArray(value.images)){
  panel.append(element('h3','Recorded anatomical outputs'));
  for(const image of value.images as RecordRow[]){const row=element('details');row.append(element('summary',String(image.path??'Path unrecorded')),details(image));panel.append(row);}
 }
 if(Array.isArray(value.archives)){
  panel.append(element('h3',`${value.archives.length} conversion archives`));
  for(const archive of value.archives as RecordRow[]){const row=element('details');row.append(element('summary',String(archive.label??archive.acquisition_id??archive.archive_sha256??'Archive')),details(archive));panel.append(row);}
 }
 if(path.includes('validation')){
  const container=value.issues;
  const issues=(Array.isArray(container)?container:(container&&typeof container==='object'&&Array.isArray((container as RecordRow).issues)?(container as RecordRow).issues:undefined)) as RecordRow[]|undefined;
  if(issues){
   const errors=issues.filter(i=>i.severity==='error').length,warnings=issues.filter(i=>i.severity==='warning').length;
   panel.append(element('h3','Validation issues'),element('p',`${errors} ${errors===1?'error':'errors'} · ${warnings} ${warnings===1?'warning':'warnings'} · ${issues.length} total recorded issues`));
   if(issues.length){const search=element('input');search.type='search';search.placeholder='Find issue code or affected file';search.setAttribute('aria-label','Filter validation issues');
    const host=element('div','','validation-issues');panel.append(search,host);
    const render=()=>{host.replaceChildren();const found=issues.filter(i=>`${i.code??''} ${i.severity??''} ${i.location??''}`.toLowerCase().includes(search.value.toLowerCase()));
     for(const issue of found.slice(0,100)){const row=element('details');row.append(element('summary',`${label(issue.severity??'Severity unrecorded')}: ${issue.code??'Issue'} · ${issue.location??'Location unrecorded'}`));
      const location=String(issue.location??'');const subject=location.match(/(?:^|\/)sub-([A-Za-z0-9]+)(?:[\/_]|$)/)?.[1];
      if(subject){const url=new URL(window.location.href);url.searchParams.set('subject',subject);url.searchParams.set('stage','current');url.searchParams.set('focus',location.replace(/^\//,''));url.hash='review';const link=element('a','Inspect affected scan');link.href=url.toString();row.append(link);}
      row.append(details(issue));host.append(row);}
     if(found.length>100)host.append(element('p',`Showing the first 100 of ${found.length} matching issues. Refine the filter to find a file.`,'muted'));
     if(!found.length)host.append(element('p','No issues match this filter.','muted'));
    };search.oninput=render;render();
   }
  }else panel.append(element('p','Issue counts are not available in this report format. Inspect the recorded fields and validator log.','muted'));
 }
 const raw=element('details');raw.append(element('summary','Recorded fields (JSON)'),element('pre',text));panel.append(raw);return panel;
}
