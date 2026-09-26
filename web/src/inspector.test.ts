// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { get } from "./api";
import { viewFile } from "./viewer";
import { ScanInspector } from "./inspector";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  get: vi.fn(),
}));
vi.mock("./viewer", () => ({ viewFile: vi.fn() }));
const scan = {
  entity_key: "scan",
  subject: "s03",
  session: "07",
  task: "goNogo",
  run: "1",
  suffix: "bold",
};
const data = { entities: [scan], attempts: [], decisions: [], findings: [] };
beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = "<article></article>";
});
it("offers an image action only for verified available content", async () => {
  vi.mocked(get).mockResolvedValue([
    { id: "safe", path: "safe_bold.nii.gz", preview_available: true },
    {
      id: "original",
      path: "original_T1w.nii.gz",
      preview_available: false,
      preview_reason: "defacing required",
    },
  ]);
  const panel = document.querySelector("article")!;
  await new ScanInspector(panel).show(data, scan, "mriqc");
  await vi.waitFor(() =>
    expect(panel.querySelectorAll(".primary")).toHaveLength(1),
  );
  expect(panel.querySelector(".primary")?.getAttribute("title")).toBe(
    "safe_bold.nii.gz",
  );
  expect(panel.querySelector(".unavailable")?.textContent).toContain(
    "defacing required",
  );
});
it("cleans up a pending preview when evidence replaces its detached canvas", async () => {
  vi.mocked(get).mockResolvedValue([
    { id: "safe", path: "safe_bold.nii.gz", preview_available: true },
  ]);
  let complete!: (v: Awaited<ReturnType<typeof viewFile>>) => void;
  vi.mocked(viewFile).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const panel = document.querySelector("article")!;
  await new ScanInspector(panel).show(data, scan, "mriqc");
  await vi.waitFor(() =>
    expect(panel.querySelector(".primary")).not.toBeNull(),
  );
  panel.querySelector<HTMLButtonElement>(".primary")!.click();
  panel
    .querySelectorAll<HTMLButtonElement>(".inspector-tabs button")[2]
    .click();
  const cleanup = vi.fn();
  complete({ cleanup } as unknown as Awaited<ReturnType<typeof viewFile>>);
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  expect(panel.querySelector("canvas")).toBeNull();
});

it("shows subject-level surface decisions and queries the standalone reconstruction", async () => {
  vi.mocked(get).mockResolvedValue([]);
  const panel = document.querySelector("article")!;
  await new ScanInspector(panel).show(
    {
      ...data,
      decisions: [
        {
          entity_key: "anatomical|s03|surface",
          scope: "surface",
          decision: "yes",
          reviewer: "LB",
          reason: "Inspected",
        },
      ],
    },
    scan,
    "surfaces",
  );
  expect(panel.textContent).toContain(
    "Surface review: Approved · LB — Inspected",
  );
  expect(vi.mocked(get)).toHaveBeenCalledWith(
    expect.stringContaining("subject=s03&dataset_stage=freesurfer"),
  );
});

it("offers fetching registered Oak images without treating blocked anatomy as fetchable", async () => {
  vi.mocked(get).mockResolvedValue([
    {
      id: "remote",
      path: "scan_bold.nii.gz",
      preview_available: false,
      fetch_available: true,
    },
    {
      id: "blocked",
      path: "scan_T1w.nii.gz",
      preview_available: false,
      fetch_available: false,
    },
  ]);
  const panel = document.querySelector("article")!;
  await new ScanInspector(panel).show(data, scan, "mriqc");
  await vi.waitFor(() =>
    expect(panel.querySelectorAll(".primary")).toHaveLength(1),
  );
  expect(panel.querySelector(".primary")?.getAttribute("title")).toContain(
    "downloads from Oak",
  );
});
it("offers the subject registration viewer without surface controls", async () => {
  vi.mocked(get).mockResolvedValue([{id:"qc", path:"sub-s03/sub-s03_desc-registration.html", preview_available:true}]);
  const panel = document.querySelector("article")!;
  await new ScanInspector(panel).show(data, scan, "registration");
  await vi.waitFor(() => expect(panel.querySelector(".primary")).not.toBeNull());
  expect(panel.querySelector("h2")!.textContent).toBe("Registration review");
  expect(panel.querySelector(".surface-group")).toBeNull();
  expect(vi.mocked(get).mock.calls[0][0]).toContain("dataset_stage=fmriprepviz");
});

