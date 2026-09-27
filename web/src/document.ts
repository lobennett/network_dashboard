import {receiptSummary} from './receipt';
import { apiUrl } from "./api";
import { element } from "./review";

/** Fetch through the allowed origin; keep report scripts in an opaque sandbox. */
export async function openRecordedFile(id: string, path: string) {
  const dialog = element("dialog", "", "document-preview");
  const close = element("button", "Close report");
  const status = element("p", "Loading…");
  let blobUrl: string | undefined;
  const controller = new AbortController();
  close.onclick = () => dialog.close();
  dialog.onclose = () => {
    controller.abort();
    if(blobUrl)URL.revokeObjectURL(blobUrl);
    dialog.remove();
  };
  dialog.append(close, element("h2", path.split("/").pop()), status);
  document.body.append(dialog);
  dialog.showModal();
  try {
    const response = await fetch(
      apiUrl(`artifacts/${encodeURIComponent(id)}/content`),
      {
        credentials: "include",
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new Error((await response.json()).detail ?? "File unavailable");
    if(path.endsWith('.pdf')){
      const blob=await response.blob();
      if(!dialog.isConnected)return;
      blobUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));
      const download=element('a','Download PDF');download.href=blobUrl;download.download=path.split('/').pop()??'report.pdf';
      const object=element('object');object.setAttribute('type','application/pdf');object.setAttribute('data',blobUrl);object.setAttribute('aria-label',download.download);object.append(element('p','PDF preview unavailable. Use Download PDF.'));
      status.replaceWith(download,object);return;
    }
    const text = await response.text();
    if (!dialog.isConnected) return;
    if (path.endsWith(".html")) {
      const frame = element("iframe");
      frame.title = path.split("/").pop() ?? "Report";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">${text}`;
      status.replaceWith(frame);
    } else if(path.endsWith(".json")&&/\/(milestones|defacing|conversion|bids-validator)\//.test("/"+path)){
      try{const value=JSON.parse(text);if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Not an object");status.replaceWith(receiptSummary(value,path,text));}catch{status.replaceWith(element("pre",text));}
    } else status.replaceWith(element("pre", text));
  } catch (error) {
    if (dialog.isConnected) status.textContent = String(error);
  }
}
