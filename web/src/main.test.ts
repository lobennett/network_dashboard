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
  await vi.waitFor(() => expect(document.querySelector(".review-modes button")).not.toBeNull());
  await vi.waitFor(() => expect(document.querySelector(".scan-name")).not.toBeNull());
  expect(document.querySelector(".connection")).toBeNull();
});
it("explains local-network access when the browser cannot reach the connector", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  vi.mocked(get).mockRejectedValue(new TypeError("Failed to fetch"));
  await import("./main");
  document.querySelector<HTMLButtonElement>(".connection button")!.click();
  await vi.waitFor(() => expect(document.getElementById("notice")?.textContent).toContain("Local network access"));
  expect(document.getElementById("freshness")?.textContent).toBe("Connector unreachable");
  expect(document.querySelector<HTMLButtonElement>(".connection button")!.disabled).toBe(false);
});
it("opens Current files by default and keeps explicit stage deep links", async () => {
  responses(() => Promise.resolve({}));
  await import("./main");
  await vi.waitFor(() => expect(document.querySelector('.review-modes [aria-pressed="true"]')?.textContent).toBe("Current files"));
  expect(new URL(location.href).searchParams.get("stage")).toBe("current");
  Array.from(document.querySelectorAll<HTMLButtonElement>(".review-modes button")).find(b=>b.textContent==="Processing history")!.click();
  const picker = document.querySelector<HTMLSelectElement>(".review-controls select")!;
  expect(picker.options).toHaveLength(10);
  picker.value = "mriqc"; picker.dispatchEvent(new Event("change"));
  expect(new URL(location.href).searchParams.get("stage")).toBe("mriqc");
  expect(document.querySelector<HTMLSelectElement>(".review-controls select")?.value).toBe("mriqc");
});
it.each(["local", "oak"])("labels %s file access independently of the snapshot date", async (mode) => {
  responses(() => Promise.resolve({}));
  const original = vi.mocked(get).getMockImplementation()!;
  vi.mocked(get).mockImplementation((path: string) => path === "metadata"
    ? Promise.resolve({ built_at: new Date().toISOString(), capabilities: ["approved_analysis_exports"], file_access: mode }) as never
    : original(path));
  await import("./main");
  await vi.waitFor(() => expect(document.getElementById("freshness")?.textContent).toContain(
    mode === "oak" ? "Oak files on demand" : "Local files only"));
  expect(document.getElementById("connector-warning")?.hidden).toBe(mode === "oak");
  if (mode === "local") expect(document.getElementById("connector-warning")?.textContent).toContain("not downloaded");
});
it("switches the whole review to Current files from a historical-only stage", async () => {
  history.replaceState(null, "", "/?stage=bids&subject=s03&scan=scan");
  responses((path) => Promise.reject(new Error(path)));
  const original = vi.mocked(get).getMockImplementation()!;
  vi.mocked(get).mockImplementation((path: string) =>
    path.includes("/stages/")
      ? Promise.resolve({ stage: "bids", subject: "s03", snapshot_kind: "recorded_stage_evidence", inputs: [], outputs: [], processing: [], findings: [{ entity_key: "scan", finding_type: "conversion", evidence_json: "{}" }], decisions: [], milestones: [] }) as never
      : path.startsWith("artifacts?") && path.includes("stage=bids")
      ? Promise.resolve([{ id: "old", path: "a_bold.nii.gz", dataset_id: "raw", content_id: "old", availability: "historical", preview_reason: "Historical bytes have not been published for this version." }]) as never
      : original(path));
  await import("./main");
  const shortcut = () => Array.from(document.querySelectorAll<HTMLButtonElement>("#inspector button")).find(b => b.textContent === "View current scan files");
  await vi.waitFor(() => expect(shortcut()).toBeDefined());
  shortcut()!.click();
  const url = new URL(location.href);
  expect(url.searchParams.get("stage")).toBe("current");
  expect(url.searchParams.get("scan")).toBe("scan");
  expect(document.querySelector('.review-modes [aria-pressed="true"]')?.textContent).toBe("Current files");
});
it("keeps Data completeness under Study and labels the export page", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  await import("./main");
  const labels = Array.from(document.querySelectorAll(".page-nav a")).map(a => a.textContent);
  expect(labels).toEqual(["Study", "Review data", "Analysis exports", "Guide"]);
  location.hash = "coverage"; window.dispatchEvent(new Event("hashchange"));
  expect(document.getElementById("study-tabs")!.hidden).toBe(false);
  expect(document.querySelector('.page-nav a[aria-current="page"]')?.textContent).toBe("Study");
  expect(document.querySelector('.study-tabs a[aria-current="page"]')?.textContent).toBe("Data completeness");
  location.hash = "exclusions"; window.dispatchEvent(new Event("hashchange"));
  expect(document.getElementById("study-tabs")!.hidden).toBe(true);
  expect(document.title).toContain("Analysis exports");
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
  await vi.waitFor(() => expect(document.querySelector(".review-modes button")).not.toBeNull());
  await vi.waitFor(() => expect(document.querySelector(".scan-name")).not.toBeNull());
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

it("offers the pipeline guide before connecting and hides empty review", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  await import("./main");
  location.hash = "pipeline";
  window.dispatchEvent(new Event("hashchange"));
  expect(document.getElementById("pipeline-page")!.hidden).toBe(false);
  expect(document.getElementById("review-page")!.hidden).toBe(true);
  expect(get).not.toHaveBeenCalled();
  location.hash = "review";
  window.dispatchEvent(new Event("hashchange"));
  expect(document.getElementById("review-page")!.hidden).toBe(true);
  expect(document.getElementById("overview-page")!.hidden).toBe(false);
  expect(document.getElementById("review-nav")!.hidden).toBe(true);
});

