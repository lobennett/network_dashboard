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
    ["fMRIPrep", data.reference_stages?.fmriprep?.label ?? stageStatus("fmriprep", data.attempts)],
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
// Two review modes: latest files, or one stage's recorded history chosen from a compact list.
export function reviewControls(active:Stage,select:(stage:Stage)=>void,data?:Subject,historyStage:Stage='source'):HTMLElement {
  const panel=element('div','','review-controls');
  const history=active!=='current';
  const modes=element('div','','review-modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','Review mode');
  for(const [label,stage,pressed] of [['Current files','current',!history],['Processing history',history?active:historyStage==='current'?'source':historyStage,history]] as [string,Stage,boolean][]){
    const button=element('button',label);button.type='button';button.setAttribute('aria-pressed',String(pressed));
    button.onclick=()=>{if(!pressed)select(stage);};modes.append(button);
  }
  panel.append(modes);
  if(!history){panel.append(element('p','Latest files across all stages — not evidence of what any single stage produced.','review-mode-note'));return panel;}
  const label=element('label','Stage'),picker=element('select');
  for(const stage of stages){
    const status=data?.reference_stages?.[stage.id]?.label??(data?(stage.id==='source'&&data.findings.some(f=>f.finding_type==='flywheel-acquisition')&&stageStatus('source',data.attempts)==='Unrecorded'?'Inventory recorded':stageStatus(stage.id,data.attempts)):'');
    const option=element('option',status?`${stage.title} — ${status}`:stage.title);option.value=stage.id;picker.append(option);
  }
  picker.value=active;picker.onchange=()=>select(picker.value as Stage);
  label.append(picker);panel.append(label);
  return panel;
}
