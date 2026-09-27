import {element} from './review';
import type {StageFile} from './stage-record';
type File=StageFile;
type Scan={id:string;session:string;task:string;run:string;echoes:File[]};
export type B0Inventory={basis:string;scans:Scan[]};
export type B0Check={basis:string;echoes:{file:File;source:string[];status:string;error?:string}[];fieldmaps:{file:File;identifiers:string[];images:File[];error?:string}[];note:string};
export function b0Panel(value:B0Inventory,check:(id:string)=>Promise<B0Check>,open:(file:File)=>void,image:(file:File)=>void){
 const panel=element('section','','b0-panel'),result=element('section','','b0-result');
 panel.append(element('h3','Fieldmap → functional linkage'),element('p','Select Check links to verify each echo’s sidecar and the session’s fieldmaps. This confirms metadata linkage, not distortion-correction quality.','muted'),result);
 const search=element('input');search.type='search';search.placeholder='Find session or task';search.setAttribute('aria-label','Filter B0 scans');
 const scroll=element('div','','trim-counts'),table=element('table'),body=element('tbody'),head=element('thead'),heading=element('tr');
 for(const title of ['Session','Task / run','Link check'])heading.append(element('th',title));head.append(heading);table.append(head,body);scroll.append(table);
 const statuses=new Map<string,string>();let request=0;
 const fileButton=(file:File,title:string,handler:(file:File)=>void)=>{const button=element('button',title,'text-button');button.onclick=()=>handler(file);return button;};
 function render(){body.replaceChildren();for(const scan of value.scans.filter(s=>`${s.session} ${s.task} ${s.run}`.toLowerCase().includes(search.value.toLowerCase()))){
  const row=element('tr'),cell=element('td'),button=element('button',statuses.get(scan.id)??'Check links','text-button');
  if(!statuses.has(scan.id))cell.append(element('span','Not checked · ','muted'));
  button.onclick=async()=>{const current=++request;button.disabled=true;result.replaceChildren(element('h4',`ses-${scan.session} · ${scan.task} / ${scan.run}`),element('p','Verifying sidecars…','muted'));
   try{const data=await check(scan.id);if(current!==request)return;
    const matched=data.echoes.length>0&&data.echoes.every(e=>e.status==='Matched');statuses.set(scan.id,matched?'Matched · check again':'Needs review · check again');render();
    result.replaceChildren(element('h4',`ses-${scan.session} · ${scan.task} / ${scan.run}`),element('p',data.basis,'muted'));
    for(const echo of data.echoes){const line=element('div','','b0-link');line.append(element('strong',echo.file.path.match(/echo-[^_]+/)?.[0]??'BOLD'),element('span',`B0FieldSource: ${echo.source.join(', ')||'Missing'} → ${echo.status}`),fileButton(echo.file,'View BOLD sidecar',open));if(echo.error)line.append(element('p',echo.error,'gap'));result.append(line);}
    const maps=element('div','','b0-maps');
    for(const map of data.fieldmaps){const block=element('section');block.append(element('strong',map.file.path.split('/').pop()),element('p',`B0FieldIdentifier: ${map.identifiers.join(', ')||'Missing'}`),fileButton(map.file,'View fieldmap sidecar',open));for(const f of map.images)block.append(fileButton(f,f.path.includes('_magnitude.')?'View magnitude':'View fieldmap',image));if(!map.images.length)block.append(element('p','Image not indexed.','gap'));if(map.error)block.append(element('p',map.error,'gap'));maps.append(block);}
    if(!data.fieldmaps.length)maps.append(element('p','No session fieldmaps indexed.','gap'));
    result.append(maps,element('p',data.note,'muted'));result.scrollIntoView?.({block:'nearest'});
   }catch(error){if(current===request)result.append(element('p',String(error),'gap'));}finally{button.disabled=false;}
  };
  cell.append(button);row.append(element('td',`ses-${scan.session}`),element('td',`${scan.task} / ${scan.run}`),cell);body.append(row);
 }}
 search.oninput=render;render();panel.append(search,scroll);
 if(!value.scans.length)panel.append(element('p','No current BOLD sidecars indexed. Refresh the study index.','gap'));
 panel.append(element('p','Current registered files are checked on demand. A successful historical milestone alone does not verify these bytes.','muted'));return panel;
}
