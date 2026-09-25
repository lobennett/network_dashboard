import { element, type RecordRow } from "./review";
import {
  rawScans,
  scanOutcome,
  stageStatus,
  stages,
  type Subject,
  type Stage,
} from "./pipeline";

export function initialScan(data: Subject): RecordRow | undefined {
  const scans = rawScans(data);
  return (
    scans.find((s) => scanOutcome(data, s).pending) ??
    scans.find((s) => s.suffix === "bold") ??
    scans[0]
  );
}
export function subjectSummary(data: Subject): HTMLElement {
  const panel = element("div", "", "subject-summary");
  const outcomes = rawScans(data).map((s) => scanOutcome(data, s));
  const pending = outcomes.filter((o) => o.pending).length;
  const excluded = outcomes.filter((o) => o.analysisExcluded).length;
  for (const [label, value] of [
    ["fMRIPrep", stageStatus("fmriprep", data.attempts)],
    [
      "Scan review",
      pending ? `${pending} need review` : stageStatus("review", data.attempts),
    ],
    ["Surfaces", stageStatus("surfaces", data.attempts)],
    ["Task models", `${excluded} excluded run${excluded === 1 ? "" : "s"}`],
  ]) {
    const item = element("div");
    item.append(element("span", label), element("strong", value));
    panel.append(item);
  }
  return panel;
}
export function reviewControls(
  active: Stage,
  select: (stage: Stage) => void,
): HTMLElement {
  const panel = element("div", "", "review-controls");
  const modes = element("nav", "", "review-modes");
  modes.setAttribute("aria-label", "Review views");
  const mode =
    active === "source"
      ? "source"
      : active === "surfaces"
        ? "surfaces"
        : "scans";
  for (const [id, label, stage] of [
    ["scans", "Scans", "review"],
    ["surfaces", "Surfaces", "surfaces"],
    ["source", "Flywheel sources", "source"],
  ] as const) {
    const button = element("button", label);
    button.setAttribute("aria-pressed", String(mode === id));
    button.onclick = () => select(stage);
    modes.append(button);
  }
  panel.append(modes);
  if (mode === "scans") {
    const label = element("label", "Inspect stage");
    const chooser = element("select");
    chooser.setAttribute("aria-label", "Inspect stage");
    for (const stage of stages.filter(
      (s) => !["source", "surfaces"].includes(s.id),
    )) {
      const option = element(
        "option",
        stage.id === "review" ? "Scan decisions" : stage.title,
      );
      option.value = stage.id;
      option.selected = stage.id === active;
      chooser.append(option);
    }
    chooser.onchange = () => select(chooser.value as Stage);
    label.append(chooser);
    panel.append(label);
  }
  return panel;
}
