import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { clothDisplacement, clothShade, type Garment } from "./garments.ts";
import { buildDetailedSoldier } from "./soldier.ts";
import {
  detailedSkinFromArrays,
  provideDetailedSkin,
} from "../../../../client/src/character/assetSoldier.ts";
import {
  createHumanoidSoldier,
  setSoldierPalette,
  soldierSkin,
} from "../../../../client/src/character/humanoidSoldier.ts";
import { requireRig } from "../../../../client/src/character/humanoidRig.ts";
import { HUMANOID_ROOT_LIFT_M } from "../../../../client/src/character/humanoidPlaceholder.ts";

afterEach(() => provideDetailedSkin(null));
describe("garment and equipment regression checks", () => {
  it("keeps fold fields continuous across the wrap seam and their shadows on the same creases", () => {
    for (const [kind, height] of [
      ["sleeve", 1.18],
      ["trousers", 0.5],
      ["blouse", 1.1],
    ] as [Garment, number][]) {
      expect(clothDisplacement(kind, 0, height)).toBeCloseTo(
        clothDisplacement(kind, 1, height),
        10,
      );
      for (let i = 0; i < 40; i++) {
        const t = i / 40;
        const slope =
          (clothDisplacement(kind, t, height + 0.002) -
            clothDisplacement(kind, t, height - 0.002)) /
          0.004;
        const shading = clothShade(kind, t, height);
        if (slope > 0.1) expect(shading).toBeLessThan(1);
        if (slope < -0.1) expect(shading).toBeGreaterThan(1);
        expect(shading).toBeGreaterThanOrEqual(0.64);
      }
    }
  });
  it("keeps the actual layered soldier grounded and below cover height in its low crouch", () => {
    provideDetailedSkin(detailedSkinFromArrays(buildDetailedSoldier()));
    const root = createHumanoidSoldier("remote");
    root.position.y = HUMANOID_ROOT_LIFT_M;
    setSoldierPalette(root, "slot-1");
    const rig = requireRig(root);
    rig.setPose("crouched");
    root.updateMatrixWorld(true);
    const skin = soldierSkin(root);
    skin.skeleton.update();
    const position = skin.geometry.getAttribute("position");
    let low = Infinity,
      high = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const p = skin
        .applyBoneTransform(
          i,
          new THREE.Vector3().fromBufferAttribute(position, i),
        )
        .applyMatrix4(skin.matrixWorld);
      low = Math.min(low, p.y);
      high = Math.max(high, p.y);
    }
    expect(low).toBeGreaterThan(-0.07);
    // Existing rig helmet reaches roughly 1.27 m; equipment must not raise it.
    expect(high).toBeLessThan(1.3);
    const left = rig
      .bone("lower-leg-left")!
      .getWorldPosition(new THREE.Vector3());
    const right = rig
      .bone("lower-leg-right")!
      .getWorldPosition(new THREE.Vector3());
    expect(left.y - right.y).toBeGreaterThan(0.06);
  });
});
