import { stageMetrics, evidenceCard, type StageFile } from "./stage-record";
import { get } from "./api";
import { surfaceGroup, surfaceLabel } from "./surface-groups";
import { taskPreview } from "./task-preview";
import { openRecordedFile } from "./document";
import { element, details, type RecordRow } from "./review";
import { scanPrefix } from "./scans";
import { humanize, type Subject, type Stage } from "./pipeline";
import { viewFile } from "./viewer";
import { viewerPresets, type ViewerPreset, type PresetFile } from "./viewer-presets";
import { provenanceJourney, provenanceTree, type Provenance } from "./provenance";
type Artifact = {
  id: string;
  path: string;
  dataset_id: string;
  content_id: string;
  preview_available?: boolean;
  fetch_available?: boolean;
  preview_reason?: string;
};
type Lineage = {
  artifact: Artifact;
  artifacts: Artifact[];
  links: { input: string; output: string; relation: string }[];
  attempts: RecordRow[];
  ancestry: string;
};
const isImage = (path: string) =>
  /\.(nii(\.gz)?|mgz|white|pial|inflated|gii)$/.test(path);

export class ScanInspector {
  private generation = 0;
  private viewer: Awaited<ReturnType<typeof viewFile>> | undefined;
  constructor(private panel: HTMLElement) {}
  clear() {
    this.generation++;
    this.viewer?.cleanup();
    this.viewer = undefined;
    this.panel.replaceChildren(
      element(
        "p",
        "Select a scan to view images, reports, and decisions.",
        "empty",
      ),
    );
  }
  async show(data: Subject, scan: RecordRow, stage: Stage) {
    this.clear();
    const generation = this.generation;
    const subjectOutputs = stage === "surfaces" || stage === "registration";
    const scanQuery = `q=${encodeURIComponent(scanPrefix(scan) + "_")}`;
    const query =
      stage === "registration"
        ? `subject=${encodeURIComponent(String(scan.subject))}&dataset_stage=fmriprepviz`
        : stage === "surfaces"
        ? `subject=${encodeURIComponent(String(scan.subject))}&dataset_stage=freesurfer`
        : stage === "fmriprep"
          ? `${scanQuery}&subject=${encodeURIComponent(String(scan.subject))}&dataset_stage=fmriprep&include_subject_report=true`
          : scanQuery;
    const boundary=`&subject=${encodeURIComponent(String(scan.subject))}`+(stage==="current"?"&current=true":`&stage=${stage}`);
    const belongsToSelection = (file: Artifact) =>
      stage !== "fmriprep" ||
      file.path.includes(scanPrefix(scan) + "_") ||
      file.path.endsWith(`sub-${scan.subject}.html`);
    const heading = element("div", "", "inspector-heading");
    heading.append(
      element(
        "small",
        subjectOutputs
          ? `sub-${scan.subject}`
          : `ses-${scan.session ?? "?"} / run-${scan.run ?? "—"}`,
      ),
      element(
        "h2",
        stage === "registration"
          ? "Registration review"
          : subjectOutputs
          ? "Surfaces & reconstruction"
          : String(scan.task ?? scan.suffix),
      ),
    );
    this.panel.replaceChildren(heading);
    const m = subjectOutputs ? {} : stageMetrics(data,scan,stage);
    const summary = element("div", "", "scan-metrics");
    const metrics: RecordRow =
      stage === "trim"
        ? {
            "Original TRs": m.original_tr_count,
            "Current TRs": m.tr_count,
            "Volumes removed":
              m.original_tr_count && m.tr_count
                ? Number(m.original_tr_count) - Number(m.tr_count)
                : undefined,
          }
        : {
            TRs: m.tr_count??m.size_t,
            "Mean FD (mm)":
              m.fd_mean === undefined
                ? undefined
                : Number(m.fd_mean).toFixed(3),
            "FD > 0.5 mm (%)":
              m.fd_thres === "0.5" && m.fd_perc !== undefined
                ? Number(m.fd_perc).toFixed(1)
                : undefined,
          };
    for (const [key, value] of Object.entries(metrics))
      if (value !== undefined) {
        const item = element("div");
        item.append(element("small", key), element("strong", String(value)));
        summary.append(item);
      }
    this.panel.append(summary);
    const decisions = data.decisions.filter((d) =>
      stage==="registration"?d.scope==="output":subjectOutputs ? d.scope === "surface" : d.entity_key === scan.entity_key,
    );
    const outcome = element("div", "", "scan-decisions");
    for (const d of decisions) {
      const row = element("p");
      row.append(
        element(
          "strong",
          d.scope === "preprocessing"
            ? "Processing: "
            : d.scope === "task_first_level"
              ? "Task models: "
              : d.scope === "surface"
                ? "Surface review: "
                : `${humanize(d.scope)}: `,
        ),
        document.createTextNode(
          `${d.scope === "surface" ? (d.decision === "yes" ? "Approved" : "Awaiting approval") : d.decision === "keep" ? "Keep" : d.decision === "exclude" ? "Excluded" : humanize(d.decision)}${d.reviewer ? ` · ${d.reviewer}` : ""}${d.reason ? ` — ${d.reason}` : ""}`,
        ),
      );
      outcome.append(row);
    }
    if (m.flags)
      outcome.append(
        element(
          "p",
          `Flagged during scan review: ${humanize(m.flags)}. ${m.approval_required === "yes" ? (m.approved === "yes" ? "Review approved." : "Review required.") : "No manual approval required."}`,
          m.approved === "yes" ? "reviewed-note" : "gap",
        ),
      );
    this.panel.append(outcome);
    const navigation = element("div", "", "inspector-tabs");
    const content = element("div", "", "inspection-content");
    let files: Artifact[] | undefined;
    const showEvidence = () => {
      this.viewer?.cleanup();
      this.viewer = undefined;
      content.replaceChildren(element("h3", "Evidence for this stage"));
      if (Object.keys(m).length) {
        const metrics = element("details");
        metrics.append(element("summary", "All recorded metrics"), details(m));
        content.append(metrics);
      }
      for (const f of data.findings.filter(
        (f) =>
          f.entity_key === scan.entity_key && f.finding_type !== "scan-review",
      )) {
        content.append(evidenceCard(f));
      }
      for (const d of decisions) {
        const block = element("details");
        block.append(
          element("summary", `${humanize(d.scope)} decision`),
          details(d),
        );
        content.append(block);
      }
    };
    let viewGeneration = 0;
    const showFiles = async () => {
      const view = ++viewGeneration;
      this.load++;
      this.viewer?.cleanup();
      this.viewer = undefined;
      content.replaceChildren(
        element("p", "Checking available images and reports…", "muted"),
      );
      try {
        files ??= await get<Artifact[]>(
          `artifacts?${query}${boundary}&limit=1000&preview=true`,
        );
        if (generation !== this.generation || view !== viewGeneration) return;
        files = files.filter(belongsToSelection);
        const available = files.filter(
          (f) =>
            (f.preview_available || f.fetch_available) &&
            (!f.path.includes("/surf/") ||
              /\/(lh|rh)\.(white|pial|inflated)$/.test(f.path)),
        );
        const choices = element("div", "", "preview-choices");
        const display = element("div", "", "preview-display");
        content.replaceChildren(choices, display);
        choices.classList.toggle("surface-controls", stage === "surfaces");
        const unique = [
          ...new Map(
            available.map((f) => [`${f.dataset_id}/${f.path}/${f.content_id}`, f]),
          ).values(),
        ];
        unique.sort(
          (a, b) =>
            Number(b.path.includes("echo-2")) -
            Number(a.path.includes("echo-2")),
        );
        let companions: Artifact[] = [];
        if (stage === "fmriprep" && unique.some(f => /_space-T1w_.*boldref\.nii/.test(f.path))) {
          companions = await get<Artifact[]>(`artifacts?subject=${encodeURIComponent(String(scan.subject))}&dataset_stage=fmriprep&stage=fmriprep&q=_desc-preproc_T1w.nii&limit=1000&preview=true`);
          if (generation !== this.generation || view !== viewGeneration) return;
        }
        const presets = viewerPresets([...available, ...companions]);
        if (presets.length) {
          const block = element("section", "", "viewer-presets");
          block.append(element("h3", "Review presets"));
          const picker = element("select");
          picker.setAttribute("aria-label", "Review preset");
          presets.forEach((preset, i) => {
            const duplicate = presets.filter(p => p.label === preset.label).length > 1;
            const option = element("option", preset.label + (duplicate ? ` · ${preset.base.path.split('/').pop()}` : ""));
            option.value = String(i); picker.append(option);
          });
          const description = element("p", presets[0].description, "muted");
          picker.onchange = () => { description.textContent = presets[Number(picker.value)].description; };
          const open = element("button", "Open preset", "primary");
          open.onclick = () => {
            const preset = presets[Number(picker.value)];
            void this.preview(preset.base, display, generation, preset.overlays, preset);
          };
          block.append(picker, open, description); choices.append(block);
        }
        if (stage === "surfaces") {
          for (const group of [
            "Anatomy",
            "Segmentations",
            "Cortical surfaces",
            "Other outputs",
          ]) {
            const members = unique.filter(
              (f) => surfaceGroup(f.path) === group,
            );
            if (!members.length) continue;
            const block = element("details", "", "surface-group");
            block.open = group !== "Other outputs";
            block.append(element("summary", group));
            const select = element("select");
            select.setAttribute("aria-label", group);
            members.forEach((f, i) => {
              const option = element(
                "option",
                `${surfaceLabel(f.path)} · ${f.content_id.slice(-6)}`,
              );
              option.value = String(i);
              select.append(option);
            });
            const view = element("button", "View", "primary");
            view.onclick = () =>
              void this.preview(
                members[Number(select.value)],
                display,
                generation,
              );
            const trace = element("button", "Trace file", "text-button");
            trace.onclick = () =>
              void this.lineage(
                members[Number(select.value)].id,
                display,
                generation,
              );
            block.append(select, view, trace);
            choices.append(block);
          }
        }
        if (stage !== "surfaces" && unique.length) {
          const picker = element("select");
          picker.setAttribute("aria-label", "Image or report");
          unique.forEach((file, index) => {
            const name = file.path.split("/").pop()!;
            const option = element(
              "option",
              `${name} · ${file.content_id?.slice(-6) ?? "unrecorded"}`,
            );
            option.value = String(index);
            picker.append(option);
          });
          const open = element("button", "", "primary");
          const trace = element("button", "File history", "text-button");
          const update = () => {
            const file = unique[Number(picker.value)];
            open.textContent = isImage(file.path)
              ? "Open image"
              : "Open report";
            open.title =
              file.path +
              (file.fetch_available ? " — downloads from Oak when opened" : "");
          };
          picker.onchange = update;
          update();
          open.onclick = () => {
            const file = unique[Number(picker.value)];
            if (isImage(file.path))
              void this.preview(file, display, generation);
            else void openRecordedFile(file.id, file.path);
          };
          trace.onclick = () =>
            void this.lineage(
              unique[Number(picker.value)].id,
              display,
              generation,
            );
          choices.append(picker, open, trace);
        }
        if (!unique.length)
          display.append(
            element(
              "p",
              stage === "fmriprep"
                ? "No fMRIPrep outputs are available in this snapshot. They appear after results are merged and the snapshot is refreshed."
                : "No previewable images or reports are available in this snapshot. Use File history to inspect recorded outputs.",
              "empty",
            ),
          );
        else
          display.append(
            element(
              "p",
              stage === "registration"
                ? "Open the registration report. Use the frame slider or arrow keys to compare BOLD alignment across scans and sessions."
                : "Choose an image or report above. In NiiVue, scroll to move through slices; drag to adjust the view.",
              "muted",
            ),
          );
        const unavailable = files.filter(
          (f) => !f.preview_available && !f.fetch_available,
        );
        if (unavailable.length) {
          const block = element("details", "", "unavailable");
          block.append(
            element(
              "summary",
              `${unavailable.length} unavailable or historical file versions`,
            ),
          );
          for (const file of unavailable)
            block.append(
              element(
                "p",
                `${file.path.split("/").pop()}: ${file.preview_reason}`,
              ),
            );
          content.append(block);
        }
      } catch (error) {
        if (generation === this.generation && view === viewGeneration)
          content.replaceChildren(element("p", String(error), "gap"));
      }
    };
    const showIndexedFiles = async () => {
      const view = ++viewGeneration;
      this.load++;
      this.viewer?.cleanup();
      this.viewer = undefined;
      content.replaceChildren(element("p", "Loading indexed files…", "muted"));
      try {
        const all = await get<Artifact[]>(`artifacts?${query}${boundary}&limit=1000`);
        if (generation !== this.generation || view !== viewGeneration) return;
        const list = element("div", "", "indexed-files");
        const display = element("div", "", "preview-display");
        content.replaceChildren(list, display);
        for (const file of all.filter(
          (f) => belongsToSelection(f) && !f.path.endsWith(".svg"),
        )) {
          const button = element("button", file.path, "file-button");
          button.onclick = () =>
            void this.lineage(file.id, display, generation);
          list.append(button);
        }
        if (!list.childElementCount)
          list.append(element("p", "No files indexed for this scan.", "empty"));
      } catch (error) {
        if (generation === this.generation && view === viewGeneration)
          content.replaceChildren(element("p", String(error), "gap"));
      }
    };
    const showTask = async () => {
      const view = ++viewGeneration;
      this.load++;
      this.viewer?.cleanup();
      this.viewer = undefined;
      await taskPreview(
        content,
        scanQuery + (stage==="current"?"&current=true":`&subject=${encodeURIComponent(String(scan.subject))}&stage=${stage}`),
        () => generation === this.generation && view === viewGeneration,
      );
    };
    const tabs: [string, () => void | Promise<void>][] = [
      ["Images & reports", showFiles],
      ...(!subjectOutputs && ["events","review","current"].includes(stage) && scan.suffix === "bold"
        ? [["Events & design", showTask] as [string, () => Promise<void>]]
        : []),
      [
        "Evidence",
        () => {
          viewGeneration++;
          this.load++;
          showEvidence();
        },
      ],
      ["File history", showIndexedFiles],
    ];
    for (const [label, action] of tabs) {
      const button = element("button", label);
      button.onclick = () => {
        navigation
          .querySelectorAll("button")
          .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
        void action();
      };
      navigation.append(button);
    }
    this.panel.append(navigation, content);
    const initialTab =
      stage === "events"
        ? 1
        : stage === "review"
          ? scan.suffix === "bold"
            ? 2
            : 1
          : 0;
    (navigation.children[initialTab] as HTMLButtonElement).click();
  }
  showArtifact(file:StageFile,stage:Stage,trace=false){
    this.clear();
    const display=element('div','','preview-display');
    this.panel.replaceChildren(element('h2',file.path.split('/').pop()),element('p',`File recorded for ${humanize(stage)}. Content is verified before display.`,'muted'),display);
    if(trace)void this.lineage(file.id,display,this.generation);
    else if(isImage(file.path))void this.preview(file,display,this.generation);
    else if(file.path.endsWith('.html'))void openRecordedFile(file.id,file.path);
    else void this.lineage(file.id,display,this.generation);
  }
  private load = 0;
  private async preview(
    file: PresetFile,
    display: HTMLElement,
    generation: number,
    overlays: PresetFile[] = [],
    preset?: ViewerPreset,
  ) {
    const load = ++this.load;
    this.viewer?.cleanup();
    this.viewer = undefined;
    const frame = element("div", "", "viewer-frame"),
      canvas = element("canvas", "", "viewer");
    canvas.setAttribute("aria-label", "NiiVue image and surface viewer");
    frame.append(canvas);
    const status = element("p", "Loading NiiVue…", "muted");
    display.replaceChildren(status, frame);
    try {
      const viewer = await viewFile(canvas, file.id, file.path, overlays, preset?.mode);
      if (
        generation !== this.generation ||
        load !== this.load ||
        !frame.isConnected
      )
        viewer.cleanup();
      else {
        this.viewer = viewer;
        status.textContent = preset?.label ?? file.path.split("/").pop()!;
        if (preset) {
          const controls = element("div", "", "viewer-preset-controls");
          controls.append(element("p", preset.description, "muted"));
          const label = element("label", preset.mode === "surfaces" ? "Pial opacity " : "Overlay opacity ");
          const opacity = element("input");
          opacity.type = "range"; opacity.min = "0"; opacity.max = "1"; opacity.step = "0.05"; opacity.value = "0.35";
          const value = element("output", "35%");
          opacity.oninput = () => {
            const amount = Number(opacity.value);
            if (preset.mode === "surfaces") {
              viewer.meshes[1].setProperty("opacity", amount, viewer.gl);
              viewer.updateGLVolume();
            }
            else viewer.setOpacity(1, amount);
            value.textContent = `${Math.round(amount * 100)}%`;
          };
          label.append(opacity, value); controls.append(label);
          const sources = element("details");
          sources.append(element("summary", "Files in this view"));
          for (const source of [file, ...overlays]) {
            const trace = element("button", source.path.split('/').pop(), "text-button");
            trace.title = source.path;
            trace.onclick = () => void this.lineage(source.id, display, generation);
            sources.append(trace);
          }
          controls.append(sources); display.insertBefore(controls, frame);
        }
      }
    } catch (error) {
      if (generation === this.generation && load === this.load) {
        frame.remove();
        status.textContent = String(error);
        status.className = "gap";
      }
    }
  }
  private async lineage(id: string, display: HTMLElement, generation: number) {
    this.load++;
    this.viewer?.cleanup();
    this.viewer = undefined;
    display.replaceChildren(element("p", "Loading file history…", "muted"));
    const load = this.load;
    try {
      const [data, history] = await Promise.all([
        get<Lineage>(`artifacts/${id}/lineage`), get<Provenance>(`artifacts/${id}/tree`),
      ]);
      if (generation !== this.generation || load !== this.load) return;
      const technical = element("details");
      technical.append(element("summary", "Selected file details"), details(data.artifact));
      display.replaceChildren(element("h3", "File history"),
        element("p", data.artifact.path.split('/').pop(), "file-path"),
        provenanceJourney(history, target => void this.lineage(target, display, generation)), technical);
      const tree = element("details");
      tree.append(element("summary", "Explore the full dependency tree"), provenanceTree(history));
      display.append(tree);
      const related = element("details");
      related.append(element("summary", "Related files and transformation records"));
      if (/\.(json|tsv|txt|log|html)$/.test(data.artifact.path)) {
        const open = element("button", "Open recorded file");
        open.onclick = () => void openRecordedFile(id, data.artifact.path);
        display.append(open);
      }
      if (data.ancestry === "unrecorded")
        display.append(
          element(
            "p",
            "Earlier file-level history is unrecorded for this version.",
            "gap",
          ),
        );
      for (const link of data.links) {
        const other = data.artifacts.find(
          (a) => a.id === (link.input === id ? link.output : link.input),
        );
        if (!other) continue;
        const button = element(
          "button",
          `${link.input === id ? "Output" : "Input"} · ${humanize(link.relation)} · ${other.path}`,
          "file-button",
        );
        button.onclick = () => void this.lineage(other.id, display, generation);
        related.append(button);
      }
      for (const attempt of data.attempts) {
        const block = element("details");
        block.append(
          element("summary", "Transformation record"),
          details(attempt),
        );
        related.append(block);
      }
      if (data.links.length || data.attempts.length) display.append(related);
    } catch (error) {
      if (generation === this.generation && load === this.load)
        display.replaceChildren(element("p", String(error), "gap"));
    }
  }
}
