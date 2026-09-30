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
export function reviewControls(active:Stage,select:(stage:Stage)=>void,data?:Subject):HTMLElement {
  const panel=element('div','','review-controls');
  const steps=element('nav','','stage-navigation');steps.setAttribute('aria-label','Processing steps and current files');
  for(const stage of [...stages,{id:'current' as const,title:'Current files'}]){
    const button=element('button');button.append(element('span',stage.title));
    button.setAttribute('aria-current',active===stage.id?'step':'false');
    button.title=stage.id==='current'?'Latest available files':data?.reference_stages?.[stage.id]?.label??(data?stageStatus(stage.id,data.attempts):stage.title);
    button.onclick=()=>select(stage.id);steps.append(button);
  }
  panel.append(steps);
  requestAnimationFrame(()=>{const selected=steps.querySelector<HTMLElement>('[aria-current="step"]');if(selected&&steps.scrollWidth>steps.clientWidth)steps.scrollLeft=Math.max(0,selected.offsetLeft-steps.offsetLeft-16);});
  return panel;
}