it('clears old source buttons before a new subject finishes loading',async()=>{
 history.replaceState(null,'','/?stage=source');
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

it('keeps the review page visible when its skip link is used',async()=>{
 history.replaceState(null,'','/#review');responses(()=>Promise.resolve({}));
 await import('./main');await vi.waitFor(()=>expect(document.querySelector('#review-page')?.hasAttribute('hidden')).toBe(false));
 location.hash='review-page';window.dispatchEvent(new Event('hashchange'));
 expect(document.querySelector('#review-page')?.hasAttribute('hidden')).toBe(false);
});
it('loads the overview once after connecting',async()=>{
 history.replaceState(null,'','/#overview');responses(()=>Promise.resolve({snapshot:{},expected_subjects:1,indexed_subjects:1,note:'Snapshot',datasets:[],subjects:[]}));
 await import('./main');await vi.waitFor(()=>expect(document.querySelector('#subject-title')?.textContent).toBe('sub-s03'));
 await vi.waitFor(()=>expect(vi.mocked(get).mock.calls.filter(([path])=>path==='overview')).toHaveLength(1));
});
it('does not flash overview while navigating to a subject review',async()=>{
 history.replaceState(null,'','/#overview');responses(()=>Promise.resolve({snapshot:{},expected_subjects:1,indexed_subjects:1,note:'Snapshot',datasets:[],subjects:[]}));
 await import('./main');await vi.waitFor(()=>expect(document.querySelector('#subject-title')?.textContent).toBe('sub-s03'));
 const original=vi.mocked(get).getMockImplementation()!;const value=await original('subjects/s03');
 let release!:(value:unknown)=>void;const pending=new Promise(resolve=>{release=resolve;});
 vi.mocked(get).mockImplementation(path=>path==='subjects/s03'?pending as never:original(path));
 location.hash='review';document.querySelector<HTMLButtonElement>('#subjects button')!.click();window.dispatchEvent(new Event('hashchange'));
 expect(document.querySelector('#review-page')?.hasAttribute('hidden')).toBe(false);
 expect(document.querySelector('#overview-page')?.hasAttribute('hidden')).toBe(true);
 release(value);await vi.waitFor(()=>expect(document.querySelector('.review-modes button')).not.toBeNull());
});
