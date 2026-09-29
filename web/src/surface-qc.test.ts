// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {surfaceQCPanel} from './surface-qc';
it('shows recorded metrics and clickable images without implying approval',()=>{
 const file={id:'png',path:'screenshots/sub-s03/sub-s03.png',dataset_id:'qc',content_id:'sha256:x'};
 const record={outputs:[file],findings:[{finding_type:'surface-qc',evidence_json:JSON.stringify({metrics:{holes_lh:3,holes_rh:4,wm_snr_orig:null},software:{FSQC:{version:'2.1.4'}}})}]};
 const open=vi.fn(),panel=surfaceQCPanel(record,open);
 expect(panel.textContent).toContain('Pre-correction holes');expect(panel.textContent).toContain('3 / 4');
 expect(panel.textContent).toContain('Unrecorded');expect(panel.textContent).toContain('not an approval');
 panel.querySelector('button')!.click();expect(open).toHaveBeenCalledWith(file);
});
it('does not infer quality when FSQC has not run',()=>{
 expect(surfaceQCPanel({outputs:[],findings:[]},vi.fn()).textContent).toContain('FSQC evidence not yet recorded');
});
