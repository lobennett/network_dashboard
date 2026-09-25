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
    expect(element.textContent).toContain("Preprocessing");
    expect(element.textContent).toContain("Keep");
    expect(element.textContent).toContain("First-level task models");
    expect(element.textContent).toContain("Exclude");
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
it("uses sentence case for labels while preserving metric acronyms and literal values", async () => {
  const {details}=await import("./review");
  const block=details({fd_mean:0.2,dvars_std:1.1,behavioral_status:"reviewed_exception",path:"sub-s03/ses-01/func"});
  expect(Array.from(block.querySelectorAll("dt")).map(n=>n.textContent)).toEqual(["Mean FD","Standardized DVARS","Behavioral status","Path"]);
  expect(block.textContent).toContain("Reviewed exception");
  expect(block.textContent).toContain("sub-s03/ses-01/func");
});
