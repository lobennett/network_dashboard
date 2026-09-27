import "./styles.css";
import "./layout.css";
import { get, apiUrl } from "./api";
import { element, type RecordRow } from "./review";
import { renderScans, scanForDestination } from "./scans";
import { flywheelInventory } from "./flywheel";
import { stageReport, stageSubject, type StageRecord } from "./stage-record";
import { rawScans, scanOutcome, stages, type Subject, type Stage } from "./pipeline";
import { ScanInspector } from "./inspector";
import { initialScan, subjectSummary, reviewControls } from "./review-layout";
import { pipelineGuide } from "./pipeline-guide";
import { renderCoverage, type Coverage, type CoverageScan } from "./coverage";
import { completionChecklist, type Completion } from "./completion";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<a class="skip-link" href="#review-page">Skip to content</a>
<header><a class="brand" href="#review">Network<span>Data review</span></a><nav class="page-nav" aria-label="Pages"><a href="#review">Review data</a><a href="#coverage">Data completeness</a><a href="#pipeline">Pipeline guide</a></nav><span id="freshness" role="status">Snapshot not loaded</span></header>
<div class="workspace" id="review-page"><aside><h2>Subjects</h2><nav id="subjects" aria-label="Subjects"></nav><p class="aside-note">Read-only review<br>Recorded in DataLad</p><a class="aside-help" href="/connect.html">Connection help</a></aside>
<main><div id="notice" role="alert"></div><div class="subject-heading"><div><h1 id="subject-title">Review data</h1><p class="subject-caption">Follow a processing step, or browse Current files.</p></div><details class="download-menu"><summary>Download records</summary><div id="manifest-downloads" class="manifest-downloads"></div></details></div>
<details class="subject-status"><summary>Subject status and checks</summary><div id="subject-summary"></div><div id="subject-completion"></div></details><div id="workflow"></div><div id="stage-detail"></div><div id="source-content"></div>
<section class="review-workspace" aria-label="Scan review"><div class="scan-section"><div class="scan-section-heading"><h2>Scans</h2><span id="scan-counts" class="muted"></span></div><div id="scan-list"></div></div><article id="inspector" aria-label="Selected scan"></article></section>
</main></div><main id="pipeline-page" hidden></main><main id="coverage-page" hidden></main>`;
const find = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const inspector = new ScanInspector(find("inspector"));
const initialStage = new URL(location.href).searchParams.get("stage");
let active: Stage = initialStage === "current" || stages.some(s => s.id === initialStage) ? initialStage as Stage : "source",
  data: Subject | undefined,
  selectedScan: RecordRow | undefined,
  request = 0;
let stageRequest=0, stageRecord:StageRecord|undefined;
function stageData(value:Subject):Subject {
 return stageSubject(value,active,stageRecord);
}
function rememberSelection(){
 const url=new URL(location.href);url.searchParams.set("stage",active);
 if(data?.entities[0]?.subject)url.searchParams.set("subject",String(data.entities[0].subject));
 if(selectedScan?.entity_key)url.searchParams.set("scan",String(selectedScan.entity_key));
 history.replaceState(null,"",url);
}
function refreshScanList() {
  if (!data) return;
  const value = stageData(data);
  find("scan-list").replaceChildren(
    renderScans(
      value,
      (scan) => {
        selectedScan = scan;
        rememberSelection();
        void inspector.show(value, scan, active);
        if (window.innerWidth < 1000)
          find("inspector").scrollIntoView({ block: "start" });
      },
      selectedScan,
      active,
    ),
  );
}
function chooseStage(stage: Stage, preferred?:RecordRow) {
  if(preferred)selectedScan=preferred;
  active = stage;
  stageRecord=undefined;
  const current=++stageRequest;
  if (!data) return;
  rememberSelection();
  inspector.clear();
  find("scan-list").replaceChildren(element("p","Loading stage records…","muted"));
  find("scan-counts").textContent="";
  find("notice").textContent="";
  find("workflow").replaceChildren(reviewControls(stage, chooseStage, data));
  find("stage-detail").replaceChildren(stageReport(data,stage,undefined,(file,trace)=>inspector.showArtifact(file,stage,trace)));
  document.querySelector<HTMLElement>(".review-workspace")!.hidden = stage === "source";
  find("source-content").replaceChildren();
  const subjectOutputs=stage==="surfaces"||stage==="registration";
  document.querySelector(".review-workspace")!.classList.toggle("subject-outputs",subjectOutputs);
  const update=()=>{
    if(!data||current!==stageRequest)return;
    const scans=rawScans(stageData(data));
    if(!subjectOutputs&&stage!=="source"&&!scans.some(s=>s.entity_key===selectedScan?.entity_key)){
      if(preferred)find("notice").textContent="This scan has no recorded file versions or findings at this stage. Open Current files for the latest data.";
      else selectedScan=initialScan(stageData(data));
    }
    rememberSelection();
    refreshScanList();
    const selection=subjectOutputs?data.entities.find(e=>e.subject):selectedScan;
    if(selection&&stage!=="source")void inspector.show(stageData(data),selection,stage);
    const outcomes=rawScans(stageData(data)).map(scan=>scanOutcome(stageData(data!),scan));
    find("scan-counts").textContent=["current","review"].includes(stage)?`${outcomes.filter(o=>o.pending).length} need review / ${outcomes.filter(o=>o.flagged).length} flagged`:"Stage-specific files and evidence";
  };
  if(stage==="current"){update();return;}
  const subject=String(data.entities.find(e=>e.subject)?.subject);
  void get<StageRecord>(`subjects/${encodeURIComponent(subject)}/stages/${stage}`).then(record=>{
    if(!data||current!==stageRequest)return;
    if(record.snapshot_kind!=="recorded_stage_evidence")throw new Error("Stage records require connector 0.7.0 or newer.");
    stageRecord=record;
    find("stage-detail").replaceChildren(stageReport(data,stage,record,(file,trace)=>inspector.showArtifact(file,stage,trace)));
    if(stage==="source")find("source-content").append(flywheelInventory(stageData(data),prefix=>{
      const scan=scanForDestination(rawScans(data!),prefix);
      if(scan){chooseStage("bids",scan);}
      else find("notice").textContent="The planned destination has no indexed BIDS scan. Its source record remains available here.";
    }));
    update();
  }).catch(error=>{
    if(current!==stageRequest)return;
    find("stage-detail").append(element("p",`Stage evidence unavailable: ${error}. Restart with connector 0.7.0 or newer. Current files remain available separately.`,"gap"));
    find("scan-list").replaceChildren();inspector.clear();
  });
}
async function chooseSubject(subject: string) {
  const current = ++request;
  stageRequest++;stageRecord=undefined;
  find("source-content").replaceChildren();
  data = undefined;
  selectedScan = undefined;
  inspector.clear();
  for (const id of ["workflow", "stage-detail", "scan-list", "subject-summary"])
    find(id).replaceChildren(element("p", "Loading…", "muted"));
  find("subject-title").textContent = `sub-${subject}`;
  find("scan-counts").textContent = "";
  find("notice").textContent = "";
  find("manifest-downloads").replaceChildren();
  find("subject-completion").replaceChildren();
  document
    .querySelectorAll<HTMLButtonElement>("#subjects button")
    .forEach((b) =>
      b.setAttribute("aria-current", String(b.dataset.subject === subject)),
    );
  try {
    const value = await get<Subject>(`subjects/${encodeURIComponent(subject)}`);
    if (current !== request) return;
    data = value;
    const savedScan=new URL(location.href).searchParams.get("scan");
    selectedScan=value.entities.find(e=>e.entity_key===savedScan)??initialScan(value);
    find("subject-summary").replaceChildren(subjectSummary(value));
    void get<Completion>(`subjects/${encodeURIComponent(subject)}/completion`)
      .then((checklist) => {
        if (current === request)
          find("subject-completion").replaceChildren(
            completionChecklist(checklist, chooseStage),
          );
      })
      .catch((error) => {
        if (current === request)
          find("subject-completion").replaceChildren(
            element(
              "p",
              `Checklist unavailable: ${error}. Restart with the current connector version.`,
              "gap",
            ),
          );
      });
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
      const savedSubject=new URL(location.href).searchParams.get("subject");
      await chooseSubject(subjects.find(s=>s.subject===savedSubject)?.subject??subjects[0].subject);
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
            chooseStage("current",found);
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
