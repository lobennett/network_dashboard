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

export async function get<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { credentials: "include" });
  if (!response.ok) {
    let message = `${response.status}: unable to load records`;
    try {
      message = (await response.json()).detail ?? message;
    } catch {
      /* HTTP status remains useful. */
    }
    throw new Error(message);
  }
  return response.json();
}
