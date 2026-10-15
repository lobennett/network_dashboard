// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { openRecordedFile } from "./document";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
it("fetches reports through CORS and preserves the opaque report sandbox", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    value: vi.fn(),
    configurable: true,
  });
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      text: async () => "<h1>Report</h1><script>example()</script>",
    });
  vi.stubGlobal("fetch", fetch);
  await openRecordedFile("report", "scan_bold.html");
  expect(fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:18782/api/artifacts/report/content",
    expect.objectContaining({ credentials: "omit" }),
  );
  const frame = document.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).toContain("default-src 'none'");
  expect(frame.srcdoc).toContain("Report");
});
it("renders recorded text without interpreting markup", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    value: vi.fn(),
    configurable: true,
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        text: async () => "<script>example()</script>",
      }),
  );
  await openRecordedFile("text", "log.txt");
  expect(document.querySelector("pre")!.textContent).toBe(
    "<script>example()</script>",
  );
  expect(document.querySelector("script")).toBeNull();
});
it('previews PDF bytes as a PDF with a download fallback',async()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['%PDF-1.7'],{type:'application/pdf'})}));
 URL.createObjectURL=vi.fn(()=> 'blob:pdf');URL.revokeObjectURL=vi.fn();
 await openRecordedFile('pdf','gs.pdf');
 expect(document.querySelector('object')?.getAttribute('type')).toBe('application/pdf');
 expect(document.querySelector('a')?.download).toBe('gs.pdf');
});
it('summarizes a verified defacing receipt while preserving the recorded fields',async()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({status:'success',software:{name:'PyDeface',version:'2.1.0'},images:[{path:'sub-s03_T1w.nii.gz',output_sha256:'abc'}]})}));
 await openRecordedFile('receipt','code/network_fw2bids/defacing/sub-s03.json');
 expect(document.querySelector('.receipt-summary')?.textContent).toContain('PyDeface');
 expect(document.querySelector('.receipt-summary')?.textContent).toContain('sub-s03_T1w.nii.gz');
 expect(document.querySelector('details pre')?.textContent).toContain('output_sha256');
});
it('counts actual BIDS-validator issues and links affected scans',async()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
 const report={issues:{issues:[{severity:'warning',code:'SIDECAR',location:'/sub-s03/ses-01/func/sub-s03_ses-01_task-rest_run-1_echo-2_bold.json'}]},summary:{}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify(report)}));
 await openRecordedFile('validation','derivatives/bids-validator/desc-precuration_validation.json');
 expect(document.querySelector('.receipt-summary')?.textContent).toContain('1 warning');
 const link=document.querySelector<HTMLAnchorElement>('.receipt-summary a')!;
 expect(link?.getAttribute('href')).toContain('focus=');expect(link?.getAttribute('href')).toContain('sub-s03');
});
it.each(['sub-s03_task-flanker_beh.csv','behavior/sub-s1035/sub-s1035_flanker_single_task_network.csv'])('shows %s as a table with original units',async(path)=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({kind:'behavior',columns:['rt'],rows:[{rt:'421'}],total_rows:1,total_columns:1,truncated:false})}));
 await openRecordedFile('raw',path);
 expect(document.querySelector('td')?.textContent).toBe('421');
 expect(document.body.textContent).toContain('original units');
 expect(document.body.textContent).toContain('Showing 1 of 1 rows');
});

it('labels truncated raw-table columns and keeps the full-file download available',async()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({kind:'behavior',columns:['rt'],rows:[{rt:'421'}],total_rows:1,total_columns:129,truncated:true})}));
 await openRecordedFile('outside','behavior/sub-s1035/sub-s1035_survey.csv');
 expect(document.body.textContent).toContain('1 of 129 columns');
 expect(document.body.textContent).toContain('Download the recorded file for all rows and columns');
});

it('cancels the table request when the preview closes',async()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
 let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>{signal=options.signal;signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));} )));
 const loading=openRecordedFile('outside','behavior/sub-s1035/sub-s1035_flanker.csv');
 document.querySelector('dialog')!.dispatchEvent(new Event('close'));
 expect(signal?.aborted).toBe(true);
 await loading;
 expect(document.querySelector('dialog')).toBeNull();
});

it('keeps long stimulus text folded and available without executing markup',async()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:vi.fn(),configurable:true});
 const stimulus='<script>'+('raw stimulus '.repeat(20))+'</script>';
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({kind:'behavior',columns:['stimulus','rt'],rows:[{stimulus,rt:'421'}],total_rows:1,total_columns:2,truncated:false})}));
 await openRecordedFile('outside','behavior/sub-s1035/sub-s1035_flanker.csv');
 const full=document.querySelector('td details')!;
 expect(full.hasAttribute('open')).toBe(false);
 expect(full.querySelector('pre')?.textContent).toBe(stimulus);
 expect(full.querySelector('summary')?.getAttribute('aria-label')).toContain('stimulus');
 expect(document.querySelector('script')).toBeNull();
});
