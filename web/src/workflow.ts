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

export function stageDetail(data: Subject, active: Stage): HTMLElement {
  const stage = stages.find((s) => s.id === active)!;
  const panel = element("details", "", "stage-detail");
  const heading = element("summary", "", "stage-heading");
  heading.append(
    element("strong", `${stage.title}: stage details & processing records`),
    element(
      "span",
      active === "source" && acquisitionRecords(data).length
        ? "Inventory recorded"
        : stageStatus(active, data.attempts),
      "badge",
    ),
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
