// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { get } from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  get: vi.fn(),
}));
vi.mock("./viewer", () => ({ viewFile: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  history.replaceState(null,"","/");
  window.scrollTo = vi.fn();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("waits for a connection click before accessing the local network", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  responses(() => Promise.reject(new Error("unexpected request")));
  await import("./main");
  expect(get).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>(".connection button")!.click();
  await vi.waitFor(() => expect(document.querySelector(".stage-navigation button")).not.toBeNull());
  Array.from(document.querySelectorAll<HTMLButtonElement>(".stage-navigation button")).find(b=>b.textContent==="Current files")!.click();
  await vi.waitFor(() => expect(document.querySelector(".scan-name")).not.toBeNull());
  expect(document.querySelector(".connection")).toBeNull();
});
function responses(lineage: (path: string) => Promise<unknown>) {
  vi.mocked(get).mockImplementation((path: string) => {
    if (path === "metadata")
      return Promise.resolve({
        stale: false,
        built_at: new Date(Date.now() - 899_000).toISOString(),
      });
    if (path === "subjects") return Promise.resolve([{ subject: "s03" }]);
    if(path.includes('/stages/'))return Promise.resolve({stage:'review',subject:'s03',snapshot_kind:'recorded_stage_evidence',inputs:[],outputs:[],processing:[],findings:[],decisions:[],milestones:[]});
    if (path.startsWith("subjects/"))
      return Promise.resolve({
        entities: [
          {
            namespace: "raw",
            subject: "s03",
            session: "07",
            task: "goNogo",
            run: "1",
            suffix: "bold",
            entity_key: "scan",
          },
        ],
        attempts: [],
        decisions: [],
        findings: [],
      });
    if (path.startsWith("artifacts?q="))
      return Promise.resolve([
        { id: "a", path: "a_bold.nii.gz", preview_available: true },
        { id: "b", path: "b.html", preview_available: true },
      ]);
    return lineage(path);
  });
}
it("an obsolete lineage error cannot replace the newer selected file", async () => {
  let rejectOld!: (error: Error) => void;
  const old = new Promise((_, reject) => {
    rejectOld = reject;
  });
  responses((path) =>
    path.includes("/a/")
      ? old
      : Promise.resolve({
          artifact: { id: "b", path: "b.html" },
          artifacts: [],
          links: [],
          attempts: [],
          ancestry: "unrecorded",
        }),
  );
  await import("./main");
  await vi.waitFor(() => expect(document.querySelector(".stage-navigation button")).not.toBeNull());
  Array.from(document.querySelectorAll<HTMLButtonElement>(".stage-navigation button")).find(b=>b.textContent==="Current files")!.click();
  await vi.waitFor(() => expect(document.querySelector(".scan-name")).not.toBeNull());
  Array.from(document.querySelectorAll<HTMLButtonElement>(".stage-navigation button")).find(b=>b.textContent==="Current files")!.click();
  document.querySelector<HTMLButtonElement>(".scan-name")!.click();
  document.querySelector<HTMLButtonElement>(".inspector-tabs button")!.click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".text-button")).toHaveLength(1),
  );
  const buttons = document.querySelectorAll<HTMLButtonElement>(".text-button");
  buttons[0].click();
  const picker = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Image or report"]',
  )!;
  picker.value = "1";
  picker.dispatchEvent(new Event("change"));
  buttons[0].click();
  await vi.waitFor(() =>
    expect(document.querySelector(".preview-display")?.textContent).toContain(
      "b.html",
    ),
  );
  rejectOld(new Error("old request failed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".preview-display")?.textContent).toContain(
    "b.html",
  );
  expect(document.querySelector(".preview-display")?.textContent).not.toContain(
    "old request failed",
  );
});
it("an open page marks an aging index as not live", async () => {
  vi.useFakeTimers();
  responses(() => Promise.reject(new Error("unexpected request")));
  await import("./main");
  await vi.waitFor(() =>
    expect(document.getElementById("freshness")?.textContent).toContain(
      "Snapshot:",
    ),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(document.getElementById("freshness")?.textContent).toContain(
    "Snapshot (not live)",
  );
});

it("offers the pipeline guide before connecting and returns to review", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  await import("./main");
  location.hash = "pipeline";
  window.dispatchEvent(new Event("hashchange"));
  expect(document.getElementById("pipeline-page")!.hidden).toBe(false);
  expect(document.getElementById("review-page")!.hidden).toBe(true);
  expect(get).not.toHaveBeenCalled();
  location.hash = "review";
  window.dispatchEvent(new Event("hashchange"));
  expect(document.getElementById("review-page")!.hidden).toBe(false);
});

