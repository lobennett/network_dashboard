import { element, details, type RecordRow } from "./review";
import { type Subject } from "./pipeline";
export function acquisitionRecords(data: Subject): RecordRow[] {
  return data.findings
    .filter((f) => f.finding_type === "flywheel-acquisition")
    .map((f) => JSON.parse(String(f.evidence_json)));
}
export function flywheelInventory(
  data: Subject,
  select: (prefix: string) => void,
): HTMLElement {
  const rows = acquisitionRecords(data);
  const panel = element("section", "", "flywheel-inventory");
  if (!rows.length) {
    panel.append(
      element(
        "p",
        "No acquisition inventory is recorded. Pre-conversion exclusions are unknown.",
        "gap",
      ),
    );
    return panel;
  }
  const captured = rows[0].captured_at;
  const historical = rows.every(
    (r) => r.snapshot_kind === "conversion_selection",
  );
  panel.append(
    element(
      "p",
      historical
        ? `Selection recorded during conversion · ${captured}`
        : `Current Flywheel inventory · ${captured}. This audit does not establish what was selected in the earlier conversion.`,
      "gap",
    ),
  );
  const counts = element(
    "p",
    `${rows.filter((r) => r.decision === "selected").length} selected / ${rows.filter((r) => r.decision === "skipped").length} skipped acquisitions`,
  );
  const filter = element("select");
  filter.setAttribute("aria-label", "Flywheel acquisition filter");
  for (const [value, label] of [
    ["all", "All acquisitions"],
    ["selected", "Selected for BIDS"],
    ["qa-reject", "QA rejected"],
    ["skipped", "All skipped"],
  ]) {
    const option = element("option", label);
    option.value = value;
    filter.append(option);
  }
  const scroll = element("div", "", "scan-table");
  const table = element("table");
  const head = element("thead"),
    heading = element("tr");
  for (const label of [
    "Session",
    "Acquisition",
    "Selection / reason",
    "Destination",
  ])
    heading.append(element("th", label));
  head.append(heading);
  const body = element("tbody");
  table.append(head, body);
  scroll.append(table);
  panel.append(counts, filter, scroll);
  const render = () => {
    body.replaceChildren();
    for (const row of rows.filter(
      (r) =>
        filter.value === "all" ||
        r.decision === filter.value ||
        r.reason === filter.value,
    )) {
      const tr = element("tr"),
        name = element("td"),
        record = element("details");
      record.append(element("summary", String(row.label)), details(row));
      name.append(record);
      const destination = element("td");
      if (row.bids_prefix) {
        const button = element("button", "Find BIDS scan");
        button.title = String(row.bids_prefix);
        button.onclick = () => select(String(row.bids_prefix));
        destination.append(button);
      } else destination.textContent = "No BIDS output planned";
      tr.append(
        element("td", String(row.session)),
        name,
        element(
          "td",
          `${row.decision}: ${String(row.reason).replaceAll("_", " ")}`,
        ),
        destination,
      );
      body.append(tr);
    }
  };
  filter.onchange = render;
  render();
  return panel;
}
