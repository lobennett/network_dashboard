import { get } from "./api";
import { openRecordedFile } from "./document";
import { element, details, type RecordRow } from "./review";
import { scanPrefix } from "./scans";
import { reviewMetrics, humanize, type Subject, type Stage } from "./pipeline";
import { viewFile } from "./viewer";
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
    const subjectOutputs = stage === "surfaces";
    const scanQuery = `q=${encodeURIComponent(scanPrefix(scan) + "_")}`;
    const query =
      stage === "surfaces"
        ? `subject=${encodeURIComponent(String(scan.subject))}&dataset_stage=freesurfer`
        : stage === "fmriprep"
          ? `${scanQuery}&subject=${encodeURIComponent(String(scan.subject))}&dataset_stage=fmriprep&include_subject_report=true`
          : scanQuery;
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
        subjectOutputs
          ? "Surfaces & reconstruction"
          : String(scan.task ?? scan.suffix),
      ),
    );
    this.panel.replaceChildren(heading);
    const m = subjectOutputs ? {} : reviewMetrics(data, scan);
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
            TRs: m.tr_count,
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
      subjectOutputs ? d.scope === "surface" : d.entity_key === scan.entity_key,
    );
    const outcome = element("div", "", "scan-decisions");
    for (const d of decisions) {
      const row = element("p");
      row.append(
        element(
          "strong",
          d.scope === "preprocessing"
            ? "Preprocessing: "
            : d.scope === "task_first_level"
              ? "Task models: "
              : `${humanize(d.scope)}: `,
        ),
        document.createTextNode(
          `${humanize(d.decision)}${d.reviewer ? ` · ${d.reviewer}` : ""}${d.reason ? ` — ${d.reason}` : ""}`,
        ),
      );
      outcome.append(row);
    }
    if (m.flags)
      outcome.append(
        element(
          "p",
          `Flagged during scan review: ${humanize(m.flags)}. ${m.approval_required === "yes" ? (m.approved === "yes" ? "Review approved." : "Review required.") : "No manual approval required."}`,
          "gap",
        ),
      );
    this.panel.append(outcome);
    const navigation = element("div", "", "inspector-tabs");
    const content = element("div", "", "inspection-content");
    let files: Artifact[] | undefined;
    const showEvidence = () => {
      this.viewer?.cleanup();
      this.viewer = undefined;
      content.replaceChildren(element("h3", "Recorded evidence"));
      if (Object.keys(m).length) content.append(details(m));
      for (const f of data.findings.filter(
        (f) =>
          f.entity_key === scan.entity_key && f.finding_type !== "scan-review",
      )) {
        const block = element("details");
        block.append(element("summary", humanize(f.finding_type)), details(f));
        content.append(block);
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
          `artifacts?${query}&limit=1000&preview=true`,
        );
        if (generation !== this.generation || view !== viewGeneration) return;
        files = files.filter(belongsToSelection);
        const available = files.filter((f) => f.preview_available || f.fetch_available);
        const choices = element("div", "", "preview-choices");
        const display = element("div", "", "preview-display");
        content.replaceChildren(choices, display);
        const unique = [
          ...new Map(
            available.map((f) => [`${f.path}/${f.content_id}`, f]),
          ).values(),
        ];
        unique.sort(
          (a, b) =>
            Number(b.path.includes("echo-2")) -
            Number(a.path.includes("echo-2")),
        );
        if (subjectOutputs) {
          for (const norm of unique.filter(f => f.path.endsWith('/mri/norm.mgz'))) {
            const ribbon = unique.find(f => f.dataset_id === norm.dataset_id && f.path === norm.path.replace(/norm\.mgz$/, 'ribbon.mgz'));
            if (ribbon) {
              const button = element('button', 'Inspect ribbon over anatomy', 'primary');
              button.title = norm.path;
              button.onclick = () => void this.preview(norm, display, generation, [ribbon]);
              choices.append(button);
            }
          }
        }
        for (const file of unique) {
          const label = isImage(file.path)
            ? `View ${subjectOutputs ? file.path.split("/").pop() : (file.path.match(/echo-\d+/)?.[0] ?? file.path.match(/_(fieldmap|magnitude)\.nii/)?.[1] ?? scan.suffix)} in NiiVue`
            : /_(bold|T1w|T2w)\.html$/.test(file.path)
              ? "Open MRIQC report"
              : "Open report";
          const button = element(
            "button",
            label,
            isImage(file.path) ? "primary" : "",
          );
          button.title = file.path + (file.fetch_available ? ' — downloads from Oak when opened' : '');
          button.onclick = () => {
            if (!isImage(file.path)) {
              void openRecordedFile(file.id, file.path);
              return;
            }
            void this.preview(file, display, generation);
          };
          choices.append(button);
          const lineage = element("button", "Trace file", "text-button");
          lineage.title = file.path;
          lineage.onclick = () =>
            void this.lineage(file.id, display, generation);
          choices.append(lineage);
        }
        if (!unique.length)
          display.append(
            element(
              "p",
              "No previewable images or reports are available in this local snapshot.",
              "empty",
            ),
          );
        else
          display.append(
            element(
              "p",
              "Choose an image to open NiiVue. Scroll over a slice to move through it; drag to adjust the view.",
              "muted",
            ),
          );
        const unavailable = files.filter((f) => !f.preview_available && !f.fetch_available);
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
        const all = await get<Artifact[]>(`artifacts?${query}&limit=1000`);
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
    for (const [label, action] of [
      ["Images & reports", showFiles],
      [
        "Evidence",
        () => {
          viewGeneration++;
          showEvidence();
        },
      ],
      ["Files & provenance", showIndexedFiles],
    ] as const) {
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
    (navigation.firstElementChild as HTMLButtonElement).click();
  }
  private load = 0;
  private async preview(
    file: Artifact,
    display: HTMLElement,
    generation: number,
    overlays: Artifact[] = [],
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
      const viewer = await viewFile(canvas, file.id, file.path, overlays);
      if (
        generation !== this.generation ||
        load !== this.load ||
        !frame.isConnected
      )
        viewer.cleanup();
      else {
        this.viewer = viewer;
        status.textContent = file.path.split("/").pop()!;
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
      const data = await get<Lineage>(`artifacts/${id}/lineage`);
      if (generation !== this.generation || load !== this.load) return;
      display.replaceChildren(
        element("h3", "File provenance"),
        details(data.artifact),
      );
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
        display.append(button);
      }
      for (const attempt of data.attempts) {
        const block = element("details");
        block.append(
          element("summary", "Transformation record"),
          details(attempt),
        );
        display.append(block);
      }
    } catch (error) {
      if (generation === this.generation && load === this.load)
        display.replaceChildren(element("p", String(error), "gap"));
    }
  }
}