it('clears old source buttons before a new subject finishes loading',async()=>{
 vi.mocked(get).mockImplementation(async(path:string)=>{
  if(path==='metadata')return {built_at:new Date().toISOString(),stale:false};
  if(path==='subjects')return [{subject:'s03'},{subject:'s04'}];
  if(path==='subjects/s04')return new Promise(()=>{});
  if(path.endsWith('/completion'))return {checks:[],snapshot:{},subject:'s03',status:'incomplete'};
  const finding={finding_type:'flywheel-acquisition',entity_key:'fw',evidence_json:JSON.stringify({label:'Original scan',bids_prefix:'sub-s03_ses-01_task-rest_run-1_bold',snapshot_kind:'current_inventory',decision:'selected',files:[]})};
  if(path.includes('/stages/'))return {snapshot_kind:'recorded_stage_evidence',subject:'s03',processing:[],inputs:[],outputs:[],findings:[finding],decisions:[],milestones:[]};
  return {entities:[{entity_key:'fw',namespace:'flywheel',subject:'s03'}],findings:[finding],decisions:[],attempts:[]};
 });
 await import('./main');
 await vi.waitFor(()=>expect(document.querySelector('#source-content button')).not.toBeNull());
 Array.from(document.querySelectorAll<HTMLButtonElement>('#subjects button')).find(b=>b.textContent==='sub-s04')!.click();
 expect(document.querySelector('#source-content')?.childElementCount).toBe(0);
 expect(document.querySelector('#subject-title')?.textContent).toBe('sub-s04');
});

it('can show the expected roster without any indexed subject',async()=>{
 history.replaceState(null,'','/#overview');
 vi.mocked(get).mockImplementation(async(path:string)=>{
  if(path==='metadata')return {built_at:new Date().toISOString()};
  if(path==='subjects')return [];
  if(path==='overview')return {snapshot:{},expected_subjects:1,indexed_subjects:0,note:'Snapshot only',datasets:[],subjects:[{subject:'s10',indexed:false,status:'Not indexed',stages:{},flagged:0,review_required:0,preprocessing_excluded:0,task_excluded:0,source_skipped:0,jobs:[]}]};
  throw Error(path);
 });
 await import('./main');
 await vi.waitFor(()=>expect(document.querySelector('#overview-page')?.textContent).toContain('Not indexed'));
});

it('opens the affected scan from a validator issue link despite an old scan selection',async()=>{
 history.replaceState(null,'','/?subject=s03&stage=current&scan=old&focus=sub-s03%2Fses-01%2Ffunc%2Fsub-s03_ses-01_task-rest_run-1_echo-2_bold.nii.gz#review');
 vi.mocked(get).mockImplementation(async(path:string)=>{
  if(path==='metadata')return {built_at:new Date().toISOString()};
  if(path==='subjects')return [{subject:'s03'}];
  if(path.endsWith('/completion'))return {checks:[],snapshot:{},subject:'s03',status:'incomplete'};
  if(path.startsWith('artifacts?'))return [];
  if(path==='subjects/s03')return {entities:[{entity_key:'old',namespace:'raw',subject:'s03',session:'01',task:'goNogo',run:'1',datatype:'func',suffix:'bold'},{entity_key:'rest',namespace:'raw',subject:'s03',session:'01',task:'rest',run:'1',datatype:'func',suffix:'bold'}],attempts:[],decisions:[],findings:[]};
  throw Error(path);
 });
 await import('./main');
 await vi.waitFor(()=>expect(new URL(location.href).searchParams.get('scan')).toBe('rest'));
});
