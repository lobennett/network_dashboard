// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {overviewPage,exclusionsPage} from './overview';
it('shows unindexed subjects explicitly and opens a running stage directly',()=>{
 const select=vi.fn();
 const page=overviewPage({snapshot:{built_at:'2026-09-27',study_commit:'abc'},expected_subjects:2,indexed_subjects:1,note:'Snapshot only',datasets:[],subjects:[{subject:'s03',indexed:true,status:'Running',focus_stage:'mriqc',stages:{mriqc:'Running'},flagged:1,review_required:0,preprocessing_excluded:0,task_excluded:1,source_skipped:0,jobs:[]},{subject:'s10',indexed:false,status:'Not indexed',stages:{},flagged:0,review_required:0,preprocessing_excluded:0,task_excluded:0,source_skipped:0,jobs:[]}]},select);
 expect(page.textContent).toContain('1 of 2');expect(page.textContent).toContain('Not indexed');
 const button=page.querySelector<HTMLButtonElement>('tbody button')!;button.click();expect(select).toHaveBeenCalledWith('s03','mriqc');
 const filter=page.querySelector('select')!;filter.value='Not indexed';filter.dispatchEvent(new Event('change'));
 expect(page.querySelector('tbody')?.textContent).toContain('s10');expect(page.querySelector('tbody')?.textContent).not.toContain('s03');
 expect(page.querySelector('tbody')?.textContent).toContain('Unknown');
 expect(page.querySelector('tbody')?.textContent).not.toContain('0 preprocessing');
});
it('separates source skips from task exclusions and retained preprocessing',()=>{
 const page=exclusionsPage({snapshot:{},note:'Scope matters',rows:[{subject:'s03',session:'11',task:'goNogo',run:'1',stage:'review',scope:'task_first_level',decision:'exclude',reason:'Timing problem',preprocessing:'keep',reviewer:'LB'}]},vi.fn());
 expect(page.textContent).toContain('Task models only');expect(page.textContent).toContain('BOLD retained');expect(page.textContent).toContain('Timing problem');
});
