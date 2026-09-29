import {element,details} from './review';
import type {RecordRow} from './review';
import type {StageFile} from './stage-record';

/** Read only recorded FSQC values; quality flags never stand in for approval. */
export function surfaceQCPanel(record:{findings:RecordRow[];outputs:StageFile[]},open:(file:StageFile)=>void):HTMLElement {
 const panel=element('section','','surface-qc-panel');panel.append(element('h3','Surface quality · FSQC'));
 const findings=record.findings.filter(f=>f.finding_type==='surface-qc');
 if(findings.length!==1){panel.append(element('p',findings.length?'Multiple FSQC records; inspect provenance before choosing a result.':'FSQC evidence not yet recorded.','muted'));return panel;}
 let value:RecordRow;try{value=JSON.parse(String(findings[0].evidence_json));}catch{panel.append(element('p','FSQC record could not be read.','gap'));return panel;}
 const metrics=(value.metrics??{}) as Record<string,number|null>;
 const show=(key:string)=>metrics[key]==null?'Unrecorded':Number(metrics[key]).toLocaleString(undefined,{maximumFractionDigits:2});
 const summary=element('dl','','stage-io');
 for(const [name,text] of [
  ['Pre-correction holes · L / R',`${show('holes_lh')} / ${show('holes_rh')}`],
  ['White-matter SNR · original / normalized',`${show('wm_snr_orig')} / ${show('wm_snr_norm')}`],
  ['Gray-matter SNR · original / normalized',`${show('gm_snr_orig')} / ${show('gm_snr_norm')}`],
  ['Surface defects · L / R',`${show('defects_lh')} / ${show('defects_rh')}`],
 ])summary.append(element('dt',name),element('dd',text));
 panel.append(summary,element('p','Quality metrics guide inspection; this is not an approval. Check white and pial boundaries against the anatomy.','muted'));
 const images=record.outputs.filter(f=>/^(screenshots|surfaces)\/sub-[^/]+\/.*\.png$/.test(f.path));
 for(const [prefix,title] of [['screenshots/','Anatomical boundary overlays'],['surfaces/','Surface views']]){
  const group=element(prefix==='surfaces/'?'details':'div','','fsqc-images');group.append(element(prefix==='surfaces/'?'summary':'h4',title));
  for(const file of images.filter(f=>f.path.startsWith(prefix))){const button=element('button',prefix==='screenshots/'?'Open boundary overlays':file.path.split('/').pop()!.replace('.png','').replaceAll('.',' '),'text-button');button.onclick=()=>open(file);group.append(button);}
  if(group.children.length===1)group.append(element('p','Images unrecorded.','muted'));
  panel.append(group);
 }
 const all=element('details');all.append(element('summary','All metrics and source'),details(value));panel.append(all);return panel;
}
