// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderScans } from "./scans";

it("shows real scan metrics and keeps analysis exclusions separate from processing", () => {
  const select = vi.fn();
  const panel = renderScans(
    {
      entities: [
        {
          entity_key: "scan",
          namespace: "raw",
          subject: "s03",
          session: "11",
          task: "stopSignal",
          run: "1",
          suffix: "bold",
        },
      ],
      findings: [
        {
          entity_key: "scan",
          finding_type: "scan-review",
          evidence_json: JSON.stringify({
            tr_count: "150",
            fd_mean: "0.21",
            flags: "high_motion",
          }),
        },
      ],
      decisions: [
        { entity_key: "scan", scope: "preprocessing", decision: "keep" },
        { entity_key: "scan", scope: "task_first_level", decision: "exclude" },
      ],
    },
    select,
  );
  expect(panel.textContent).toContain("150");
  expect(panel.textContent).toContain("0.210");
  expect(panel.textContent).toContain("Keep for processing");
  expect(panel.textContent).toContain("exclude");
  panel.querySelector("button")!.click();
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ task: "stopSignal", session: "11" }),
  );
});
