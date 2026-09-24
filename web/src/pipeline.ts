import { type RecordRow } from "./review";
export type Subject = {
  entities: RecordRow[];
  attempts: RecordRow[];
  findings: RecordRow[];
  decisions: RecordRow[];
};
export const stages = [
  {
    id: "source",
    title: "Flywheel",
    caption: "Select acquisitions",
    description:
      "Select source DICOMs and skip reviewed exclusions, including qa-reject anatomy. Exclusions here happen before BIDS conversion.",
  },
  {
    id: "bids",
    title: "BIDS & defacing",
    caption: "Convert and protect",
    description:
      "Convert DICOMs, deface anatomy before storage, and assemble one BIDS dataset.",
  },
  {
    id: "trim",
    title: "Trim volumes",
    caption: "Remove first 7 TRs",
    description:
      "Record global signal before trimming, remove the first 7 functional volumes, then record global signal again. Trimming volumes does not drop a scan.",
  },
  {
    id: "events",
    title: "Events & metadata",
    caption: "Prepare analysis inputs",
    description:
      "Link canonical behavior, generate events, add participant data, link B0 fieldmaps, and validate BIDS. Behavioral timing problems can exclude task models while retaining BOLD for preprocessing.",
  },
  {
    id: "mriqc",
    title: "MRIQC",
    caption: "Measure image quality",
    description:
      "Run MRIQC, merge results, and extract metrics and reports for review. Flags are review prompts, not automatic scan exclusions.",
  },
  {
    id: "review",
    title: "Scan review",
    caption: "Manual approval",
    description:
      "Approve scan decisions before proceeding. Preprocessing retention and task-model eligibility are separate decisions.",
  },
  {
    id: "surfaces",
    title: "FreeSurfer 8",
    caption: "Reconstruct & review",
    description:
      "Run standalone FreeSurfer 8, then inspect and approve the surfaces. Surface approval is required before fMRIPrep uses this reconstruction.",
  },
  {
    id: "fmriprep",
    title: "fMRIPrep",
    caption: "Reuse approved surfaces",
    description:
      "Preprocess retained scans using the approved FreeSurfer subjects directory, then inspect the final outputs.",
  },
] as const;
export type Stage = (typeof stages)[number]["id"];
const milestoneStages: Record<string, Stage | "legacy"> = {
  conversion: "source",
  "flywheel-selection": "source",
  defacing: "bids",
  "bids-assembled": "bids",
  "gs-pretrim": "trim",
  "dummy-volumes-trimmed": "trim",
  "gs-posttrim": "trim",
  trim_dummy: "trim",
  "behavioral-sourcedata-ingested": "events",
  "bids-events-generated": "events",
  "participants-ingested": "events",
  "b0-fieldmaps-linked": "events",
  "bids-precuration-validated": "events",
  mriqc: "mriqc",
  "mriqc-complete": "mriqc",
  "scan-decisions-generated": "review",
  "scan-decisions-approved": "review",
  "mriqc-curated": "review",
  "bids-curated-validated": "review",
  freesurfer: "surfaces",
  "freesurfer-complete": "surfaces",
  "surface-review-generated": "surfaces",
  "surface-review-approved": "surfaces",
  anatomical: "legacy",
  fmriprep: "fmriprep",
  "fmriprep-complete": "fmriprep",
};
export function stageFor(name: string): Stage | "legacy" | "other" {
  return milestoneStages[name] ?? "other";
}
export function stageStatus(stage: Stage, attempts: RecordRow[]): string {
  const latest = new Map<string, RecordRow>();
  for (const row of attempts.filter(
    (a) => stageFor(String(a.stage)) === stage,
  )) {
    const key = `${row.stage}/${row.scope}`;
    if (
      !latest.has(key) ||
      Number(row.attempt ?? 0) >= Number(latest.get(key)!.attempt ?? 0)
    )
      latest.set(key, row);
  }
  const rows = [...latest.values()];
  const states = rows.map((a) => String(a.state).toLowerCase());
  if (
    states.some((s) =>
      ["failed", "error", "f", "timeout", "cancelled"].includes(s),
    )
  )
    return "Failed";
  if (states.some((s) => ["r", "running", "active"].includes(s)))
    return "Running";
  if (states.some((s) => ["pending", "pd", "queued"].includes(s)))
    return "Queued";
  if (states.includes("blocked")) return "Blocked";
  const successful = (name: string) =>
    rows.some((a) => a.stage === name && a.state === "success");
  const completions: Partial<Record<Stage, string>> = {
    source: "conversion",
    bids: "bids-assembled",
    trim: "gs-posttrim",
    events: "bids-precuration-validated",
    mriqc: "mriqc-complete",
    review: "scan-decisions-approved",
    surfaces: "surface-review-approved",
    fmriprep: "fmriprep-complete",
  };
  if (successful(completions[stage] ?? stage))
    return stage === "review" || stage === "surfaces" ? "Approved" : "Complete";
  if (states.length && states.every((s) => s === "success")) return "Recorded";
  return "Unrecorded";
}
export function reviewMetrics(
  data: Pick<Subject, "findings">,
  scan: RecordRow,
): RecordRow {
  const evidence = data.findings.find(
    (f) => f.entity_key === scan.entity_key && f.finding_type === "scan-review",
  );
  try {
    return evidence ? JSON.parse(String(evidence.evidence_json)) : {};
  } catch {
    return {};
  }
}
export function scanOutcome(
  data: Pick<Subject, "findings" | "decisions">,
  scan: RecordRow,
) {
  const m = reviewMetrics(data, scan);
  const d = data.decisions.filter((d) => d.entity_key === scan.entity_key);
  return {
    flagged: Boolean(m.flags),
    pending: m.approval_required === "yes" && m.approved !== "yes",
    dropped: d.some(
      (d) =>
        d.scope === "preprocessing" &&
        ["drop", "exclude"].includes(String(d.decision)),
    ),
    analysisExcluded: d.some(
      (d) => d.scope === "task_first_level" && d.decision === "exclude",
    ),
  };
}
export function rawScans(data: Pick<Subject, "entities">) {
  return data.entities.filter(
    (e) =>
      e.namespace === "raw" &&
      ["bold", "T1w", "T2w"].includes(String(e.suffix)) &&
      !e.echo,
  );
}
export function humanize(value: unknown) {
  return String(value ?? "Unrecorded")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}
