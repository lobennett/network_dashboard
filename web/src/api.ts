export async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/${path}`);
  if (!response.ok) {
    let message = `${response.status}: unable to load records`;
    try { message = (await response.json()).detail ?? message; } catch { /* HTTP status remains useful. */ }
    throw new Error(message);
  }
  return response.json();
}
