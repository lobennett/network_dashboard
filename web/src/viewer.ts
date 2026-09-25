import { apiUrl } from "./api";

export async function viewFile(
  canvas: HTMLCanvasElement,
  identity: string,
  path: string,
  overlays: {id: string; path: string}[] = [],
) {
  const { Niivue } = await import("@niivue/niivue");
  const urls: string[] = [];
  const viewer = new Niivue({
    isResizeCanvas: true,
    dragAndDropEnabled: false,
  });
  try {
    const files = [];
    for (const [index, file] of [{id: identity, path}, ...overlays].entries()) {
      const response = await fetch(apiUrl(`artifacts/${encodeURIComponent(file.id)}/content`), {credentials:'include'});
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Image unavailable');
      const url = URL.createObjectURL(await response.blob());
      urls.push(url);
      files.push({url, name: file.path.split('/').pop(), ...(index ? {opacity:0.35} : {})});
    }
    await viewer.attachToCanvas(canvas);
    if (/\.(white|pial|inflated|gii)$/.test(path))
      await viewer.loadMeshes(files);
    else await viewer.loadVolumes(files);
    if (overlays[0]?.path.endsWith('/ribbon.mgz')) {
      viewer.volumes[1].setColormapLabel({
        I:[0,2,3,41,42], R:[0,245,205,245,205], G:[0,245,62,245,62], B:[0,245,78,245,78],
        A:[0,255,255,255,255], labels:['Background','Left white matter','Left cortex','Right white matter','Right cortex'],
      });
      viewer.updateGLVolume();
    }
    return viewer;
  } catch (error) {
    viewer.cleanup();
    throw error;
  } finally {
    urls.forEach(url => URL.revokeObjectURL(url));
  }
}
