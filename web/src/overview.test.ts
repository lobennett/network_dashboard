// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {downloadPath} from './api';
import {overviewPage,exclusionsPage} from './overview';
vi.mock('./api',async original=>({...(await original<typeof import('./api')>()),downloadPath:vi.fn(()=>Promise.resolve())}));
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
 expect(page.querySelector<HTMLDetailsElement>('.recorded-decisions')?.open).toBe(false);
 expect(page.querySelector('.recorded-decisions tbody')?.textContent).toContain('Timing problem');
});
it('downloads a scope-specific scan manifest with optional subject and task filters',async()=>{
 const page=exclusionsPage({snapshot:{built_at:'2026-10-14T12:00:00Z'},note:'',rows:[]},vi.fn());
 expect(page.querySelector('h1')?.textContent).toBe('Analysis exports');
 const form=page.querySelector('.export-controls')!,scope=form.querySelector('select')!,[subject,task]=Array.from(form.querySelectorAll('input'));
 expect(Array.from(scope.options).map(o=>o.value)).toEqual(['preprocessing','task_first_level','timeseries']);
 expect(form.textContent).toContain('undecided');
 scope.value='task_first_level';subject.value='sub-s03';task.value='goNogo';
 Array.from(form.querySelectorAll('button')).find(b=>b.textContent==='Download scan manifest (TSV)')!.click();
 expect(downloadPath).toHaveBeenCalledWith('exports/task_first_level?subject=s03&task=goNogo&format=tsv','network_task_first_level_sub-s03_task-goNogo_manifest.tsv');
 scope.value='timeseries';subject.value='';task.value='';
 Array.from(form.querySelectorAll('button')).find(b=>b.textContent==='Download scan manifest (JSON)')!.click();
 expect(downloadPath).toHaveBeenLastCalledWith('exports/timeseries?format=json','network_timeseries_manifest.json');
});
