import { acquisitionRecords } from "./flywheel";
import { element, details } from "./review";
import {
  stages,
  stageFor,
  stageStatus,
  humanize,
  type Subject,
  type Stage,
} from "./pipeline";

export function workflow(
  data: Subject,
  active: Stage,
  select: (stage: Stage) => void,
): HTMLElement {
  const diagram = element("nav", "", "pipeline");
  diagram.setAttribute("aria-label", "Pipeline stages");
  stages.forEach((stage, index) => {
    const button = element("button", "", "stage");
    button.setAttribute("aria-pressed", String(stage.id === active));
    const status =
      stage.id === "source" && acquisitionRecords(data).length
        ? "Inventory recorded"
        : stageStatus(stage.id, data.attempts);
    button.append(
      element("span", String(index + 1).padStart(2, "0"), "step-number"),
      element("strong", stage.title),
      element("small", stage.caption),
      element("span", status, `stage-status ${status.toLowerCase()}`),
    );
    button.onclick = () => select(stage.id);
    diagram.append(button);
  });
  return diagram;
}
export function stageDetail(data: Subject, active: Stage): HTMLElement {
  const stage = stages.find((s) => s.id === active)!;
  const panel = element("section", "", "stage-detail");
  const heading = element("div", "", "stage-heading");
  heading.append(
    element("h2", stage.title),
    element("span", active === "source" && acquisitionRecords(data).length ? "Inventory recorded" : stageStatus(active, data.attempts), "badge"),
  );
  panel.append(heading, element("p", stage.description));
  const rows = data.attempts.filter(
    (a) => stageFor(String(a.stage)) === active,
  );
  const evidence = element("details", "", "stage-evidence");
  evidence.append(
    element("summary", `${rows.length} recorded milestones / jobs`),
  );
  for (const row of rows) {
    const item = element("details", "", "attempt");
    item.append(
      element(
        "summary",
        `${humanize(row.stage)}: ${humanize(row.state)}${row.scope === "dataset" ? " (dataset milestone)" : ""}`,
      ),
      details(row),
    );
    evidence.append(item);
  }
  panel.append(evidence);
  if (active === "surfaces") {
    const legacy = data.attempts.filter(
      (a) => stageFor(String(a.stage)) === "legacy",
    );
    if (legacy.length) {
      const block = element("details", "", "legacy");
      block.append(
        element(
          "summary",
          "Legacy anatomical processing (separate from FreeSurfer 8)",
        ),
      );
      for (const row of legacy) block.append(details(row));
      panel.append(block);
    }
  }
  return panel;
}
