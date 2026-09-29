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
import { PROJECTILE_IDS, WEAPON_IDS, getWeapon } from '@sandline/shared';

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

  it('shows exactly the held model and puts the trigger hand on its grip', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    for (const id of IDS) {
      rig.setHeld(id);
      rig.hold({ pitch: 0.2, weight: 1 });
      expect(rig.held).toBe(id);
      const shown = rig.aim.children.filter((c) => c.visible);
      expect(shown.length).toBe(1);
      expect(shown[0]!.name).toBe(id === 'carbine' ? 'rifle' : `weapon ${id}`);
      const spec = createWeaponModel(id).spec;
      rig.root.updateMatrixWorld(true);
      const gripWorld = new THREE.Vector3(...spec.gripRight).applyMatrix4(rig.aim.matrixWorld);
      // The trigger hand: the right, or the left on a left-handed gun (U-042).
      const trigger = spec.handed === 'left' ? 'hand-left' : 'hand-right';
      // The hand bone is the wrist; the glove box hangs a hand's length off it.
      expect(worldOf(rig, rig.bone(trigger)!).distanceTo(gripWorld)).toBeLessThan(0.05);
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

  it('a left-handed rifle takes the left hand to the pistol grip and the right to the fore-end (U-042)', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    rig.setHeld('sniper-bolt-left');
    rig.hold({ pitch: 0, weight: 1 });
    rig.root.updateMatrixWorld(true);
    const spec = createWeaponModel('sniper-bolt-left').spec;
    expect(spec.handed).toBe('left');
    const at = (g: [number, number, number]) => new THREE.Vector3(...g).applyMatrix4(rig.aim.matrixWorld);
    const dist = (hand: 'hand-left' | 'hand-right', g: [number, number, number]) => worldOf(rig, rig.bone(hand)!).distanceTo(at(g));
    // Each hand is nearer its own grip than the other hand's: left on the trigger grip, right on the fore-end.
    expect(dist('hand-left', spec.gripRight)).toBeLessThan(dist('hand-right', spec.gripRight));
    expect(dist('hand-right', spec.gripLeft)).toBeLessThan(dist('hand-left', spec.gripLeft));
    // And a right-handed rifle does the opposite.
    rig.setHeld('marksman');
    rig.hold({ pitch: 0, weight: 1 });
    rig.root.updateMatrixWorld(true);
    const rifle = createWeaponModel('marksman').spec;
    expect(dist('hand-right', rifle.gripRight)).toBeLessThan(dist('hand-left', rifle.gripRight));
  });

  it('only the bolt-action sniper is left-handed, and the data agrees with the model (U-042)', () => {
    for (const id of WEAPON_IDS) {
      expect(createWeaponModel(id).spec.handed === 'left', id).toBe(getWeapon(id).handedness === 'left');
    }
  });

  it('is ignored by the grey box, which only ever holds its box rifle', () => {
    const rig = requireRig(createHumanoidPlaceholder('remote'));
    rig.setHeld('frag');
    expect(rig.held).toBe('carbine');
  });
});
