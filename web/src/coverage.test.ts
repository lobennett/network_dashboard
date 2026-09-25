// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderCoverage } from "./coverage";
it("lists exact missing files and keeps behavioral exceptions separate", () => {
  const scan = {
    subject: "s03",
    session: "01",
    task: "nBack",
    run: "1",
    suffix: "bold",
    prefix: "sub-s03/ses-01/func/sub-s03_ses-01_task-nBack_run-1",
    status: "Missing scan files",
    missing_files: ["sub-s03_echo-2_bold.nii.gz"],
    events_status: "Missing (reviewed exception)",
    behavior_status: "Reviewed exception",
    task_first_level: "No exclusion recorded",
    events: [],
    designs: [],
    truncation: {},
  };
  const panel = renderCoverage(
    {
      subjects: ["s03"],
      scans: [scan],
      basis: "Recorded inventory only",
      inventory_note: "Tracked, not downloaded",
      skipped_acquisitions: 1,
    },
    vi.fn(),
  );
  expect(panel.textContent).toContain("sub-s03_echo-2_bold.nii.gz");
  expect(panel.textContent).toContain("Reviewed exception");
  expect(panel.textContent).toContain("Recorded inventory only");
});
