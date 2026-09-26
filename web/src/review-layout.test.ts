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
it("makes all stages directly reachable without a stage dropdown", () => {
  const select=vi.fn();
  const controls=reviewControls("events",select);
  expect(controls.querySelector('select')).toBeNull();
  const button=Array.from(controls.querySelectorAll('button')).find(b=>b.textContent?.includes('Trim volumes'))!;
  button.click();
  expect(select).toHaveBeenCalledWith('trim');
  expect(controls.textContent).toContain('Current files');
});
it("does not describe absent reviews as approved", () => {
  expect(subjectSummary(data).textContent).toContain("Unrecorded");
  expect(subjectSummary(data).textContent).not.toContain("Approved");
});
