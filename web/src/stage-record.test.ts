// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { stageMetrics, evidenceExplanation, stageReport } from './stage-record';
import type { Subject } from './pipeline';
const scan={entity_key:'scan',subject:'s03',suffix:'bold'};
const data:Subject={entities:[scan],attempts:[],decisions:[],findings:[{entity_key:'scan',finding_type:'scan-review',evidence_json:'{"fd_mean":0.3,"tr_count":100,"flags":"high_motion"}'}]};
it('keeps later MRIQC and approval metrics out of conversion and trimming',()=>{
 expect(stageMetrics(data,scan,'bids')).toEqual({});
 expect(stageMetrics(data,scan,'trim')).toEqual({});
 expect(stageMetrics(data,scan,'review').fd_mean).toBe(0.3);
});
it('explains evidence without calling a review flag an exclusion',()=>{
 expect(evidenceExplanation('mriqc')).toContain('MRIQC');
 expect(evidenceExplanation('scan-review')).toContain('not automatic exclusions');
});
it('separates known transformations and unknown history with recorded software',()=>{
 const record={stage:'bids',subject:'s03',processing:[{id:'a',stage:'defacing',software:{name:'PyDeface',version:'2.1.0'}}],inputs:[],outputs:[],findings:[],decisions:[],milestones:[],snapshot_kind:'recorded_stage_evidence',note:''};
 const panel=stageReport(data,'bids',record,vi.fn());
 expect(panel.textContent).toContain('PyDeface');
 expect(panel.textContent).toContain('2.1.0');
 expect(panel.textContent).toContain('Historical file inventory unrecorded');
 expect(panel.textContent).not.toContain('0 excluded');
});

it('only lists scans with evidence at the selected stage',async()=>{
 const {stageSubject}=await import('./stage-record');
 const scans={...data,entities:[{...scan,namespace:'raw',session:'01',task:'rest',run:'1'},{entity_key:'fmap',namespace:'raw',subject:'s03',session:'01',run:'1',suffix:'fieldmap'}]};
 const record={stage:'bids',subject:'s03',snapshot_kind:'recorded_stage_evidence',processing:[],inputs:[],findings:[],decisions:[],milestones:[],note:'',outputs:[{id:'f',path:'sub-s03/ses-01/fmap/sub-s03_ses-01_run-1_fieldmap.nii.gz',dataset_id:'raw',content_id:'sha256:hash'}]};
 expect(stageSubject(scans,'bids',record).entities.map(e=>e.entity_key)).toEqual(['fmap']);
 expect(stageSubject(scans,'current').entities).toHaveLength(2);
});

it('keeps provenance collapsed and review exclusions visible',()=>{
 const record={stage:'review',subject:'s03',processing:[],inputs:[],outputs:[],findings:[],decisions:[{entity_key:'scan',decision:'exclude',scope:'task_first_level',reason:'Timing issue',reviewer:'LB'}],milestones:[],snapshot_kind:'recorded_stage_evidence',note:''};
 const panel=stageReport(data,'review',record,vi.fn());
 expect(panel.querySelector<HTMLDetailsElement>('.stage-supporting')?.open).toBe(false);
 expect(panel.querySelector('.stage-changes')?.textContent).toContain('Timing issue');
 expect(panel.querySelector('.stage-changes')?.closest('details')).toBeNull();
});

it('exposes inputs, changes, outputs and review needs without opening provenance',()=>{
 const record={stage:'review',subject:'s03',processing:[],inputs:[],outputs:[],findings:[{finding_type:'scan-review',evidence_json:'{"approval_required":"yes","approved":"no","flags":"high_motion"}'}],decisions:[],milestones:[],snapshot_kind:'recorded_stage_evidence',note:'',supporting_files:[{id:'receipt',path:'code/scan_decisions.tsv',dataset_id:'raw',content_id:'sha256:h',purpose:'Scan decisions'}]};
 const open=vi.fn(),panel=stageReport(data,'review',record,open);
 expect(panel.querySelector('.stage-overview')?.textContent).toContain('Inputs');
 expect(panel.querySelector('.stage-overview')?.textContent).toContain('Outputs');
 expect(panel.querySelector('.stage-check-summary')?.textContent).toContain('1 needs approval');
 const button=Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='Scan decisions')!;
 button.click();expect(open).toHaveBeenCalledWith(record.supporting_files[0]);
});
