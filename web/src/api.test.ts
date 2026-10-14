// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { apiUrl } from "./api";
afterEach(() => vi.unstubAllEnvs());
it("allows the explicit loopback service for SSH-backed access", () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  expect(apiUrl("subjects")).toBe("http://127.0.0.1:18782/api/subjects");
});
it("uses the configured HTTPS data service without proxying images through Vercel", () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://data.example.edu");
  expect(apiUrl("artifacts/abc/content")).toBe(
    "https://data.example.edu/api/artifacts/abc/content",
  );
});
it("defaults to the local API and rejects non-HTTPS remote endpoints", () => {
  vi.stubEnv("VITE_API_BASE_URL", "");
  expect(apiUrl("subjects")).toBe("/api/subjects");
  vi.stubEnv("VITE_API_BASE_URL", "http://example.org");
  expect(() => apiUrl("subjects")).toThrow("HTTPS");
});

it('ends a stalled request with an actionable error', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })));
  const {get} = await import('./api');
  const pending = expect(get('coverage')).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(60000);
  await pending;
  vi.useRealTimers();vi.unstubAllGlobals();
});

it('downloads through a CORS fetch and a local blob, not a cross-site API navigation', async () => {
  const {downloadFile} = await import('./api');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('onset\tduration\n0\t1')));
  URL.createObjectURL=vi.fn().mockReturnValue('blob:download');URL.revokeObjectURL=vi.fn();
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this: HTMLAnchorElement){
    expect(this.href).toBe('blob:download');expect(this.download).toBe('events.tsv');
  });
  await downloadFile('events','events.tsv');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('artifacts/events/content'),expect.objectContaining({credentials:'omit'}));
  click.mockRestore();vi.unstubAllGlobals();
});
it('allows a large file to finish after the old two-minute cutoff',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockImplementation((_url,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));setTimeout(()=>resolve(new Response('large image')),125000);})));
 const {fileBlob}=await import('./api');
 const result=fileBlob('large');const checked=expect(result).resolves.toBeInstanceOf(Blob);
 await vi.advanceTimersByTimeAsync(125000);await checked;vi.useRealTimers();vi.unstubAllGlobals();
});
