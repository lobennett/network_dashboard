import { expect, it } from "vitest";
import { viewerPresets } from "./viewer-presets";
const file = (id: string, path: string, dataset_id = "dataset") => ({id,path,dataset_id,preview_available:true});
it("pairs ribbon and surfaces only within the same reconstruction and hemisphere", () => {
  const files=[file("norm","subjects/sub-s03/mri/norm.mgz"), file("ribbon","subjects/sub-s03/mri/ribbon.mgz"),
    file("white","subjects/sub-s03/surf/lh.white"),file("pial","subjects/sub-s03/surf/lh.pial"),
    file("other","subjects/sub-s03/surf/rh.pial"),file("foreign","subjects/sub-s03/mri/ribbon.mgz","old")];
  const presets=viewerPresets(files);
  expect(presets.map(p=>p.label)).toEqual(["Ribbon over anatomy","Left white and pial surfaces"]);
  expect(presets[0].overlays.map(f=>f.id)).toEqual(["ribbon"]);
});
it("does not pair unavailable, ambiguous or mismatched files", () => {
  const magnitude=file("mag","sub-s03/ses-01/fmap/sub-s03_ses-01_run-1_magnitude.nii.gz");
  const fieldmap=file("map",magnitude.path.replace("_magnitude","_fieldmap"));
  expect(viewerPresets([magnitude,fieldmap])[0].overlays[0].id).toBe("map");
  expect(viewerPresets([magnitude,{...fieldmap,preview_available:false}])).toEqual([]);
  expect(viewerPresets([magnitude,fieldmap,{...fieldmap,id:"duplicate"}])).toEqual([]);
  expect(viewerPresets([magnitude,{...fieldmap,path:fieldmap.path.replaceAll("ses-01","ses-02")}])).toEqual([]);
});
it("requires a same-dataset T1w-space BOLD reference and native anatomical image", () => {
  const bold=file("bold","sub-s03/ses-01/func/sub-s03_ses-01_task-rest_space-T1w_boldref.nii.gz");
  const anat=file("anat","sub-s03/anat/sub-s03_desc-preproc_T1w.nii.gz");
  expect(viewerPresets([bold,anat])[0].base.id).toBe("anat");
  expect(viewerPresets([bold,{...anat,dataset_id:"other"}])).toEqual([]);
  expect(viewerPresets([{...bold,path:bold.path.replace("space-T1w","space-MNI152")},anat])).toEqual([]);
});
