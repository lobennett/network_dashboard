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

test('recognizes canonical raw behavior without treating arbitrary CSVs as designs',()=>{
 expect(isTaskTable('sub-s03_task-flanker_beh.csv')).toBe(true);
 expect(isTaskTable('participants.csv')).toBe(false);
});

test('recognizes canonical out-of-scanner behavior without matching QA or another subject',()=>{
 expect(isTaskTable('behavior/sub-s1035/sub-s1035_flanker_single_task_network.csv')).toBe(true);
 expect(isTaskTable('qa/sub-s1035/sub-s1035_flanker.csv')).toBe(false);
 expect(isTaskTable('behavior/sub-s1035/sub-s03_flanker.csv')).toBe(false);
});
