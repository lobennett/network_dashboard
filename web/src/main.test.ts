// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { get } from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  get: vi.fn(),
}));
vi.mock("./viewer", () => ({ viewFile: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("waits for a connection click before accessing the local network", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  responses(() => Promise.reject(new Error("unexpected request")));
  await import("./main");
  expect(get).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>(".connection button")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".scan-name")).not.toBeNull(),
  );
  expect(document.querySelector(".connection")).toBeNull();
});
function responses(lineage: (path: string) => Promise<unknown>) {
  vi.mocked(get).mockImplementation((path: string) => {
    if (path === "metadata")
      return Promise.resolve({
        stale: false,
        built_at: new Date(Date.now() - 899_000).toISOString(),
      });
    if (path === "subjects") return Promise.resolve([{ subject: "s03" }]);
    if (path.startsWith("subjects/"))
      return Promise.resolve({
        entities: [
          {
            namespace: "raw",
            subject: "s03",
            session: "07",
            task: "goNogo",
            run: "1",
            suffix: "bold",
            entity_key: "scan",
          },
        ],
        attempts: [],
        decisions: [],
        findings: [],
      });
    if (path.startsWith("artifacts?q="))
      return Promise.resolve([
        { id: "a", path: "a_bold.nii.gz", preview_available: true },
        { id: "b", path: "b.html", preview_available: true },
      ]);
    return lineage(path);
  });
}
it("an obsolete lineage error cannot replace the newer selected file", async () => {
  let rejectOld!: (error: Error) => void;
  const old = new Promise((_, reject) => {
    rejectOld = reject;
  });
  responses((path) =>
    path.includes("/a/")
      ? old
      : Promise.resolve({
          artifact: { id: "b", path: "b.html" },
          artifacts: [],
          links: [],
          attempts: [],
          ancestry: "unrecorded",
        }),
  );
  await import("./main");
  await vi.waitFor(() =>
    expect(document.querySelector(".scan-name")).not.toBeNull(),
  );
  document.querySelector<HTMLButtonElement>(".scan-name")!.click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".text-button")).toHaveLength(2),
  );
  const buttons = document.querySelectorAll<HTMLButtonElement>(".text-button");
  buttons[0].click();
  buttons[1].click();
  await vi.waitFor(() =>
    expect(document.querySelector(".preview-display")?.textContent).toContain(
      "b.html",
    ),
  );
  rejectOld(new Error("old request failed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".preview-display")?.textContent).toContain(
    "b.html",
  );
  expect(document.querySelector(".preview-display")?.textContent).not.toContain(
    "old request failed",
  );
});
it("an open page marks an aging index as not live", async () => {
  vi.useFakeTimers();
  responses(() => Promise.reject(new Error("unexpected request")));
  await import("./main");
  await vi.waitFor(() =>
    expect(document.getElementById("freshness")?.textContent).toContain(
      "Snapshot:",
    ),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(document.getElementById("freshness")?.textContent).toContain(
    "Snapshot (not live)",
  );
});
