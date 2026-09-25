// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), cleanup: vi.fn() }));
vi.mock("@niivue/niivue", () => ({
  Niivue: class {
    attachToCanvas = vi.fn();
    loadVolumes = mocks.load;
    loadMeshes = mocks.load;
    cleanup = mocks.cleanup;
  },
}));
import { viewFile } from "./viewer";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
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
