import { element } from "./review";
import { openRecordedFile } from "./document";
import type { Stage } from "./pipeline";

type Check = {
  id: string;
  title: string;
  status: string;
  detail: string;
  stage: Stage;
  evidence: { id: string; path: string }[];
};
export type Completion = {
  subject: string;
  status: string;
  note: string;
  snapshot: Record<string, unknown>;
  checks: Check[];
};
const labels: Record<string, string> = {
  complete: "Recorded",
  running: "Running",
  pending: "Pending",
  review: "Manual review",
  failed: "Needs attention",
  unrecorded: "Not recorded",
};

export function completionChecklist(
  data: Completion,
  select: (stage: Stage) => void,
) {
  const panel = element("details", "", "completion-checklist");
  const completed = data.checks.filter((c) => c.status === "complete");
  const outstanding = data.checks.filter((c) => c.status !== "complete");
  const summary = element("summary");
  summary.append(
    element("strong", "Preprocessing checklist"),
    element(
      "span",
      `${completed.length}/${data.checks.length} recorded · ${outstanding.length} outstanding`,
    ),
  );
  panel.append(summary, element("p", data.note, "muted"));
  const download = element("button", "Download checklist (JSON)");
  download.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = element("a");
    link.href = url;
    link.download = `sub-${data.subject}_completion.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  panel.append(download);
  const list = (checks: Check[]) => {
    const items = element("ul", "", "completion-list");
    for (const check of checks) {
      const row = element("li");
      row.dataset.status = check.status;
      const text = element("div");
      text.append(
        element("strong", check.title),
        element("span", labels[check.status] ?? check.status, "badge"),
        element("p", check.detail),
      );
      const actions = element("div", "", "completion-actions");
      const inspect = element("button", "Inspect stage");
      inspect.onclick = () => select(check.stage);
      actions.append(inspect);
      if (check.evidence.length) {
        const evidence = element("details");
        evidence.append(
          element("summary", `Evidence (${check.evidence.length})`),
        );
        for (const file of check.evidence) {
          const button = element(
            "button",
            file.path.split("/").pop() ?? file.path,
            "evidence-link",
          );
          button.title = file.path;
          button.onclick = () => void openRecordedFile(file.id, file.path);
          evidence.append(button);
        }
        actions.append(evidence);
      }
      row.append(text, actions);
      items.append(row);
    }
    return items;
  };
  panel.append(list(outstanding));
  const done = element("details");
  done.append(
    element("summary", `Recorded checks (${completed.length})`),
    list(completed),
  );
  panel.append(done);
  return panel;
}
