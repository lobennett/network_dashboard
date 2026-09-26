/** Offer comparisons only for uniquely matched, accessible files. */
export type PresetFile = {
  id: string;
  path: string;
  dataset_id: string;
  preview_available?: boolean;
  fetch_available?: boolean;
};
export type ViewerPreset = {
  label: string;
  description: string;
  base: PresetFile;
  overlays: PresetFile[];
  mode: "ribbon" | "surfaces" | "fieldmap" | "registration";
};
const entity = (path: string, key: string) =>
  path.split("/").pop()?.match(new RegExp(`(?:^|_)${key}-([^_]+)`))?.[1];

export function viewerPresets(files: PresetFile[]): ViewerPreset[] {
  const available = [...new Map(files.filter(f => f.preview_available || f.fetch_available).map(f => [f.id, f])).values()];
  const presets: ViewerPreset[] = [];
  function pair(base: PresetFile, match: (file: PresetFile) => boolean,
                label: string, description: string, mode: ViewerPreset["mode"]) {
    if (available.filter(f => f.dataset_id === base.dataset_id && f.path === base.path).length !== 1) return;
    const matches = available.filter(f => f.dataset_id === base.dataset_id && match(f));
    if (matches.length === 1) presets.push({label, description, base, overlays: matches, mode});
  }
  for (const base of available) {
    if (base.path.endsWith("/mri/norm.mgz"))
      pair(base, f => f.path === base.path.replace(/norm\.mgz$/, "ribbon.mgz"),
        "Ribbon over anatomy", "Gray anatomy with white matter and cortical ribbon labels. Adjust overlay opacity to inspect the boundary.", "ribbon");
    if (/\/surf\/(lh|rh)\.white$/.test(base.path))
      pair(base, f => f.path === base.path.replace(/\.white$/, ".pial"),
        `${base.path.endsWith("lh.white") ? "Left" : "Right"} white and pial surfaces`,
        "Blue: white surface. Orange: pial surface. Adjust pial opacity to inspect both boundaries.", "surfaces");
    if (/_magnitude\d*\.nii(?:\.gz)?$/.test(base.path))
      pair(base, f => f.path === base.path.replace(/_magnitude\d*(\.nii(?:\.gz)?)$/, "_fieldmap$1"),
        "Fieldmap over magnitude", "Grayscale magnitude with the fieldmap in color. Inspect coverage and correspondence.", "fieldmap");
    if (/_space-T1w_.*boldref\.nii(?:\.gz)?$/.test(base.path)) {
      const subject = entity(base.path, "sub"), session = entity(base.path, "ses");
      if (!subject) continue;
      // fMRIPrep T1w-space references belong with its native preprocessed T1w.
      const matches = available.filter(f => f.dataset_id === base.dataset_id &&
        entity(f.path, "sub") === subject &&
        (!entity(f.path, "ses") || entity(f.path, "ses") === session) &&
        (!entity(f.path, "space") || entity(f.path, "space") === "T1w") &&
        /_desc-preproc_T1w\.nii(?:\.gz)?$/.test(f.path));
      if (matches.length === 1 && available.filter(f => f.dataset_id === base.dataset_id && f.path === base.path).length === 1)
        presets.push({label:"BOLD reference over anatomy", description:"Grayscale preprocessed T1w with the T1w-space BOLD reference in color. Inspect registration without loading the full timeseries.",
          base:matches[0], overlays:[base], mode:"registration"});
    }
  }
  return presets;
}
