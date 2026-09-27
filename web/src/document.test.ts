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
