// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {trimPanel} from './trim';
it('shows reports and paired counts without inventing missing counts',()=>{
 const panel=trimPanel({subject:'s03',reports:{pretrim:{report:{id:'pre',path:'gs.pdf'}}},scans:[{session:'01',task:'rest',run:'1',before:161,after:154,removed:7},{session:'02',task:'rest',run:'1',before:null,after:154,removed:null}],errors:[],source:'Recorded global-signal counts'},vi.fn());
 expect(panel.textContent).toContain('Before trimming');
 expect(panel.textContent).toContain('After trimming');
 expect(panel.textContent).toContain('161');expect(panel.textContent).toContain('154');
 expect(panel.querySelectorAll('tbody tr')).toHaveLength(2);
 expect(panel.textContent).toContain('Unrecorded');
});
