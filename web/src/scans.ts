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
  toolbar.append(filter, queue);
  const count = element("p", `${scans.length} scans`, "muted");
  const scroll = element("div", "", "scan-table");
  const table = element("table");
  const head = element("thead");
  const heading = element("tr");
  for (const text of ["Scan", "TRs", "FD (mm)", "Disposition"])
    heading.append(element("th", text));
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
    const name = element("td");
    const button = element(
      "button",
      String(scan.task ?? scan.suffix),
      "scan-name",
    );
    button.onclick = () => {
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
    disposition.append(element("span", String(d?.decision ?? "Unrecorded")));
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
    row.append(
      name,
      element("td", String(m.tr_count ?? "—")),
      element("td", fd),
      disposition,
    );
    body.append(row);
    return {
      row,
      outcome,
      text: `${scanPrefix(scan)} ${m.flags ?? ""}`.toLowerCase(),
    };
  });
  const refresh = () => {
    for (const e of entries)
      e.row.hidden =
        !e.text.includes(filter.value.toLowerCase()) ||
        (queue.value !== "all" &&
          !e.outcome[queue.value as keyof typeof e.outcome]);
    count.textContent = `${entries.filter((e) => !e.row.hidden).length} of ${scans.length} scans`;
  };
  filter.oninput = refresh;
  queue.onchange = refresh;
  return panel;
}
