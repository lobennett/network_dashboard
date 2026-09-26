import { element, type RecordRow } from "./review";
import {
  rawScans,
  scanOutcome,
  stageStatus,
  stages,
  type Subject,
  type Stage,
} from "./pipeline";

export function initialScan(data: Subject): RecordRow | undefined {
  const scans = rawScans(data);
  return (
    scans.find((s) => scanOutcome(data, s).pending) ??
    scans.find((s) => s.suffix === "bold") ??
    scans[0]
  );
}
export function subjectSummary(data: Subject): HTMLElement {
  const panel = element("div", "", "subject-summary");
  const outcomes = rawScans(data).map((s) => scanOutcome(data, s));
  const pending = outcomes.filter((o) => o.pending).length;
  const excluded = outcomes.filter((o) => o.analysisExcluded).length;
  for (const [label, value] of [
    ["fMRIPrep", stageStatus("fmriprep", data.attempts)],
    [
      "Scan review",
      pending ? `${pending} need review` : stageStatus("review", data.attempts),
    ],
    ["Surfaces", stageStatus("surfaces", data.attempts)],
    ["Task models", `${excluded} excluded run${excluded === 1 ? "" : "s"}`],
  ]) {
    const item = element("div");
    item.append(element("span", label), element("strong", value));
    panel.append(item);
  }
  return panel;
}
export function reviewControls(active:Stage,select:(stage:Stage)=>void,data?:Subject):HTMLElement {
  const panel=element('div','','review-controls');
  const modes=element('nav','','review-modes');modes.setAttribute('aria-label','Data views');
  for(const [title,stage] of [['Stage history',active==='current'?'source':active],['Current files','current']] as const){
    const button=element('button',title);button.setAttribute('aria-pressed',String((stage==='current')===(active==='current')));button.onclick=()=>select(stage);modes.append(button);
  }
  panel.append(modes);
  if(active!=='current'){
    const steps=element('nav','','stage-navigation');steps.setAttribute('aria-label','Subject pipeline stages');
    stages.forEach((stage,i)=>{const button=element('button');button.append(element('span',String(i+1),'stage-number'),element('span',stage.title));if(data)button.append(element('small',stage.id==='source'&&data.findings.some(f=>f.finding_type==='flywheel-acquisition')?'Audit available':stageStatus(stage.id,data.attempts),'stage-state'));button.setAttribute('aria-current',active===stage.id?'step':'false');button.onclick=()=>select(stage.id);steps.append(button);});
    panel.append(steps,element('p','FreeSurfer runs alongside MRIQC. Scan and surface approval both precede fMRIPrep.','stage-parallel-note'));
  }
  return panel;
}
