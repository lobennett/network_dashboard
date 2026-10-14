import {rawBehaviorTable,type Table} from './task-preview';
import {receiptSummary} from './receipt';
import { fileBlob, fileText, get, downloadFile } from "./api";
import { element } from "./review";

/** Fetch through the allowed origin; keep report scripts in an opaque sandbox. */
export async function openRecordedFile(id: string, path: string) {
  const dialog = element("dialog", "", "document-preview");
  const close = element("button", "Close report");
  const status = element("p", "Fetching and verifying the report from Oak… First load may take longer; Close cancels the request.");
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
    if(/_beh\.csv$/i.test(path)){
      const table=await get<Table>(`artifacts/${encodeURIComponent(id)}/table`);
      if(!dialog.isConnected)return;
      const download=element('button','Download recorded file','text-button');
      download.onclick=async()=>{download.disabled=true;try{await downloadFile(id,path.split('/').pop()!);}catch(error){dialog.append(element('p',String(error),'gap'));}finally{download.disabled=false;}};
      status.replaceWith(rawBehaviorTable(table),download);return;
    }
    if(/\.(png|jpg)$/i.test(path)){
      const blob=await fileBlob(id,controller.signal);
      if(!dialog.isConnected)return;
      blobUrl=URL.createObjectURL(new Blob([blob],{type:path.endsWith('.png')?'image/png':'image/jpeg'}));
      const img=element('img');img.src=blobUrl;img.alt=path.split('/').pop()??'QC image';img.style.maxWidth='100%';
      const link=element('a','Download image');link.href=blobUrl;link.download=path.split('/').pop()??'qc.png';
      status.replaceWith(link,img);return;
    }
    if(path.endsWith('.pdf')){
      const blob=await fileBlob(id,controller.signal);
      if(!dialog.isConnected)return;
      blobUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));
      const download=element('a','Download PDF');download.href=blobUrl;download.download=path.split('/').pop()??'report.pdf';
      const object=element('object');object.setAttribute('type','application/pdf');object.setAttribute('data',blobUrl);object.setAttribute('aria-label',download.download);object.append(element('p','PDF preview unavailable. Use Download PDF.'));
      status.replaceWith(download,object);return;
    }
    const text = await fileText(id,controller.signal);
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
