import { element, type RecordRow } from "./review";
import {
  rawScans,
  reviewMetrics,
  scanOutcome,
  type Subject,
  humanize,
} from "./pipeline";
type ScanData = Pick<Subject, "entities" | "findings" | "decisions">;
export function scanPrefix(scan: RecordRow): string {
  return [
    ["sub", scan.subject],
    ["ses", scan.session],
    ["task", scan.task],
    ["acq", scan.acquisition],
    ["run", scan.run],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}-${value}`)
    .join("_");
}
export function renderScans(
  data: ScanData,
  select: (scan: RecordRow) => void,
  selected?: RecordRow,
): HTMLElement {
  const panel = element("div", "", "scan-browser");
  const scans = rawScans(data).sort((a, b) =>
    scanPrefix(a).localeCompare(scanPrefix(b), undefined, { numeric: true }),
  );
  const toolbar = element("div", "", "scan-toolbar");
  const filter = element("input");
  filter.placeholder = "Find session or task";
  filter.setAttribute("aria-label", "Find scans");
  const queue = element("select");
  queue.setAttribute("aria-label", "Scan review filter");
  for (const [value, label] of [
    ["all", "All scans"],
    ["pending", "Needs review"],
    ["flagged", "Flagged (including reviewed)"],
    ["dropped", "Excluded from preprocessing"],
    ["analysisExcluded", "Excluded from task models"],
  ]) {
    const option = element("option", label);
    option.value = value;
    queue.append(option);
  }
  const kind = element("select");
  kind.setAttribute("aria-label", "Scan type");
  for (const [value, label] of [
    ["bold", "Functional"],
    ["anatomy", "Anatomy"],
    ["fmap", "Fieldmaps"],
    ["all", "All types"],
  ]) {
    const option = element("option", label);
    option.value = value;
    kind.append(option);
  }
  kind.value = selected
    ? selected.suffix === "bold"
      ? "bold"
      : ["T1w", "T2w"].includes(String(selected.suffix))
        ? "anatomy"
        : "fmap"
    : "all";
  toolbar.append(filter, kind, queue);
  const count = element("p", `${scans.length} scans`, "muted");
  const scroll = element("div", "", "scan-table");
  const table = element("table");
  const head = element("thead");
  const heading = element("tr");
  for (const text of ["Scan", "Use"]) heading.append(element("th", text));
  head.append(heading);
  const body = element("tbody");
  table.append(head, body);
  scroll.append(table);
  panel.append(toolbar, count, scroll);
  const entries = scans.map((scan) => {
    const m = reviewMetrics(data, scan),
      outcome = scanOutcome(data, scan);
    const d = data.decisions.find(
      (d) => d.entity_key === scan.entity_key && d.scope === "preprocessing",
    );
    const row = element("tr");
    row.classList.toggle("selected", scan.entity_key === selected?.entity_key);
    const name = element("td");
    const button = element(
      "button",
      String(scan.task ?? scan.suffix),
      "scan-name",
    );
    button.setAttribute(
      "aria-pressed",
      String(scan.entity_key === selected?.entity_key),
    );
    button.onclick = () => {
      body
        .querySelectorAll("button")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      body
        .querySelectorAll("tr")
        .forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      select(scan);
    };
    name.append(
      element("small", `ses-${scan.session ?? "?"} / run-${scan.run ?? "—"}`),
      button,
    );
    const fd =
      m.fd_mean !== undefined &&
      m.fd_mean !== "" &&
      Number.isFinite(Number(m.fd_mean))
        ? Number(m.fd_mean).toFixed(3)
        : "—";
    const disposition = element("td");
    disposition.append(
      element(
        "span",
        d?.decision === "keep"
          ? "Keep for processing"
          : d?.decision === "review"
            ? "Review needed"
            : String(d?.decision ?? "Not reviewed"),
      ),
    );
    if (outcome.flagged)
      disposition.append(
        element(
          "small",
          outcome.pending
            ? "Review required"
            : m.approved === "yes"
              ? "Flag reviewed"
              : "Flag recorded",
          "flag-text",
        ),
      );
    if (outcome.analysisExcluded)
      disposition.append(element("small", "Task models: exclude", "excluded"));
    disposition.title = humanize(m.flags ?? "");
    if (m.tr_count)
      name.append(element("small", `${m.tr_count} volumes · FD ${fd} mm`));
    row.append(name, disposition);
    body.append(row);
    return {
      row,
      scan,
      outcome,
      text: `${scanPrefix(scan)} ${m.flags ?? ""}`.toLowerCase(),
    };
  });
  const empty = element("div", "", "empty");
  empty.append(element("p", "No scans match these filters."));
  const reset = element("button", "Clear filters");
  empty.append(reset);
  panel.append(empty);
  const refresh = () => {
    for (const e of entries)
      e.row.hidden =
        !e.text.includes(filter.value.toLowerCase()) ||
        (kind.value === "bold" && e.scan.suffix !== "bold") ||
        (kind.value === "anatomy" &&
          !["T1w", "T2w"].includes(String(e.scan.suffix))) ||
        (kind.value === "fmap" &&
          !["fieldmap", "magnitude"].includes(String(e.scan.suffix))) ||
        (queue.value !== "all" &&
          !e.outcome[queue.value as keyof typeof e.outcome]);
    const shown = entries.filter((e) => !e.row.hidden).length;
    count.textContent = `${shown} of ${scans.length} scans`;
    empty.hidden = shown > 0;
    scroll.hidden = shown === 0;
  };
  reset.onclick = () => {
    filter.value = "";
    kind.value = "all";
    queue.value = "all";
    refresh();
  };
  kind.onchange = refresh;
  filter.oninput = refresh;
  queue.onchange = refresh;
  refresh();
  return panel;
}
