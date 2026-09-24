export type RecordRow = Record<string, unknown>;

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

export function details(row: RecordRow): HTMLElement {
  const block = element("dl", "", "record");
  for (const [key, value] of Object.entries(row)) {
    if (value == null || value === "") continue;
    block.append(
      element("dt", key.replaceAll("_", " ")),
      element(
        "dd",
        typeof value === "object"
          ? JSON.stringify(value, null, 2)
          : String(value),
      ),
    );
  }
  return block;
}

export function renderDecisions(rows: RecordRow[]): HTMLElement {
  const panel = element("div");
  if (!rows.length)
    panel.append(element("p", "No review decisions recorded.", "empty"));
  for (const row of rows) {
    const card = element("article", "", "decision");
    card.append(
      element("span", String(row.decision ?? "Review pending"), "badge"),
      element("h3", String(row.scope)),
      details(row),
    );
    panel.append(card);
  }
  return panel;
}

export function renderAttempts(rows: RecordRow[]): HTMLElement {
  const panel = element("div", "", "attempts");
  if (!rows.length)
    panel.append(element("p", "No processing attempts recorded.", "empty"));
  for (const row of rows) {
    const item = element("details", "", "attempt");
    const heading = element("summary");
    heading.append(
      element("span", String(row.stage)),
      element("span", String(row.state), "badge"),
    );
    item.append(heading, details(row));
    panel.append(item);
  }
  return panel;
}