it("opens a matched ribbon preset and exposes overlay opacity", async () => {
  const norm={id:"norm",path:"subjects/sub-s03/mri/norm.mgz",dataset_id:"fs",preview_available:true,content_id:"hash"};
  const ribbon={...norm,id:"ribbon",path:"subjects/sub-s03/mri/ribbon.mgz"};
  vi.mocked(get).mockResolvedValue([norm,ribbon]);
  const setOpacity=vi.fn();
  vi.mocked(viewFile).mockResolvedValue({cleanup:vi.fn(),setOpacity} as unknown as Awaited<ReturnType<typeof viewFile>>);
  const panel=document.querySelector("article")!;
  await new ScanInspector(panel).show(data,scan,"surfaces");
  await vi.waitFor(()=>expect(panel.querySelector('.viewer-presets .primary')).not.toBeNull());
  panel.querySelector<HTMLButtonElement>('.viewer-presets .primary')!.click();
  await vi.waitFor(()=>expect(panel.querySelector('input[type=range]')).not.toBeNull());
  const slider=panel.querySelector<HTMLInputElement>('input[type=range]')!;
  slider.value="0.6";slider.dispatchEvent(new Event('input'));
  expect(setOpacity).toHaveBeenCalledWith(1,0.6);
  expect(viewFile).toHaveBeenCalledWith(expect.anything(),"norm",norm.path,[ribbon],"ribbon");
});

it("opens the readable history immediately with technical records collapsed", async () => {
  const artifact={id:"image",path:"scan_bold.nii.gz",preview_available:true};
  vi.mocked(get).mockImplementation(async path => {
    if (path.endsWith('/lineage')) return {artifact,artifacts:[artifact],links:[],attempts:[],ancestry:'unrecorded'};
    if (path.endsWith('/tree')) return {artifact,artifacts:[artifact],links:[],attempts:[],truncated:false};
    return [artifact];
  });
  const panel=document.querySelector("article")!;
  await new ScanInspector(panel).show(data,scan,"bids");
  await vi.waitFor(()=>expect(panel.querySelector('.preview-choices .text-button')).not.toBeNull());
  panel.querySelector<HTMLButtonElement>('.preview-choices .text-button')!.click();
  await vi.waitFor(()=>expect(panel.querySelector('.provenance-journey')).not.toBeNull());
  expect(panel.querySelector('.preview-display > details')?.hasAttribute('open')).toBe(false);
  expect(panel.textContent).toContain('Earlier history unrecorded');
});


it("preserves same-content anatomy across reconstructions when matching presets", async () => {
  const norm={id:"norm-a",path:"subjects/sub-s03/mri/norm.mgz",dataset_id:"a",preview_available:true,content_id:"same"};
  const other={...norm,id:"norm-b",dataset_id:"b"};
  const ribbon={...norm,id:"ribbon-a",path:"subjects/sub-s03/mri/ribbon.mgz",content_id:"ribbon"};
  vi.mocked(get).mockResolvedValue([norm,other,ribbon]);
  const panel=document.querySelector("article")!;
  await new ScanInspector(panel).show(data,scan,"surfaces");
  await vi.waitFor(()=>expect(panel.querySelector('.viewer-presets')).not.toBeNull());
  expect(panel.querySelector('.viewer-presets select')?.textContent).toContain('Ribbon over anatomy');
});

it('includes the subject boundary on every historical file query',async()=>{
 vi.mocked(get).mockResolvedValue([]);
 await new ScanInspector(document.querySelector('article')!).show(data,scan,'bids');
 await vi.waitFor(()=>expect(get).toHaveBeenCalled());
 const path=String(vi.mocked(get).mock.calls[0][0]);
 expect(path).toContain('stage=bids');expect(path).toContain('subject=s03');
});
it('shows output approval rather than surface approval during registration review',async()=>{
 vi.mocked(get).mockResolvedValue([]);
 const panel=document.querySelector('article')!;
 await new ScanInspector(panel).show({...data,decisions:[{scope:'output',decision:'approved',reviewer:'LB',reason:'Registration reviewed'}]},scan,'registration');
 expect(panel.textContent).toContain('Registration reviewed');expect(panel.textContent).toContain('LB');
});
