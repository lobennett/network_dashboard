import { apiUrl } from "./api";

export async function viewFile(
  canvas: HTMLCanvasElement,
  identity: string,
  path: string,
) {
  const response = await fetch(
    apiUrl(`artifacts/${encodeURIComponent(identity)}/content`),
    { credentials: "include" },
  );
  if (!response.ok)
    throw new Error((await response.json()).detail ?? "Image unavailable");
  const { Niivue } = await import("@niivue/niivue");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const viewer = new Niivue({
    isResizeCanvas: true,
    dragAndDropEnabled: false,
  });
  try {
    await viewer.attachToCanvas(canvas);
    const files = [{ url, name: path.split("/").pop() }];
    if (/\.(white|pial|inflated|gii)$/.test(path))
      await viewer.loadMeshes(files);
    else await viewer.loadVolumes(files);
    return viewer;
  } catch (error) {
    viewer.cleanup();
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
