export async function viewFile(
  canvas: HTMLCanvasElement,
  identity: string,
  path: string,
) {
  const url = `/api/artifacts/${encodeURIComponent(identity)}/content`;
  // Check eligibility before asking WebGL to load the file.
  const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (!response.ok)
    throw new Error((await response.json()).detail ?? "Image unavailable");
  const { Niivue } = await import("@niivue/niivue");
  const viewer = new Niivue({
    isResizeCanvas: true,
    dragAndDropEnabled: false,
  });
  await viewer.attachToCanvas(canvas);
  if (/\.(white|pial|inflated|gii)$/.test(path)) {
    await viewer.loadMeshes([{ url, name: path.split("/").pop() }]);
  } else {
    await viewer.loadVolumes([{ url, name: path.split("/").pop() }]);
  }
  return viewer;
}
