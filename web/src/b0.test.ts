// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {b0Panel} from './b0';
it('lists scans as unchecked and verifies only on request',async()=>{
 const check=vi.fn().mockResolvedValue({basis:'Current sidecars',echoes:[{file:{id:'b',path:'echo-2_bold.json'},source:['ses01'],status:'Matched'}],fieldmaps:[{file:{id:'f',path:'fieldmap.json'},identifiers:['ses01'],images:[{id:'i',path:'fieldmap.nii.gz'}]}],note:'Identifiers only'});
 const open=vi.fn(),image=vi.fn();
 const panel=b0Panel({basis:'Current sidecars',scans:[{id:'b',session:'01',task:'rest',run:'1',echoes:[]}]},check,open,image);
 expect(panel.textContent).toContain('Not checked');expect(check).not.toHaveBeenCalled();
 panel.querySelector('button')!.click();await vi.waitFor(()=>expect(panel.textContent).toContain('Matched'));
 expect(panel.textContent).toContain('B0FieldSource');expect(panel.textContent).toContain('B0FieldIdentifier');
 const buttons=Array.from(panel.querySelectorAll('button'));buttons.find(b=>b.textContent==='View fieldmap')!.click();expect(image).toHaveBeenCalled();
});
