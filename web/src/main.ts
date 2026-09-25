import "./styles.css";
import "./layout.css";
import { get, apiUrl } from "./api";
import { element, type RecordRow } from "./review";
import { renderScans, scanForDestination } from "./scans";
import { flywheelInventory } from "./flywheel";
import { stageDetail } from "./workflow";
import { rawScans, scanOutcome, type Subject, type Stage } from "./pipeline";
import { ScanInspector } from "./inspector";
import { initialScan, subjectSummary, reviewControls } from "./review-layout";
import { pipelineGuide } from "./pipeline-guide";
import { renderCoverage, type Coverage, type CoverageScan } from "./coverage";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<a class="skip-link" href="#review-page">Skip to content</a>
<header><a class="brand" href="#review">Network<span>Data review</span></a><nav class="page-nav" aria-label="Pages"><a href="#review">Review data</a><a href="#coverage">Data completeness</a><a href="#pipeline">Pipeline guide</a></nav><span id="freshness" role="status">Snapshot not loaded</span></header>
<div class="workspace" id="review-page"><aside><h2>Subjects</h2><nav id="subjects" aria-label="Subjects"></nav><p class="aside-note">Read-only review<br>Recorded in DataLad</p><a class="aside-help" href="/connect.html">Connection help</a></aside>
<main><div id="notice" role="alert"></div><div class="subject-heading"><div><h1 id="subject-title">Review data</h1><p class="subject-caption">Inspect outputs and understand which runs to use.</p></div><details class="download-menu"><summary>Download records</summary><div id="manifest-downloads" class="manifest-downloads"></div></details></div>
<div id="subject-summary"></div><div id="workflow"></div><div id="stage-detail"></div><div id="source-content"></div>
<section class="review-workspace" aria-label="Scan review"><div class="scan-section"><div class="scan-section-heading"><h2>Scans</h2><span id="scan-counts" class="muted"></span></div><div id="scan-list"></div></div><article id="inspector" aria-label="Selected scan"></article></section>
</main></div><main id="pipeline-page" hidden></main><main id="coverage-page" hidden></main>`;
const find = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const inspector = new ScanInspector(find("inspector"));
let active: Stage = "review",
  data: Subject | undefined,
  selectedScan: RecordRow | undefined,
  request = 0;
function refreshScanList() {
  if (!data) return;
  const value = data;
  find("scan-list").replaceChildren(
    renderScans(
      value,
      (scan) => {
        selectedScan = scan;
        void inspector.show(value, scan, active);
        if (window.innerWidth < 1000)
          find("inspector").scrollIntoView({ block: "start" });
      },
      selectedScan,
    ),
  );
}
function chooseStage(stage: Stage) {
  active = stage;
  if (!data) return;
  find("workflow").replaceChildren(reviewControls(stage, chooseStage));
  find("stage-detail").replaceChildren(stageDetail(data, stage));
  document.querySelector<HTMLElement>(".review-workspace")!.hidden =
    stage === "source";
  find("source-content").replaceChildren();
  if (stage === "source")
    find("source-content").append(
      flywheelInventory(data, (prefix) => {
        const scan = scanForDestination(rawScans(data!), prefix);
        if (scan) {
          selectedScan = scan;
          refreshScanList();
          chooseStage("bids");
        } else
          find("notice").textContent =
            "This planned BIDS destination is not indexed as a scan in this snapshot.";
      }),
    );
  document
    .querySelector(".review-workspace")!
    .classList.toggle(
      "subject-outputs",
      stage === "surfaces" || stage === "registration",
    );
  const selection =
    stage === "surfaces" || stage === "registration"
      ? data.entities.find((e) => e.subject)
      : selectedScan;
  if (selection) void inspector.show(data, selection, stage);
  else inspector.clear();
}
async function chooseSubject(subject: string) {
  const current = ++request;
  data = undefined;
  selectedScan = undefined;
  inspector.clear();
  for (const id of ["workflow", "stage-detail", "scan-list", "subject-summary"])
    find(id).replaceChildren(element("p", "Loading…", "muted"));
  find("subject-title").textContent = `sub-${subject}`;
  find("scan-counts").textContent = "";
  find("notice").textContent = "";
  find("manifest-downloads").replaceChildren();
  document
    .querySelectorAll<HTMLButtonElement>("#subjects button")
    .forEach((b) =>
      b.setAttribute("aria-current", String(b.dataset.subject === subject)),
    );
  try {
    const value = await get<Subject>(`subjects/${encodeURIComponent(subject)}`);
    if (current !== request) return;
    data = value;
    selectedScan = initialScan(value);
    find("subject-summary").replaceChildren(subjectSummary(value));
    const downloads = find("manifest-downloads");
    downloads.replaceChildren();
    for (const [format, label] of [
      ["tsv", "Scan manifest (TSV)"],
      ["json", "Provenance bundle (JSON)"],
    ]) {
      const link = element("a", label);
      link.href = apiUrl(
        `subjects/${encodeURIComponent(subject)}/manifest?format=${format}`,
      );
      link.target = "_blank";
      link.rel = "noopener";
      downloads.append(link);
    }
    const outcomes = rawScans(data).map((scan) => scanOutcome(value, scan));
    find("scan-counts").textContent =
      `${outcomes.filter((o) => o.pending).length} need review / ${outcomes.filter((o) => o.flagged).length} flagged`;
    refreshScanList();
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
    find("subjects").replaceChildren();
    for (const { subject } of subjects) {
      const button = element("button", `sub-${subject}`);
      button.dataset.subject = subject;
      button.onclick = () => void chooseSubject(subject);
      find("subjects").append(button);
    }
    if (subjects.length) {
      await chooseSubject(subjects[0].subject);
      if (location.hash === "#coverage") await showCoverage();
    } else
      find("notice").textContent =
        "No subjects indexed. Build records from the canonical study first.";
  } catch (error) {
    find("notice").textContent = `Cannot load the study: ${error}`;
    find("freshness").textContent = "Index unavailable";
  }
}
if (import.meta.env.VITE_API_BASE_URL) {
  find("freshness").textContent = "Not connected";
  const connect = element("button", "Connect to local study");
  connect.onclick = async () => {
    connect.disabled = true;
    await start();
    connect.disabled = false;
    if (data) connection.remove();
  };
  const connection = element("section", undefined, "connection");
  const instructions = element("a", "Setup instructions");
  instructions.href = "/connect.html";
  connection.append(
    element("h2", "Connect through Sherlock"),
    element(
      "p",
      "Start the local study service using your Sherlock account and russpold Oak access. Then connect and allow this site to access your local network when your browser asks.",
    ),
    connect,
    instructions,
    element(
      "p",
      "Study records and images travel directly from your local service to this browser. Vercel hosts only the interface.",
      "muted",
    ),
  );
  find("notice").before(connection);
} else {
  void start();
}

find("pipeline-page").append(
  pipelineGuide((stage) => {
    location.hash = "review";
    chooseStage(stage);
  }),
);
let coverageRequest = 0;
async function showCoverage() {
  const request = ++coverageRequest;
  const host = find("coverage-page");
  if (!data) {
    const link = element("a", "Connect on Review data");
    link.href = "#review";
    host.replaceChildren(
      element("h1", "Data completeness"),
      element(
        "p",
        "Connect to the local study to inspect its recorded inventory.",
      ),
      link,
    );
    return;
  }
  host.replaceChildren(
    element("p", "Comparing recorded scan expectations with tracked files…"),
  );
  try {
    const inventory = await get<Coverage>("coverage");
    if (request !== coverageRequest) return;
    host.replaceChildren(
      renderCoverage(
        inventory,
        async (scan: CoverageScan, analysis: boolean) => {
          location.hash = "review";
          await chooseSubject(scan.subject);
          const found =
            data &&
            scanForDestination(
              rawScans(data),
              scan.prefix + "_" + String(scan.suffix),
            );
          if (found) {
            selectedScan = found;
            refreshScanList();
            chooseStage(analysis ? "events" : "bids");
          } else
            find("notice").textContent =
              "This expected scan has no indexed scan record. See Data completeness for its missing filenames.";
        },
      ),
    );
  } catch (error) {
    if (request === coverageRequest)
      host.replaceChildren(element("p", String(error), "gap"));
  }
}
function route() {
  const coverage = location.hash === "#coverage";
  const guide = location.hash === "#pipeline";
  find("review-page").hidden = guide || coverage;
  find("coverage-page").hidden = !coverage;
  if (coverage) void showCoverage();
  find("pipeline-page").hidden = !guide;
  document.title = guide
    ? "Pipeline guide · Network"
    : coverage
      ? "Data completeness · Network"
      : "Review data · Network";
  document
    .querySelectorAll<HTMLAnchorElement>(".page-nav a")
    .forEach((a) =>
      a.setAttribute(
        "aria-current",
        a.hash === (guide ? "#pipeline" : coverage ? "#coverage" : "#review")
          ? "page"
          : "false",
      ),
    );
  document.querySelector<HTMLAnchorElement>(".skip-link")!.href = guide
    ? "#pipeline-page"
    : coverage
      ? "#coverage-page"
      : "#review-page";
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route();
