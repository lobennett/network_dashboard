import { expect, test } from "vitest";
import { isTaskTable, omissionLabel } from "./task-preview";
test("only recognizes events and explicitly named saved matrices", () => {
  expect(isTaskTable("sub-s03_task-goNogo_events.tsv")).toBe(true);
  expect(isTaskTable("sub-s03_desc-designMatrix.csv")).toBe(true);
  expect(isTaskTable("sub-s03_desc-confounds_timeseries.tsv")).toBe(false);
});

test("omission labels are task-specific", () => {
  expect(omissionLabel("sub-s03_task-flanker_events.tsv")).toBe("Omissions");
  expect(omissionLabel("sub-s03_task-nBack_events.tsv")).toBe("Omissions");
  expect(omissionLabel("sub-s03_task-goNogo_events.tsv")).toBe("Go omissions");
  expect(omissionLabel("sub-s03_task-stopSignal_events.tsv")).toBe("Go omissions");
  expect(omissionLabel("sub-s03_task-stopSignalWFlanker_events.tsv")).toBe("Go omissions");
});
