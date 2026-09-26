import { get, apiUrl } from "./api";
import { element } from "./review";

export type BehaviorSummary = {
  test_trials: number;
  accuracy_denominator: number;
  choice_accuracy: number | null;
  response_time_denominator: number;
  median_response_time_s: number | null;
  no_keypress_trials: number;
  omissions?: number | null;
  basis: string;
  by_condition: Record<string, Omit<BehaviorSummary, "basis" | "by_condition">>;
};
export const omissionLabel = (path: string) =>
  /(?:^|_)task-(?:goNogo|stopSignal)[^_]*_/i.test(path.split("/").pop() ?? path)
    ? "Go omissions" : "Omissions";

export function behaviorSummary(metrics: BehaviorSummary, path: string): HTMLElement {
  const panel = element("section", "", "behavior-summary");
  panel.append(
    element("h3", "Behavioral metrics"),
    element("p", metrics.basis, "muted"),
  );
  if (!metrics.test_trials) {
    panel.append(
      element(
        "p",
        "No test_trial rows are recorded; behavioral metrics are unavailable.",
      ),
    );
    return panel;
  }
  const table = element("table"),
    head = element("thead"),
    row = element("tr"),
    body = element("tbody");
  for (const title of [
    "Condition",
    "Test trials",
    "Recorded accuracy",
    "Median response time",
    "No keypress",
    omissionLabel(path),
  ])
    row.append(element("th", title));
  head.append(row);
  table.append(head, body);
  for (const [name, m] of [
    ["All test trials", metrics],
    ...Object.entries(metrics.by_condition),
  ] as const) {
    const tr = element("tr");
    for (const value of [
      name,
      String(m.test_trials),
      m.choice_accuracy === null
        ? "Unavailable"
        : `${(m.choice_accuracy * 100).toFixed(1)}% (n=${m.accuracy_denominator})`,
      m.median_response_time_s === null
        ? "Unavailable"
        : `${m.median_response_time_s.toFixed(3)} s (n=${m.response_time_denominator})`,
      String(m.no_keypress_trials),
      m.omissions == null ? "Unavailable" : String(m.omissions),
    ])
      tr.append(element("td", value));
    body.append(tr);
  }
  const scroll = element("div", "", "scan-table");
  scroll.append(table);
  panel.append(scroll);
  return panel;
}

type Table = {
  kind: string;
  columns: string[];
  rows: Record<string, string>[];
  total_rows: number;
  total_columns: number;
  truncated: boolean;
  nonmonotonic_pairs: number | null;
  behavior?: BehaviorSummary;
};
type File = {
  id: string;
  path: string;
  dataset_id: string;
  content_id: string;
};
export const isTaskTable = (path: string) =>
  /_events\.tsv$/i.test(path) ||
  /(?:designmatrix|design_matrix|design-matrix).*\.(csv|tsv)$/i.test(path);
const number = (value: string | undefined) =>
  value?.trim() && Number.isFinite(Number(value)) ? Number(value) : NaN;
