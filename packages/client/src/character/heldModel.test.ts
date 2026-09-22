/**
 * What is in the hands (`setHeld`): the rig swaps the model on its aim
 * attachment and the hands go to that model's grips; the carbine is the
 * rig's own textured rifle and comes back exactly.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_BONES, type HumanoidRig, requireRig } from './humanoidRig.ts';
import { createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { createHumanoidSoldier } from './humanoidSoldier.ts';
import { createWeaponModel, hasWeaponModel } from '../weapons/weaponModels.ts';
import { PROJECTILE_IDS, WEAPON_IDS } from '@sandline/shared';

const IDS = [...WEAPON_IDS, ...PROJECTILE_IDS];

function visibleMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    if (o instanceof THREE.Mesh && o !== root) out.push(o);
    for (const child of o.children) walk(child);
  };
  walk(root);
  return out;
}

function worldOf(rig: HumanoidRig, node: THREE.Object3D): THREE.Vector3 {
  rig.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}

function arms(rig: HumanoidRig): number[][] {
  return (['upper-arm-left', 'lower-arm-left', 'upper-arm-right', 'lower-arm-right'] as const).map((n) =>
    rig.bone(n)!.quaternion.toArray(),
  );
}

describe('weapon models', () => {
  it('has one for every weapon and pouch item in the data', () => {
    for (const id of IDS) expect(hasWeaponModel(id)).toBe(true);
  });

  it('holds an unknown id as a carbine rather than as nothing', () => {
    const model = createWeaponModel('no-such-gun');
    expect(model.id).toBe('carbine');
    expect(model.object.children.length).toBeGreaterThan(0);
  });
});

describe('setHeld on the skinned soldier', () => {
  it('starts on the carbine and builds nothing else until asked', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    expect(rig.held).toBe('carbine');
    expect(rig.aim.children.length).toBe(1);
  });

  it('shows exactly the held model and puts the right hand on its grip', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    for (const id of IDS) {
      rig.setHeld(id);
      rig.hold({ pitch: 0.2, weight: 1 });
      expect(rig.held).toBe(id);
      const shown = rig.aim.children.filter((c) => c.visible);
      expect(shown.length).toBe(1);
      expect(shown[0]!.name).toBe(id === 'carbine' ? 'rifle' : `weapon ${id}`);
      const grip = createWeaponModel(id).spec.gripRight;
      rig.root.updateMatrixWorld(true);
      const gripWorld = new THREE.Vector3(...grip).applyMatrix4(rig.aim.matrixWorld);
      // The hand bone is the wrist; the glove box hangs a hand's length off it.
      expect(worldOf(rig, rig.bone('hand-right')!).distanceTo(gripWorld)).toBeLessThan(0.05);
    }
  });

  it('comes back to the carbine bit for bit', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    rig.hold({ pitch: 0.3, weight: 1 });
    const before = arms(rig);
    rig.setHeld('rocket');
    rig.hold({ pitch: 0.3, weight: 1 });
    expect(arms(rig)).not.toEqual(before);
    rig.setHeld('carbine');
    rig.hold({ pitch: 0.3, weight: 1 });
    expect(arms(rig)).toEqual(before);
    expect(visibleMeshes(rig.root).length).toBe(2);
    for (const name of HUMANOID_BONES) expect(rig.bone(name)).not.toBeNull();
  });

  it('is ignored by the grey box, which only ever holds its box rifle', () => {
    const rig = requireRig(createHumanoidPlaceholder('remote'));
    rig.setHeld('frag');
    expect(rig.held).toBe('carbine');
  });
});
