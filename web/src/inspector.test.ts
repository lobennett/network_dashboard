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
