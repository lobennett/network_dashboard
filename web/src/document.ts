import { apiUrl } from "./api";
import { element } from "./review";

/** Fetch through the allowed origin; keep report scripts in an opaque sandbox. */
export async function openRecordedFile(id: string, path: string) {
  const dialog = element("dialog", "", "document-preview");
  const close = element("button", "Close report");
  const status = element("p", "Loading…");
  const controller = new AbortController();
  close.onclick = () => dialog.close();
  dialog.onclose = () => {
    controller.abort();
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
    const text = await response.text();
    if (!dialog.isConnected) return;
    if (path.endsWith(".html")) {
      const frame = element("iframe");
      frame.title = path.split("/").pop() ?? "Report";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">${text}`;
      status.replaceWith(frame);
    } else status.replaceWith(element("pre", text));
  } catch (error) {
    if (dialog.isConnected) status.textContent = String(error);
  }
}
