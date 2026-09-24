import "./styles.css";
import { get } from "./api";
import { element, type RecordRow } from "./review";
import { renderScans } from "./scans";
import { workflow, stageDetail } from "./workflow";
import { rawScans, scanOutcome, type Subject, type Stage } from "./pipeline";
import { ScanInspector } from "./inspector";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<header><div><strong>Network</strong><span>Pipeline review</span></div><span id="freshness" role="status">Loading snapshot…</span></header>
<div class="workspace"><aside><h2>Subjects</h2><nav id="subjects" aria-label="Subjects"></nav><p class="aside-note">Read-only review<br>Recorded in DataLad</p></aside>
<main><div id="notice" role="alert"></div><div class="subject-heading"><h1 id="subject-title">Select a subject</h1><span class="muted">Acquisition to derivatives</span></div>
<div id="workflow"></div><div id="stage-detail"></div>
<section class="review-workspace" aria-label="Scan review"><div class="scan-section"><div class="scan-section-heading"><h2>Scans</h2><span id="scan-counts" class="muted"></span></div><div id="scan-list"></div></div><article id="inspector" aria-label="Selected scan"></article></section>
</main></div>`;
const find = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const inspector = new ScanInspector(find("inspector"));
let active: Stage = "review",
  data: Subject | undefined,
  selectedScan: RecordRow | undefined,
  request = 0;
function chooseStage(stage: Stage) {
  active = stage;
  if (!data) return;
  find("workflow").replaceChildren(workflow(data, stage, chooseStage));
  find("stage-detail").replaceChildren(stageDetail(data, stage));
  document
    .querySelector(".review-workspace")!
    .classList.toggle("subject-outputs", stage === "surfaces");
  const selection =
    stage === "surfaces" ? data.entities.find((e) => e.subject) : selectedScan;
  if (selection) void inspector.show(data, selection, stage);
  else inspector.clear();
}
async function chooseSubject(subject: string) {
  const current = ++request;
  data = undefined;
  selectedScan = undefined;
  inspector.clear();
  for (const id of ["workflow", "stage-detail", "scan-list"])
    find(id).replaceChildren(element("p", "Loading…", "muted"));
  find("subject-title").textContent = `sub-${subject}`;
  find("scan-counts").textContent = "";
  find("notice").textContent = "";
  document
    .querySelectorAll<HTMLButtonElement>("#subjects button")
    .forEach((b) =>
      b.setAttribute("aria-current", String(b.dataset.subject === subject)),
    );
  try {
    const value = await get<Subject>(`subjects/${encodeURIComponent(subject)}`);
    if (current !== request) return;
    data = value;
    const outcomes = rawScans(data).map((scan) => scanOutcome(value, scan));
    find("scan-counts").textContent =
      `${outcomes.filter((o) => o.pending).length} need review / ${outcomes.filter((o) => o.flagged).length} flagged`;
    find("scan-list").replaceChildren(
      renderScans(data, (scan) => {
        selectedScan = scan;
        void inspector.show(value, scan, active);
      }),
    );
    chooseStage(active);
  } catch (error) {
    if (current === request) find("notice").textContent = String(error);
  }
}
async function start() {
  try {
    const [metadata, subjects] = await Promise.all([
      get<RecordRow>("metadata"),
      get<{ subject: string }[]>("subjects"),
    ]);
    const update = () => {
      const built = Date.parse(String(metadata.built_at ?? "")),
        valid = Number.isFinite(built);
      const old = metadata.stale || !valid || Date.now() - built > 900_000;
      find("freshness").textContent =
        `${metadata.data_mode === "synthetic" ? "Synthetic / " : ""}${old ? "Snapshot (not live)" : "Snapshot"}: ${valid ? new Date(built).toLocaleString() : "time unknown"}`;
    };
    update();
    window.setInterval(update, 60_000);
    for (const { subject } of subjects) {
      const button = element("button", `sub-${subject}`);
      button.dataset.subject = subject;
      button.onclick = () => void chooseSubject(subject);
      find("subjects").append(button);
    }
    if (subjects.length) await chooseSubject(subjects[0].subject);
    else
      find("notice").textContent =
        "No subjects indexed. Build records from the canonical study first.";
  } catch (error) {
    find("notice").textContent = `Cannot load the study: ${error}`;
    find("freshness").textContent = "Index unavailable";
  }
}
void start();
