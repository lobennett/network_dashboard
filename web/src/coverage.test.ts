// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { renderCoverage } from "./coverage";
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});
it("lists exact missing files and keeps behavioral exceptions separate", () => {
  const scan = {
    subject: "s03",
    session: "01",
    task: "nBack",
    run: "1",
    suffix: "bold",
    prefix: "sub-s03/ses-01/func/sub-s03_ses-01_task-nBack_run-1",
    status: "Missing scan files",
    missing_files: ["sub-s03_echo-2_bold.nii.gz"],
    events_status: "Missing (reviewed exception)",
    behavior_status: "Reviewed exception",
    task_first_level: "No exclusion recorded",
    events: [],
    designs: [],
    truncation: {},
  };
  const panel = renderCoverage(
    {
      subjects: ["s03"],
      scans: [scan],
      basis: "Recorded inventory only",
      inventory_note: "Tracked, not downloaded",
      skipped_acquisitions: 1,
    },
    vi.fn(),
  );
  expect(panel.textContent).toContain("sub-s03_echo-2_bold.nii.gz");
  expect(panel.textContent).toContain("Reviewed exception");
  expect(panel.textContent).toContain("Recorded inventory only");
});

it('opens out-of-scanner behavior in the table viewer from its inventory link', async () => {
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({kind:'behavior',columns:['rt'],rows:[{rt:'421'}],total_rows:1,total_columns:1,truncated:false})}));
  const panel=renderCoverage({subjects:['s1035'],scans:[],basis:'Recorded',inventory_note:'',skipped_acquisitions:0,behavior_sources:[{id:'outside',path:'behavior/sub-s1035/sub-s1035_flanker.csv',subject:'s1035',setting:'out_of_scanner'}]},vi.fn());
  document.body.append(panel);
  const view=panel.querySelector<HTMLSelectElement>('[aria-label="Coverage view"]')!;
  view.value='Behavior';view.dispatchEvent(new Event('change'));
  panel.querySelector<HTMLAnchorElement>('a.file-path')!.click();
  await vi.waitFor(()=>expect(document.querySelector('dialog td')?.textContent).toBe('421'));
  expect(document.querySelector('dialog')?.textContent).toContain('Download recorded file');
});
