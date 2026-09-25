/** Sentence case for interface labels; filenames and recorded identifiers stay literal. */
const labels: Record<string, string> = {
  fd_mean: "Mean FD",
  fd_perc: "Frames above the FD threshold (%)",
  fd_thres: "FD threshold (mm)",
  dvars_std: "Standardized DVARS",
  tr_count: "Current volume count",
  original_tr_count: "Original volume count",
  task_first_level: "First-level task models",
  mriqc: "MRIQC",
  freesurfer: "FreeSurfer",
  fmriprep: "fMRIPrep",
  fmriprepviz: "fmriprepviz",
  bids: "BIDS",
  NTestTrialsExpected: "Test trials before timing correction",
  NTestTrialsRetained: "Test trials after timing correction",
  FractionTestTrialsDropped: "Fraction lost to timing correction",
  NScanTestTrialsDropped: "Trials outside scan duration",
  FractionScanTestTrialsDropped: "Fraction outside scan duration",
  ScanDurationSeconds: "Scan duration (s)",
};
export function label(value: unknown): string {
  const raw = String(value ?? "Unrecorded");
  if (labels[raw]) return labels[raw];
  const text = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(
      /\b(fd|tr|dvars|bids|json|tsv|csv|id|qc|bold|t1w|t2w)\b/gi,
      (x) => ({ t1w: "T1w", t2w: "T2w" })[x.toLowerCase()] ?? x.toUpperCase(),
    );
  return text.charAt(0).toUpperCase() + text.slice(1);
}
