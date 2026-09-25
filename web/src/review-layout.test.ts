// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { initialScan, reviewControls, subjectSummary } from "./review-layout";
import type { Subject } from "./pipeline";
const data: Subject = {
  entities: [
    { entity_key: "one", namespace: "raw", suffix: "bold", subject: "s03" },
    { entity_key: "two", namespace: "raw", suffix: "T1w", subject: "s03" },
  ],
  findings: [],
  decisions: [],
  attempts: [],
};
it("opens a functional scan by default, but prioritizes pending reviews", () => {
  expect(initialScan(data)?.entity_key).toBe("one");
  expect(
    initialScan({
      ...data,
      findings: [
        {
          entity_key: "two",
          finding_type: "scan-review",
          evidence_json: '{"approval_required":"yes","approved":"no"}',
        },
      ],
    })?.entity_key,
  ).toBe("two");
});
it("keeps stages reachable without an eight-card navigation strip", () => {
  const select = vi.fn();
  const controls = reviewControls("events", select);
  expect(controls.querySelectorAll("nav button")).toHaveLength(3);
  const chooser = controls.querySelector("select")!;
  expect(chooser.value).toBe("events");
  chooser.value = "fmriprep";
  chooser.dispatchEvent(new Event("change"));
  expect(select).toHaveBeenCalledWith("fmriprep");
});
it("does not describe absent reviews as approved", () => {
  expect(subjectSummary(data).textContent).toContain("Unrecorded");
  expect(subjectSummary(data).textContent).not.toContain("Approved");
});
