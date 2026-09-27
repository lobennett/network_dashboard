// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {eventsStage} from './events-stage';
it('keeps missing behavior and task exclusions distinct from dropping BOLD',()=>{
 const inspect=vi.fn(),file=vi.fn();
 const panel=eventsStage({subjects:['s03'],scans:[{subject:'s03',session:'11',task:'goNogo',run:'1',suffix:'bold',prefix:'scan',status:'Scan files indexed',missing_files:[],events_status:'Indexed',behavior_status:'Reviewed exception',task_first_level:'Excluded',exclusion_reason:'Nonmonotonic onsets',events:[{id:'e',path:'events.tsv'}],designs:[],truncation:{}}],basis:'current',inventory_note:'',skipped_acquisitions:0},inspect,file);
 expect(panel.textContent).toContain('Reviewed exception');expect(panel.textContent).toContain('Nonmonotonic onsets');
 expect(panel.textContent).toContain('Current behavioral and event files');
 Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='Inspect events')!.click();expect(inspect).toHaveBeenCalled();
});
