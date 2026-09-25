import { get, apiUrl } from "./api";
import { element, details, type RecordRow } from "./review";
import { behaviorSummary, type BehaviorSummary } from "./task-preview";
export type CoverageScan = RecordRow & {
  subject: string;
  prefix: string;
  status: string;
  missing_files: string[];
  events_status: string;
  behavior_status: string;
  task_first_level: string;
  events: { id: string; path: string }[];
  designs: { id: string; path: string }[];
  behavior_files?: { id: string; path: string }[];
  truncation: RecordRow;
};
export type Coverage = {
  subjects: string[];
  scans: CoverageScan[];
  basis: string;
  inventory_note: string;
  skipped_acquisitions: number;
  behavior_sources?: {
    id: string;
    path: string;
    setting: string;
    subject: string;
  }[];
};
const issue = (s: CoverageScan) =>
  s.status !== "Scan files indexed" ||
  s.events_status.startsWith("Missing") ||
  s.behavior_status === "Unrecorded" ||
  s.task_first_level === "Excluded";
function fileLink(file: { id: string; path: string }) {
  const link = element(
    "a",
    file.path.split("/").pop() ?? file.path,
    "file-path",
  );
  link.href = apiUrl(`artifacts/${file.id}/content`);
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}
export function renderCoverage(
  data: Coverage,
  select: (scan: CoverageScan, analysis: boolean) => void,
) {
  const panel = element("section", "", "coverage-page");
  panel.append(
    element("h1", "Data completeness & analysis inputs"),
    element("p", data.basis, "muted"),
  );
  panel.append(
    element(
      "p",
      `${data.subjects.length} indexed subject(s) · ${data.scans.filter((s) => s.status === "Missing scan files").length} scans with missing files · ${data.scans.filter((s) => s.events_status.startsWith("Missing")).length} runs without events · ${data.skipped_acquisitions} recorded source exclusions`,
    ),
  );
  const controls = element("div", "", "coverage-controls");
  const subject = element("select");
  subject.setAttribute("aria-label", "Coverage subject");
  for (const value of ["All subjects", ...data.subjects]) {
    const option = element(
      "option",
      value === "All subjects" ? value : `sub-${value}`,
    );
    option.value = value;
    subject.append(option);
  }
  const view = element("select");
  view.setAttribute("aria-label", "Coverage view");
  for (const value of ["Scan files", "Behavior", "First-level inputs"])
    view.append(element("option", value));
  const filter = element("input");
  filter.placeholder = "Find subject, session or task";
  filter.setAttribute("aria-label", "Find missing files or runs");
  const only = element("input");
  only.type = "checkbox";
  const onlyLabel = element("label", "Show gaps and exclusions only ");
  onlyLabel.append(only);
  const download = element("button", "Download inventory (TSV)");
  download.onclick = () => {
    const fields = [
      "subject",
      "session",
      "task",
      "run",
      "suffix",
      "status",
      "missing_files",
      "behavior_status",
      "events_status",
      "task_first_level",
      "exclusion_reason",
    ];
    const cell = (x: unknown) =>
      `"${String(Array.isArray(x) ? x.join("; ") : (x ?? "")).replaceAll('"', '""')}"`;
    const content = [
      fields.join("\t"),
      ...data.scans.map((s) => fields.map((f) => cell(s[f])).join("\t")),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/tab-separated-values" }),
    );
    const link = element("a");
    link.href = url;
    link.download = "network-data-inventory.tsv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  controls.append(subject, view, filter, onlyLabel, download);
  const scroll = element("div", "", "scan-table coverage-table");
  const evidence = element("section", "", "coverage-evidence");
  panel.append(
    controls,
    evidence,
    scroll,
    element("p", data.inventory_note, "muted"),
  );
  let metricRequest = 0;
  const render = () => {
    metricRequest++;
    evidence.replaceChildren();
    const table = element("table"),
      head = element("thead"),
      header = element("tr"),
      body = element("tbody");
    const mode = view.value;
    for (const title of mode === "Scan files"
      ? ["Subject / scan", "Scan files", "Behavior / events", "Inspect"]
      : mode === "Behavior"
        ? [
            "Subject / scan",
            "Behavior / events",
            "Timing and exclusions",
            "Inspect",
          ]
        : ["Subject / scan", "Task-model use", "Saved design", "Inspect"])
      header.append(element("th", title));
    head.append(header);
    table.append(head, body);
    scroll.replaceChildren(table);
    const selected = data.scans.filter(
      (s) =>
        (subject.value === "All subjects" || s.subject === subject.value) &&
        (!only.checked || issue(s)) &&
        `${s.prefix} ${s.suffix}`
          .toLowerCase()
          .includes(filter.value.toLowerCase()) &&
        (mode === "Scan files" || (s.suffix === "bold" && s.task !== "rest")),
    );
    for (const scan of selected) {
      const row = element("tr"),
        name = element("td");
      name.append(
        element("strong", `sub-${scan.subject} · ses-${scan.session ?? "—"}`),
        element("div", `${scan.task ?? scan.suffix} · run-${scan.run ?? "—"}`),
      );
      const state = element("td"),
        extra = element("td"),
        actions = element("td");
      const status = element(
        "strong",
        mode === "Scan files"
          ? scan.status
          : mode === "Behavior"
            ? scan.behavior_status
            : scan.task_first_level,
      );
      state.append(status);
      if (mode === "Scan files") {
        if (scan.missing_files.length) {
          const list = element("details");
          list.append(
            element(
              "summary",
              `${scan.missing_files.length} expected files absent`,
            ),
          );
          for (const path of scan.missing_files)
            list.append(element("div", path, "file-path"));
          state.append(list);
        }
        extra.append(
          element("div", `Behavior: ${scan.behavior_status}`),
          element("div", `Events: ${scan.events_status}`),
        );
      } else if (mode === "Behavior") {
        state.append(element("div", `Events: ${scan.events_status}`));
        for (const file of scan.behavior_files ?? [])
          state.append(fileLink(file));
        if (Object.keys(scan.truncation).length) {
          const timing = element("details");
          timing.append(element("summary", `${scan.truncation.NTestTrialsRetained ?? "—"}/${scan.truncation.NTestTrialsExpected ?? "—"} trials after timing correction`), details(scan.truncation));
          extra.append(timing);
        }
        extra.append(
          element(
            "p",
            `${scan.task_first_level}${scan.exclusion_reason ? `: ${scan.exclusion_reason}` : ""}`,
          ),
        );
      } else {
        state.append(
          element(
            "div",
            String(
              scan.exclusion_reason ??
                "No recorded exclusion is not approval for a model.",
            ),
          ),
        );
        extra.append(
          element(
            "div",
            scan.designs.length
              ? `${scan.designs.length} saved design(s)`
              : "No saved design indexed",
          ),
          element("div", `Events: ${scan.events_status}`),
        );
      }
      const inspect = element(
        "button",
        mode === "Scan files" ? "Inspect scan" : "Events & design",
      );
      inspect.onclick = () => select(scan, mode !== "Scan files");
      actions.append(inspect);
      if (mode === "Behavior" && scan.events.length) {
        const metrics = element("button", "Behavior metrics");
        metrics.onclick = async () => {
          const request = ++metricRequest;
          evidence.replaceChildren(
            element("p", "Loading verified event metrics…"),
          );
          try {
            const result = await get<{ behavior: BehaviorSummary }>(
              `artifacts/${scan.events[0].id}/table`,
            );
            if (request !== metricRequest) return;
            evidence.replaceChildren(
              element("h2", `${scan.prefix.split("/").pop()} · Behavior`),
              behaviorSummary(result.behavior),
            );
            evidence.scrollIntoView({ block: "nearest" });
          } catch (error) {
            if (request === metricRequest)
              evidence.replaceChildren(element("p", String(error), "gap"));
          }
        };
        actions.append(metrics);
      }
      row.append(name, state, extra, actions);
      body.append(row);
    }
    if (!selected.length)
      scroll.append(element("p", "No runs match these filters.", "empty"));
    if (mode === "Behavior") {
      const outside = (data.behavior_sources ?? []).filter(
        (f) =>
          f.setting === "out_of_scanner" &&
          (subject.value === "All subjects" || f.subject === subject.value),
      );
      const group = element("details");
      group.append(
        element("summary", `Out-of-scanner source files (${outside.length})`),
      );
      group.append(
        element(
          "p",
          "Only files with the same subject ID are listed; no participant remapping is inferred. These files are not expected to have matching BOLD scans. In-scanner metrics above describe canonical events after timing corrections.",
        ),
      );
      for (const file of outside) {
        const item = element("div");
        item.append(fileLink(file));
        group.append(item);
      }
      scroll.append(group);
    }
    if (mode === "First-level inputs")
      scroll.prepend(
        element(
          "p",
          "Model review is downstream of preprocessing. Save the design matrix, model specification, contrasts, confound/censoring choices and software versions with analysis derivatives. This view does not fit a model or trim data again.",
          "muted",
        ),
      );
  };
  subject.onchange = render;
  view.onchange = render;
  filter.oninput = render;
  only.onchange = render;
  render();
  return panel;
}