const svgNS = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}
function eventTimeline(table: Table): HTMLElement {
  const panel = element("section");
  const filter = element("select");
  filter.setAttribute("aria-label", "Event rows");
  const types = [
    "All rows",
    ...new Set(table.rows.map((r) => r.trial_id).filter(Boolean)),
  ];
  for (const type of types) {
    const option = element("option", type);
    option.value = type;
    filter.append(option);
  }
  const chart = element("div", "", "event-chart");
  const count = element("p", "", "muted");
  const draw = () => {
    const rows = table.rows.filter(
      (r) => filter.value === "All rows" || r.trial_id === filter.value,
    );
    const valid = rows.filter(
      (r) =>
        Number.isFinite(number(r.onset)) &&
        Number.isFinite(number(r.duration)) &&
        number(r.duration) >= 0,
    );
    const groups = [...new Set(valid.map((r) => r.trial_type || "event"))];
    const min = Math.min(0, ...valid.map((r) => number(r.onset)));
    const max = Math.max(
      1,
      ...valid.map((r) => number(r.onset) + number(r.duration)),
    );
    const width = 850,
      left = 180,
      plot = 650,
      height = groups.length * 36 + 45;
    const picture = svg("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": "Event onsets and durations by trial type",
    });
    groups.forEach((group, i) => {
      const label = svg("text", { x: 0, y: i * 36 + 24 });
      label.textContent = group;
      picture.append(label);
      const line = svg("line", {
        x1: left,
        x2: left + plot,
        y1: i * 36 + 20,
        y2: i * 36 + 20,
        stroke: "#ddd",
      });
      picture.append(line);
    });
    valid.forEach((r) => {
      const lane = groups.indexOf(r.trial_type || "event");
      const mark = svg("rect", {
        x: left + ((number(r.onset) - min) / (max - min)) * plot,
        y: lane * 36 + 10,
        width: Math.max(2, (number(r.duration) / (max - min)) * plot),
        height: 20,
        fill: "#8c1515",
      });
      const title = svg("title", {});
      title.textContent = Object.entries(r)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      mark.append(title);
      picture.append(mark);
    });
    for (let i = 0; i <= 4; i++) {
      const text = svg("text", {
        x: left + (plot * i) / 4,
        y: height - 5,
        "text-anchor": i === 4 ? "end" : "start",
      });
      text.textContent = `${(min + ((max - min) * i) / 4).toFixed(1)} s`;
      picture.append(text);
    }
    chart.replaceChildren(picture);
    count.textContent = `${rows.length} rows selected · ${valid.length} plotted. Hover over a mark for its recorded values.`;
  };
  filter.onchange = draw;
  panel.append(filter, count, chart);
  draw();
  return panel;
}
function designChart(table: Table): HTMLElement {
  const panel = element("section"),
    select = element("select");
  select.setAttribute("aria-label", "Design regressor");
  const columns = table.columns.filter((k) =>
    table.rows.some((r) => Number.isFinite(number(r[k]))),
  );
  const chart = element("div", "", "event-chart");
  columns.forEach((k) => {
    const option = element("option", k || "(unnamed index)");
    option.value = k;
    select.append(option);
  });
  const draw = () => {
    const values = table.rows.map((r) => number(r[select.value]));
    const finite = values.filter(Number.isFinite);
    if (!finite.length) {
      chart.replaceChildren(element("p", "No numeric values in this column."));
      return;
    }
    const min = Math.min(0, ...finite),
      max = Math.max(0, ...finite),
      range = max - min || 1;
    const picture = svg("svg", {
      viewBox: "0 0 850 220",
      role: "img",
      "aria-label": `${select.value}: regressor values by row`,
    });
    // Separate segments at missing values rather than drawing across them.
    let points: string[] = [];
    const flush = () => {
      if (points.length)
        picture.append(
          svg("polyline", {
            points: points.join(" "),
            fill: "none",
            stroke: "#8c1515",
            "stroke-width": 1.5,
          }),
        );
      points = [];
    };
    values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        flush();
        return;
      }
      points.push(
        `${45 + (i / Math.max(1, values.length - 1)) * 785},${185 - ((v - min) / range) * 165}`,
      );
    });
    flush();
    for (const [y, v] of [
      [20, max],
      [185, min],
    ]) {
      const label = svg("text", { x: 0, y });
      label.textContent = v.toFixed(2);
      picture.append(label);
    }
    const axis = svg("text", { x: 45, y: 215 });
    axis.textContent = `Saved matrix rows 1–${values.length}; values shown without rescaling or HRF changes`;
    picture.append(axis);
    chart.replaceChildren(picture);
  };
  panel.append(
    element(
      "p",
      `${table.total_rows} rows × ${table.total_columns} columns. Choose a regressor to inspect its saved values.`,
      "muted",
    ),
    select,
    chart,
  );
  select.onchange = draw;
  draw();
  return panel;
}
export async function taskPreview(
  host: HTMLElement,
  query: string,
  active: () => boolean,
) {
  host.replaceChildren(
    element("p", "Loading event and design files…", "muted"),
  );
  try {
    const all = await get<File[]>(`artifacts?${query}&limit=1000`);
    if (!active()) return;
    const files = all.filter((f) => isTaskTable(f.path));
    const select = element("select");
    select.setAttribute("aria-label", "Event or saved design file");
    const display = element("div");
    files.forEach((f, i) => {
      const option = element(
        "option",
        `${f.path.split("/").pop()} · ${f.dataset_id.slice(0, 8)} · ${f.content_id.slice(-8)}`,
      );
      option.value = String(i);
      select.append(option);
    });
    host.replaceChildren(
      element(
        "p",
        "Recorded event timing and saved designs. This viewer does not generate a model or shift onsets.",
        "muted",
      ),
    );
    if (!files.some((f) => !f.path.endsWith("_events.tsv")))
      host.append(
        element(
          "p",
          "No saved design matrix is indexed for this scan. Models depend on the analysis; save the matrix and its model specification with your analysis outputs.",
          "muted",
        ),
      );
    if (!files.length) {
      host.append(
        element(
          "p",
          "No event table is indexed. Rest scans do not normally have task events.",
          "empty",
        ),
      );
      return;
    }
    host.append(select, display);
    let request = 0;
    const load = async () => {
      const current = ++request,
        file = files[Number(select.value)];
      display.replaceChildren(
        element("p", "Fetching and verifying the recorded table…", "muted"),
      );
      try {
        const table = await get<Table>(`artifacts/${file.id}/table`);
        if (!active() || current !== request) return;
        display.replaceChildren(element("p", file.path, "file-path"));
        const download = element("a", "Download recorded file");
        download.href = apiUrl(`artifacts/${file.id}/content`);
        download.target = "_blank";
        download.rel = "noopener";
        display.append(download);
        if (table.behavior) display.append(behaviorSummary(table.behavior, file.path));
        if (table.truncated)
          display.append(
            element(
              "p",
              `Preview limited to ${table.rows.length} rows and ${table.columns.length} columns; download the full table.`,
              "gap",
            ),
          );
        if (table.nonmonotonic_pairs)
          display.append(
            element(
              "p",
              `${table.nonmonotonic_pairs} backward onset transitions in file order. This is a review prompt; consult the recorded timing decision.`,
              "gap",
            ),
          );
        display.append(
          table.kind === "events" ? eventTimeline(table) : designChart(table),
        );
      } catch (error) {
        if (active() && current === request)
          display.replaceChildren(element("p", String(error), "gap"));
      }
    };
    select.onchange = () => void load();
    await load();
  } catch (error) {
    if (active()) host.replaceChildren(element("p", String(error), "gap"));
  }
}
