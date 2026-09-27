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
    expect.objectContaining({ credentials: "include" }),
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
