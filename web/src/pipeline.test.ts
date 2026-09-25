// @vitest-environment jsdom
import { expect, it } from "vitest";
import { stageFor, stageStatus, reviewMetrics, scanOutcome } from "./pipeline";
it("places milestones in their actual workflow stage", () => {
  expect(stageFor("scan-decisions-approved")).toBe("review");
  expect(stageFor("dummy-volumes-trimmed")).toBe("trim");
  expect(stageFor("anatomical")).toBe("legacy");
  expect(stageFor("freesurfer")).toBe("surfaces");
});
it("never infers a FreeSurfer 8 completion or a zero-drop count from legacy work", () => {
  const rows = [{ stage: "anatomical", state: "success" }];
  expect(stageStatus("surfaces", rows)).toBe("Unrecorded");
  expect(stageStatus("source", rows)).toBe("Unrecorded");
});
it("shows recorded campaign readiness and reconstruction without implying approval", () => {
  expect(stageStatus("mriqc", [{stage:"mriqc",state:"ready"}])).toBe("Ready");
  expect(stageStatus("surfaces", [{stage:"freesurfer",state:"blocked"}])).toBe("Blocked");
  expect(stageStatus("surfaces", [{stage:"freesurfer",state:"complete"}])).toBe("Reconstructed");
});
it("uses the newest attempt, and preserves failed session jobs despite an older milestone", () => {
  expect(
    stageStatus("mriqc", [
      { stage: "mriqc", state: "failed", attempt: 2 },
      { stage: "mriqc", state: "success", attempt: 1 },
    ]),
  ).toBe("Failed");
  expect(
    stageStatus("mriqc", [
      { stage: "mriqc-complete", state: "success" },
      { stage: "mriqc", state: "unknown" },
    ]),
  ).toBe("Complete");
});
it("keeps flags, preprocessing and task eligibility distinct with explicit review status", () => {
  const scan = { entity_key: "s" };
  const data = {
    findings: [
      {
        entity_key: "s",
        finding_type: "scan-review",
        evidence_json: JSON.stringify({
          flags: "high_motion",
          approval_required: "yes",
          approved: "yes",
          original_tr_count: "721",
          tr_count: "714",
        }),
      },
    ],
    decisions: [
      { entity_key: "s", scope: "preprocessing", decision: "keep" },
      { entity_key: "s", scope: "task_first_level", decision: "exclude" },
    ],
  };
  expect(reviewMetrics(data, scan).tr_count).toBe("714");
  expect(scanOutcome(data, scan)).toEqual({
    flagged: true,
    pending: false,
    dropped: false,
    analysisExcluded: true,
  });
});

it("recognizes canonical surface review and fMRIPrep completion milestones", () => {
  expect(stageFor("surface-review-generated")).toBe("surfaces");
  expect(
    stageStatus("surfaces", [
      { stage: "surface-review-approved", state: "success" },
    ]),
  ).toBe("Approved");
  expect(
    stageStatus("fmriprep", [{ stage: "fmriprep-complete", state: "success" }]),
  ).toBe("Complete");
});
