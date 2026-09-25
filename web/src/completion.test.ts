// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { completionChecklist } from "./completion";
it("keeps missing evidence visible and links checks to the relevant stage", () => {
  const select = vi.fn();
  const panel = completionChecklist(
    {
      subject: "s03",
      status: "incomplete",
      note: "Snapshot only",
      snapshot: {},
      checks: [
        {
          id: "surfaces",
          title: "Surfaces",
          status: "complete",
          detail: "Approved by LB",
          stage: "surfaces",
          evidence: [],
        },
        {
          id: "reports",
          title: "fMRIPrep report",
          status: "pending",
          detail: "No extracted report",
          stage: "fmriprep",
          evidence: [],
        },
        {
          id: "alignment",
          title: "Output lengths",
          status: "failed",
          detail: "Confound rows mismatch",
          stage: "fmriprep",
          evidence: [],
        },
      ],
    },
    select,
  );
  expect(panel.textContent).toContain("Confound rows mismatch");
  expect(panel.textContent).not.toContain("Ready for analysis");
  const row = Array.from(panel.querySelectorAll("li")).find((x) =>
    x.textContent?.includes("No extracted report"),
  )!;
  row.querySelector("button")!.click();
  expect(select).toHaveBeenCalledWith("fmriprep");
  const complete = Array.from(panel.querySelectorAll("li")).find((x) =>
    x.textContent?.includes("Approved by LB"),
  )!;
  expect(complete.closest("details")?.open).toBe(false);
});
