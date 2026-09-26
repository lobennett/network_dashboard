// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), cleanup: vi.fn(), label: vi.fn(), slice: vi.fn() }));
vi.mock("@niivue/niivue", () => ({
  Niivue: class {
    attachToCanvas = vi.fn();
    setSliceType = mocks.slice;
    sliceTypeRender = 4;
    sliceTypeMultiplanar = 3;
    loadVolumes = mocks.load;
    loadMeshes = mocks.load;
    cleanup = mocks.cleanup;
    volumes = [{}, {setColormapLabel: mocks.label}];
    updateGLVolume = vi.fn();
  },
}));
import { viewFile } from "./viewer";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('loads anatomy and a labeled ribbon together', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]))));
  URL.createObjectURL = vi.fn().mockReturnValue('blob:image');
  URL.revokeObjectURL = vi.fn();
  await viewFile(document.createElement('canvas'), 'norm', 'mri/norm.mgz', [{id:'ribbon', path:'mri/ribbon.mgz'}]);
  expect(mocks.load).toHaveBeenCalledWith([
    {url:'blob:image', name:'norm.mgz'},
    {url:'blob:image', name:'ribbon.mgz', opacity:0.35},
  ]);
  expect(mocks.label).toHaveBeenCalledWith(expect.objectContaining({I:[0,2,3,41,42]}));
});
it("fetches authenticated bytes and revokes the temporary viewer URL", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://data.example.edu");
  const request = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", request);
  const create = vi.fn().mockReturnValue("blob:preview"),
    revoke = vi.fn();
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  await viewFile(document.createElement("canvas"), "id", "scan_bold.nii.gz");
  expect(request).toHaveBeenCalledWith(
    "https://data.example.edu/api/artifacts/id/content",
    expect.objectContaining({ credentials: "include" }),
  );
  expect(mocks.load).toHaveBeenCalledWith([
    { url: "blob:preview", name: "scan_bold.nii.gz" },
  ]);
  expect(revoke).toHaveBeenCalledWith("blob:preview");
});


it("loads white/pial surfaces with distinct colors and a transparent pial surface", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]))));
  URL.createObjectURL = vi.fn().mockReturnValue("blob:mesh");
  URL.revokeObjectURL = vi.fn();
  await viewFile(document.createElement("canvas"), "white", "surf/lh.white", [{id:"pial",path:"surf/lh.pial"}], "surfaces");
  expect(mocks.load).toHaveBeenCalledWith([
    expect.objectContaining({name:"lh.white",rgba255:new Uint8Array([52,119,197,255])}),
    expect.objectContaining({name:"lh.pial",opacity:0.35,rgba255:new Uint8Array([230,139,40,255])}),
  ]);
  expect(mocks.slice).toHaveBeenCalledWith(4);
});

it("opens paired volume checks in three planes with a colored overlay", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]))));
  URL.createObjectURL = vi.fn().mockReturnValue("blob:volume");
  URL.revokeObjectURL = vi.fn();
  await viewFile(document.createElement("canvas"), "mag", "magnitude.nii.gz", [{id:"map",path:"fieldmap.nii.gz"}], "fieldmap");
  expect(mocks.load).toHaveBeenCalledWith([
    expect.objectContaining({name:"magnitude.nii.gz"}),
    expect.objectContaining({name:"fieldmap.nii.gz",colormap:"warm",opacity:0.35}),
  ]);
  expect(mocks.slice).toHaveBeenCalledWith(3);
});


it("cleans up the viewer and temporary bytes when an overlay cannot be fetched", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(new Uint8Array([1])))
    .mockResolvedValueOnce(new Response(JSON.stringify({detail:"Checksum mismatch"}), {status:409})));
  URL.createObjectURL = vi.fn().mockReturnValue("blob:base");
  URL.revokeObjectURL = vi.fn();
  await expect(viewFile(document.createElement("canvas"), "mag", "magnitude.nii.gz", [{id:"map",path:"fieldmap.nii.gz"}], "fieldmap")).rejects.toThrow("Checksum mismatch");
  expect(mocks.cleanup).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:base");
  expect(mocks.load).not.toHaveBeenCalled();
});
