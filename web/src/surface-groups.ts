const anatomy: Record<string, string> = {
  "norm.mgz": "Normalized T1",
  "T1.mgz": "T1 reconstruction",
  "T2.mgz": "Registered T2",
  "T2.norm.mgz": "Normalized T2",
  "brain.mgz": "Brain",
  "brainmask.mgz": "Brain mask",
};
const segments: Record<string, string> = {
  "ribbon.mgz": "Cortical ribbon",
  "lh.ribbon.mgz": "Left cortical ribbon",
  "rh.ribbon.mgz": "Right cortical ribbon",
  "aseg.mgz": "Anatomical segmentation",
  "wm.mgz": "White matter",
  "wmparc.mgz": "White-matter parcellation",
  "aparc+aseg.mgz": "Cortical and subcortical labels",
  "aparc.DKTatlas+aseg.mgz": "DKT atlas labels",
  "aparc.a2009s+aseg.mgz": "Destrieux atlas labels",
};
export function surfaceGroup(path: string): string {
  const name = path.split("/").pop()!;
  if (/\/surf\/(lh|rh)\.(white|pial|inflated)$/.test(path))
    return "Cortical surfaces";
  if (anatomy[name]) return "Anatomy";
  if (segments[name]) return "Segmentations";
  return "Other outputs";
}
export function surfaceLabel(path: string): string {
  const name = path.split("/").pop()!;
  const match = name.match(/^(lh|rh)\.(white|pial|inflated)$/);
  if (match)
    return `${match[1] === "lh" ? "Left" : "Right"} ${{ white: "white boundary", pial: "pial boundary", inflated: "inflated surface" }[match[2]]}`;
  return anatomy[name] ?? segments[name] ?? name;
}
