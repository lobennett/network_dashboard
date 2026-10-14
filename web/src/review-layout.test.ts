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
it("reaches every stage from one compact history picker with status", () => {
  const select=vi.fn();
  const controls=reviewControls("events",select,data);
  const picker=controls.querySelector<HTMLSelectElement>('select')!;
  expect(picker.options).toHaveLength(10);
  expect(picker.value).toBe('events');
  expect(picker.options[0].textContent).toContain('Unrecorded');
  picker.value='trim';picker.dispatchEvent(new Event('change'));
  expect(select).toHaveBeenCalledWith('trim');
  expect(controls.querySelectorAll('button')).toHaveLength(2);
  expect(controls.querySelector('[aria-pressed="true"]')?.textContent).toBe('Processing history');
  Array.from(controls.querySelectorAll('button')).find(b=>b.textContent==='Current files')!.click();
  expect(select).toHaveBeenLastCalledWith('current');
});
it("does not describe absent reviews as approved", () => {
  expect(subjectSummary(data).textContent).toContain("Unrecorded");
  expect(subjectSummary(data).textContent).not.toContain("Approved");
});

it("labels current files as a separate mode and returns to the last history stage",()=>{
 const select=vi.fn();
 const controls=reviewControls('current',select,undefined,'mriqc');
 expect(controls.querySelector('select')).toBeNull();
 expect(controls.querySelector('[aria-pressed="true"]')?.textContent).toBe('Current files');
 expect(controls.textContent).toContain('not evidence');
 Array.from(controls.querySelectorAll('button')).find(b=>b.textContent==='Processing history')!.click();
 expect(select).toHaveBeenCalledWith('mriqc');
});
