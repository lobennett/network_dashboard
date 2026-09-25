// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { pipelineGuide } from "./pipeline-guide";
it("shows both source formats and separate approval gates joining fMRIPrep", () => {
  const page = pipelineGuide(vi.fn());
  expect(page.textContent).toContain("GE P-files");
  expect(
    page.querySelector('[data-from="scan-gate"][data-to="fmriprep"]'),
  ).not.toBeNull();
  expect(
    page.querySelector('[data-from="surface-gate"][data-to="fmriprep"]'),
  ).not.toBeNull();
  expect(page.querySelector('[data-from="mriqc"][data-to="fs"]')).toBeNull();
  expect(page.querySelectorAll(".flow-gate")).toHaveLength(2);
});
it("supports keyboard inspection and navigation to the corresponding review stage", () => {
  const navigate = vi.fn();
  const page = pipelineGuide(navigate);
  const step = page.querySelector('[data-step="surface-gate"]')!;
  Object.defineProperty(window, "innerWidth", {
    value: 1440,
    configurable: true,
  });
  step.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  expect(page.querySelector(".guide-detail")!.textContent).toContain(
    "reconstruction fingerprint",
  );
  page.querySelector<HTMLButtonElement>(".guide-detail button")!.click();
  expect(navigate).toHaveBeenCalledWith("surfaces");
});
it("runs registration visualization after preprocessing and before final review", () => {
  const page = pipelineGuide(vi.fn());
  expect(page.querySelector('[data-from="fmriprep"][data-to="registration"]')).not.toBeNull();
  expect(page.querySelector('[data-from="registration"][data-to="outputs"]')).not.toBeNull();
  expect(page.textContent).toContain("fmriprepviz 0.1.0");
});
