/// <reference types="vite/client" />
export function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!configured) return `/api/${path}`;
  const base = new URL(configured);
  if (
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
      )) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error(
      "The data service must use HTTPS or a local loopback address, without embedded credentials",
    );
  return `${base.href.replace(/\/$/, "")}/api/${path}`;
}

async function readResponse<T>(path: string, read: (response: Response) => Promise<T>, timeoutMs = 60000, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  if(signal?.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => {timedOut=true;controller.abort();}, timeoutMs);
  try {
    const response = await fetch(apiUrl(path), {credentials:'omit',signal:controller.signal});
    if (!response.ok) {
      let message = `${response.status}: unable to load records`;
      try { message = (await response.json()).detail ?? message; } catch { /* Keep HTTP status. */ }
      throw new Error(message);
    }
    return await read(response);
  } catch(error) {
    if(timedOut) throw new Error(path.includes('/content')
      ? 'File transfer timed out. The connector may still be downloading a large file; check its terminal and retry after the transfer finishes.'
      : 'Request timed out. Check the connector terminal for SSH errors, then retry. Restart connect if authentication expired.');
    throw error;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}

export function get<T>(path: string): Promise<T> {
  return readResponse(path, response => response.json());
}
export function fileBlob(id: string, signal?: AbortSignal): Promise<Blob> {
  return readResponse(`artifacts/${encodeURIComponent(id)}/content`, response => response.blob(), 1200000, signal);
}
export function fileText(id: string, signal?: AbortSignal): Promise<string> {
  return readResponse(`artifacts/${encodeURIComponent(id)}/content`, response => response.text(), 1200000, signal);
}
export function downloadFile(id: string, filename: string): Promise<void> {
  return downloadPath(`artifacts/${encodeURIComponent(id)}/content`, filename);
}
export async function downloadPath(path: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(await readResponse(path,response=>response.blob(),1200000));
  const link = document.createElement('a');link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
