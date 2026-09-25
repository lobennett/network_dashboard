import { expect, it } from "vitest";
import { surfaceGroup, surfaceLabel } from "./surface-groups";
it("separates anatomy, segmentations, true meshes, and auxiliary files", () => {
  expect(surfaceGroup("subjects/sub-s03/mri/norm.mgz")).toBe("Anatomy");
  expect(surfaceGroup("subjects/sub-s03/mri/ribbon.mgz")).toBe("Segmentations");
  expect(surfaceGroup("subjects/sub-s03/surf/lh.pial")).toBe(
    "Cortical surfaces",
  );
  expect(surfaceGroup("subjects/sub-s03/surf/lh.area.pial")).toBe(
    "Other outputs",
  );
  expect(surfaceGroup("subjects/sub-s03/mri/transforms/warp.nii.gz")).toBe(
    "Other outputs",
  );
  expect(surfaceLabel("subjects/sub-s03/surf/rh.white")).toBe(
    "Right white boundary",
  );
});
