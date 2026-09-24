// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderDecisions, renderAttempts } from "./review";

describe("review evidence", () => {
  it("keeps preprocessing retention and first-level exclusion visibly distinct", () => {
    const element = renderDecisions([
      { scope: "preprocessing", decision: "keep" },
      {
        scope: "task_first_level",
        decision: "exclude",
        reason: "nonmonotonic timing",
      },
    ]);
    expect(element.textContent).toContain("preprocessing");
    expect(element.textContent).toContain("keep");
    expect(element.textContent).toContain("task_first_level");
    expect(element.textContent).toContain("exclude");
    expect(element.textContent).toContain("nonmonotonic timing");
  });
  it("shows missing records without marking processing complete", () => {
    const element = renderAttempts([]);
    expect(element.textContent).toContain("No processing attempts recorded");
    expect(element.textContent).not.toContain("complete");
  });
  it("renders evidence as text, not executable HTML", () => {
    const element = renderDecisions([
      {
        scope: "preprocessing",
        decision: "keep",
        notes: "<img src=x onerror=alert(1)>",
      },
    ]);
    expect(element.querySelector("img")).toBeNull();
  });
});
