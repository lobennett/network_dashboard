// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { flywheelInventory } from "./flywheel";
it("labels a current inventory honestly and exposes rejected acquisition reasons", () => {
  const select = vi.fn();
  const panel = flywheelInventory(
    {
      entities: [],
      attempts: [],
      decisions: [],
      findings: [
        {
          finding_type: "flywheel-acquisition",
          evidence_json: JSON.stringify({
            label: "T1w_qa-reject",
            decision: "skipped",
            reason: "qa-reject",
            snapshot_kind: "current_inventory",
            captured_at: "now",
          }),
        },
      ],
    },
    select,
  );
  expect(panel.textContent).toContain("does not establish");
  expect(panel.textContent).toContain("qa-reject");
  expect(panel.querySelector("button")).toBeNull();
});
