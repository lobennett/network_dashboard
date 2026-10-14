import { element } from "./review";
import type { Stage } from "./pipeline";

type Step = {
  id: string;
  title: string;
  caption: string;
  x: number;
  y: number;
  stage: Stage;
  tool: string;
  input: string;
  action: string;
  output: string;
  gate?: boolean;
};
export const guideSteps: Step[] = [
  {
    id: "dicom",
    title: "DICOM acquisitions",
    caption: "Functional and anatomical images",
    x: 20,
    y: 20,
    stage: "source",
    tool: "Flywheel",
    input: "Acquisitions in the study project.",
    action:
      "Select the intended scans upstream. Reviewed qa-reject anatomy and other recorded exclusions are skipped before conversion.",
    output:
      "Selected DICOM archives; skipped acquisitions retain a reason in the source inventory.",
  },
  {
    id: "pfile",
    title: "GE P-files",
    caption: "Fieldmap acquisitions · .7.zip",
    x: 390,
    y: 20,
    stage: "source",
    tool: "Flywheel",
    input: "The fieldmap acquisition’s *pfile.7.zip archive.",
    action:
      "Use the P-file reconstruction route even when the acquisition has no DICOMs.",
    output:
      "Source identity linked to the reconstructed fieldmap and magnitude images.",
  },
  {
    id: "behavior",
    title: "Canonical behavior",
    caption: "Collected once; managed in DataLad",
    x: 760,
    y: 20,
    stage: "events",
    tool: "Canonical behavioral datasets",
    input: "Reconciled in-scanner and out-of-scanner data.",
    action:
      "Link the finalized behavioral directories in sourcedata. In-scanner behavior supplies task events; out-of-scanner measures remain available for analysis.",
    output:
      "Stable behavioral inputs, with documented exceptions for missing files.",
  },
  {
    id: "convert",
    title: "Convert & deface",
    caption: "DICOM → NIfTI + JSON",
    x: 20,
    y: 150,
    stage: "bids",
    tool: "network_fw2bids · dcm2niix · PyDeface",
    input: "Selected DICOM archives.",
    action:
      "Convert images and immediately deface anatomical outputs before persistent storage on Oak. Functional images do not undergo anatomical defacing.",
    output:
      "BOLD images and defaced T1w/T2w images, with conversion and defacing evidence.",
  },
  {
    id: "recon",
    title: "Reconstruct fieldmaps",
    caption: "P-file → fieldmap + magnitude",
    x: 390,
    y: 150,
    stage: "bids",
    tool: "network_fw2bids · CNI spiral-recon (spirec28)",
    input: "The selected GE P-file archive.",
    action:
      "Reconstruct the fieldmap and magnitude pair. Preserve the source archive identity and reconstruction evidence.",
    output:
      "BIDS fmap images and sidecars; these are not skipped for lacking DICOMs.",
  },
  {
    id: "bids",
    title: "One BIDS dataset",
    caption: "Anatomy, BOLD and fieldmaps",
    x: 200,
    y: 290,
    stage: "bids",
    tool: "network_fw2bids · network_fmri",
    input: "Converted images and fieldmap reconstructions.",
    action:
      "Assemble one dataset with consistent subject, session, task, run and echo identities. Discovery and validation subjects share this dataset.",
    output:
      "A canonical BIDS directory, with acquisition selection and file history retained.",
  },
  {
    id: "prepare",
    title: "Trim & align events",
    caption: "Remove 7 BOLD volumes, once",
    x: 570,
    y: 290,
    stage: "trim",
    tool: "network_fmri · global_signal_plots · network_events",
    input: "BOLD time series and canonical in-scanner behavior.",
    action:
      "Run global signal plots before and after trimming the first seven BOLD volumes. Generate events using the trimmed scan’s time origin. Anatomy and fieldmaps are not temporally trimmed.",
    output:
      "Trimmed BOLD, aligned events, gs-pretrim / gs-posttrim derivatives. Consumers must not trim or shift these again.",
  },
  {
    id: "validate",
    title: "B0 linkage & validation",
    caption: "Fieldmaps → BOLD sidecars",
    x: 390,
    y: 420,
    stage: "b0",
    tool: "network_fmri · BIDS Validator",
    input: "Prepared images, events and participant metadata.",
    action:
      "Link B0FieldIdentifier and B0FieldSource within sessions, retain behavioral exceptions, and validate the complete dataset. Save validation logs.",
    output:
      "Validated inputs for processing. MRIQC and standalone FreeSurfer can then run in parallel.",
  },
  {
    id: "mriqc",
    title: "MRIQC 24.0.2",
    caption: "Image quality metrics & reports",
    x: 100,
    y: 550,
    stage: "mriqc",
    tool: "BABS / MechaBABS · MRIQC",
    input: "The prepared BIDS images.",
    action:
      "Run MRIQC, merge results and extract review evidence. Echo-2 motion, scan length, echo completeness and anatomical availability contribute review flags.",
    output:
      "Metrics, reports and scan_decisions.tsv. A flag alone does not drop a scan.",
  },
  {
    id: "fs",
    title: "FreeSurfer 8.2.0",
    caption: "Reconstruction → FSQC 2.1.4",
    x: 680,
    y: 550,
    stage: "surfaces",
    tool: "BABS / MechaBABS · FreeSurfer 8.2.0 · FSQC 2.1.4",
    input: "Selected, defaced anatomical images.",
    action:
      "Reconstruct cortical surfaces alongside MRIQC, then run FSQC for quality metrics, anatomical boundary overlays and surface views. Manual approval is still required.",
    output:
      "Subject anatomy, ribbon, white/pial surfaces, FSQC metrics and review images.",
  },
  {
    id: "scan-gate",
    title: "Approve scan decisions",
    caption: "Manual review",
    x: 100,
    y: 680,
    stage: "review",
    gate: true,
    tool: "scan_decisions.tsv · analysis_exclusions.tsv",
    input: "MRIQC evidence and behavioral timing findings.",
    action:
      "Explicitly approve flagged scan decisions. Keep preprocessing decisions separate from task-model exclusions; a timing problem may exclude a task model while retaining the BOLD series.",
    output:
      "Committed approval and curated, validated BIDS inputs. fMRIPrep waits for this approval.",
  },
  {
    id: "surface-gate",
    title: "Approve surfaces",
    caption: "Manual review",
    x: 680,
    y: 680,
    stage: "surfaces",
    gate: true,
    tool: "surface_review.tsv · NiiVue / ITK-SNAP / Freeview",
    input: "The exact FreeSurfer reconstruction to be reused.",
    action:
      "Inspect the ribbon over anatomy and the white/pial surfaces. If corrections are needed, reconstruct and review again; editing ribbon labels alone does not update meshes.",
    output:
      "Approval tied to the reconstruction fingerprint. fMRIPrep waits for this approval too.",
  },
  {
    id: "fmriprep",
    title: "fMRIPrep",
    caption: "Reuse the approved FS8 surfaces",
    x: 390,
    y: 810,
    stage: "fmriprep",
    tool: "BABS / MechaBABS · fMRIPrep",
    input:
      "Retained BIDS scans, linked fieldmaps and approved FreeSurfer subjects directory.",
    action:
      "Preprocess the retained scans using rigid atlas initialization and the approved surfaces, with --project-goodvoxels, --fs-no-resume and --dummy-scans 0. The campaign monitors jobs and merges completed results.",
    output:
      "Preprocessed BOLD, surface/CIFTI time series, confounds and reports.",
  },
  {
    id: "registration",
    title: "fmriprepviz 0.1.0",
    caption: "Final automated step",
    x: 390,
    y: 940,
    stage: "registration",
    tool: "fmriprepviz · DataLad",
    input: "Merged T1w-space BOLD references and the approved FreeSurfer ribbon.",
    action: "Render the same anatomical cuts with white and pial contours across scans and sessions. Save a GIF, interactive HTML viewer, logs and input checksums without changing the preprocessing outputs.",
    output: "One registration flipbook per subject, ready for final manual review.",
  },
  {
    id: "outputs",
    title: "Reviewable derivatives",
    caption: "Outputs, decisions and provenance",
    x: 390,
    y: 1070,
    stage: "registration",
    tool: "DataLad · Network dashboard",
    input: "Merged preprocessing outputs and processing records.",
    action:
      "Inspect final reports and file provenance. Pin dataset commits and apply analysis-specific exclusions before building models.",
    output:
      "Data for analysis, with original sources, transformations and decisions traceable. Processing completion is not blanket analysis approval.",
  },
];
const connections = [
  ["dicom", "convert", "M180 110 V150"],
  ["pfile", "recon", "M550 110 V150"],
  ["convert", "bids", "M180 240 V265 H360 V290"],
  ["recon", "bids", "M550 240 V265 H360 V290"],
  ["bids", "prepare", "M520 335 H570"],
  ["behavior", "prepare", "M920 110 V265 H730 V290"],
  ["prepare", "validate", "M730 380 V400 H550 V420"],
  ["validate", "mriqc", "M550 510 V530 H260 V550"],
  ["validate", "fs", "M550 510 V530 H840 V550"],
  ["mriqc", "scan-gate", "M260 640 V680"],
  ["fs", "surface-gate", "M840 640 V680"],
  ["scan-gate", "fmriprep", "M260 770 V790 H550 V810"],
  ["surface-gate", "fmriprep", "M840 770 V790 H550 V810"],
  ["fmriprep", "registration", "M550 900 V940"],
  ["registration", "outputs", "M550 1030 V1070"],
];
export function pipelineGuide(openStage: (stage: Stage) => void): HTMLElement {
  const page = element("div", "", "pipeline-guide");
  const intro = element("div", "", "guide-intro");
  intro.append(
    element("h1", "From Flywheel to fMRIPrep"),
    element(
      "p",
      "Follow the files through conversion, quality review and preprocessing. Select a step to see its inputs, outputs and tools.",
    ),
  );
  const note = element(
    "p",
    "Workflow reference · versions configured for this pilot. Subject progress appears on Review data.",
    "muted",
  );
  page.append(intro, note);
  const layout = element("div", "", "guide-layout");
  const diagram = element("div", "", "guide-diagram");
  const detail = element("section", "", "guide-detail");
  detail.setAttribute("aria-live", "polite");
  detail.setAttribute("aria-label", "Selected pipeline step");
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 1100 1190");
  svg.setAttribute("role", "group");
  svg.setAttribute(
    "aria-label",
    "Preprocessing pipeline. MRIQC and FreeSurfer run in parallel; both approvals precede fMRIPrep.",
  );
  svg.innerHTML =
    '<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#878783"/></marker></defs>';
  for (const [from, to, path] of connections) {
    const edge = document.createElementNS(ns, "path");
    edge.setAttribute("d", path);
    edge.setAttribute("class", "flow-edge");
    edge.setAttribute("marker-end", "url(#flow-arrow)");
    edge.dataset.from = from;
    edge.dataset.to = to;
    svg.append(edge);
  }
  const mobilePicker = element("select");
  mobilePicker.setAttribute("aria-label", "Pipeline step");
  const mobileLabel = element("label", "Select a step", "guide-step-picker");
  mobileLabel.append(mobilePicker);
  for (const step of guideSteps) {
    const option = element("option", step.title);
    option.value = step.id;
    mobilePicker.append(option);
  }
  page.append(mobileLabel);
  const buttons: SVGGElement[] = [];
  function select(step: Step) {
    mobilePicker.value = step.id;
    buttons.forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.step === step.id)),
    );
    detail.replaceChildren(
      element("small", step.gate ? "Manual approval" : "Pipeline step"),
      element("h2", step.title),
      element("p", step.tool, "guide-tool"),
    );
    for (const [title, text] of [
      ["Input", step.input],
      ["What happens", step.action],
      ["Output", step.output],
    ]) {
      const section = element("div");
      section.append(element("h3", title), element("p", text));
      detail.append(section);
    }
    const open = element("button", "Inspect this stage", "primary");
    open.onclick = () => openStage(step.stage);
    detail.append(open);
  }
  for (const step of guideSteps) {
    const node = document.createElementNS(ns, "g");
    node.dataset.step = step.id;
    node.setAttribute("class", `flow-node${step.gate ? " flow-gate" : ""}`);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", `${step.title}. ${step.caption}`);
    node.setAttribute("transform", `translate(${step.x} ${step.y})`);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("width", "320");
    rect.setAttribute("height", "90");
    rect.setAttribute("rx", "8");
    node.append(rect);
    for (const [y, text, cls] of [
      [36, step.title, "flow-title"],
      [64, step.caption, "flow-caption"],
    ] as const) {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", "18");
      label.setAttribute("y", String(y));
      label.setAttribute("class", cls);
      label.textContent = text;
      node.append(label);
    }
    const activate = () => {
      select(step);
      if (window.innerWidth <= 1100)
        detail.scrollIntoView({ block: "nearest" });
    };
    node.onclick = activate;
    node.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    };
    buttons.push(node);
    svg.append(node);
  }
  mobilePicker.onchange = () => {
    select(guideSteps.find((s) => s.id === mobilePicker.value)!);
    detail.scrollIntoView({ block: "nearest" });
  };
  diagram.append(svg);
  layout.append(diagram, detail);
  page.append(layout);
  const footer = element("section", "", "guide-notes");
  for (const [title, text] of [
    [
      "Two different kinds of exclusion",
      "A source exclusion prevents a file entering BIDS. An analysis exclusion can retain a scan for preprocessing while preventing its use in a task model.",
    ],
    [
      "One record of what happened",
      "DataLad records dataset milestones. BABS / MechaBABS orchestrate Slurm jobs and retain run provenance. File checksums and review decisions connect outputs to their inputs.",
    ],
    [
      "Read-only by design",
      "The dashboard displays evidence and recorded approvals. It does not approve scans or alter data. Use the pipeline’s review files to record decisions.",
    ],
  ]) {
    const block = element("div");
    block.append(element("h2", title), element("p", text));
    footer.append(block);
  }
  page.append(footer);
  select(guideSteps[0]);
  return page;
}
