import { expect, test } from "vitest";
import { isTaskTable, goOmissions } from "./task-preview";
test("only recognizes events and explicitly named saved matrices", () => {
  expect(isTaskTable("sub-s03_task-goNogo_events.tsv")).toBe(true);
  expect(isTaskTable("sub-s03_desc-designMatrix.csv")).toBe(true);
  expect(isTaskTable("sub-s03_desc-confounds_timeseries.tsv")).toBe(false);
});

test("omission counts accept numeric TSV values but exclude break rows", () => {
  const trial = { trial_id: "test_trial", trial_type: "go", key_press: "-1.0" };
  expect(
    goOmissions([
      trial,
      { ...trial, key_press: "-1" },
      { ...trial, trial_id: "break" },
      { ...trial, key_press: "n/a" },
    ]),
  ).toBe(2);
});
