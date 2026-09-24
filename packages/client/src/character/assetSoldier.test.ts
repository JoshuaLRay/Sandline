/**
 * The detailed skin on the live rig (T-4.08), headless. The skin here is a
 * small stand-in built with the real soldier's layout (the rig's bones, two
 * material groups); the generated soldier itself is checked by the tools'
 * tests, and loaded on a GPU in `loader.browser.test.ts`. What is checked is
 * the contract: the swap changes the skin and nothing the rig owns.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DETAILED_SOLDIER_ASSET, accentMaterial, detailedSkinFromArrays, provideDetailedSkin } from './assetSoldier.ts';
import { HUMANOID_BONES, requireRig } from './humanoidRig.ts';
import { HUMANOID_ROOT_LIFT_M } from './humanoidPlaceholder.ts';
import { JOINTS, createHumanoidSoldier, disposeSoldier, setSoldierPalette, soldierSkin } from './humanoidSoldier.ts';
import { createLocomotionPoseDriver } from './locomotionPose.ts';
import { PALETTES } from './soldierTexture.ts';

/** One small quad round every joint, weighted to its bone; the last two triangles are the accent. */
function standIn() {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const body: number[] = [];
  const accent: number[] = [];
  HUMANOID_BONES.forEach((name, b) => {
    const [x, y, z] = JOINTS[name];
    const base = positions.length / 3;
    for (const [dx, dy] of [[-0.03, 0.03], [0.03, 0.03], [0.03, -0.03], [-0.03, -0.03]] as const) {
      positions.push(x + dx, y + dy, z + 0.05);
      normals.push(0, 0, 1);
      uvs.push(0.5, 0.5);
      joints.push(b, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
    (b === HUMANOID_BONES.length - 1 ? accent : body).push(base, base + 3, base + 2, base, base + 2, base + 1);
  });
  return detailedSkinFromArrays({ positions, normals, uvs, joints, weights, indices: [body, accent] });
}

const snapshot = (root: THREE.Object3D) =>
  HUMANOID_BONES.map((n) => {
    const b = requireRig(root).bone(n)!;
    return [...b.position.toArray(), ...b.quaternion.toArray()];
  });

describe('the detailed soldier on the live rig (T-4.08)', () => {
  afterEach(() => provideDetailedSkin(null));

  it('swaps onto a squad soldier: the shared geometry, the atlas and the slot’s marking; the rig untouched', () => {
    const skin = standIn();
    const a = createHumanoidSoldier('local');
    const b = createHumanoidSoldier('remote');
    const bonesBefore = snapshot(a);
    const skeleton = soldierSkin(a).skeleton;
    provideDetailedSkin(skin);
    setSoldierPalette(a, 'slot-1');
    setSoldierPalette(b, 'slot-2');
    expect(soldierSkin(a).geometry).toBe(skin.geometry);
    expect(soldierSkin(b).geometry).toBe(skin.geometry);
    expect(soldierSkin(a).material).toEqual([skin.material, accentMaterial('slot-1')]);
    expect(accentMaterial('slot-1').color.getHexString()).toBe(new THREE.Color(PALETTES['slot-1'].accent).getHexString());
    expect((soldierSkin(b).material as THREE.Material[])[1]).toBe(accentMaterial('slot-2'));
    expect(soldierSkin(a).skeleton).toBe(skeleton);
    expect(snapshot(a)).toEqual(bonesBefore);
    expect(skin.material.name).toBe(DETAILED_SOLDIER_ASSET);
  });

  it('a slot changing hands changes the marking and nothing else (ADR-001)', () => {
    provideDetailedSkin(standIn());
    const s = createHumanoidSoldier('remote');
    setSoldierPalette(s, 'bot');
    const geometry = soldierSkin(s).geometry;
    requireRig(s).setPose('crouched');
    const bones = snapshot(s);
    setSoldierPalette(s, 'slot-4');
    expect(soldierSkin(s).geometry).toBe(geometry);
    expect((soldierSkin(s).material as THREE.Material[])[1]).toBe(accentMaterial('slot-4'));
    expect(snapshot(s)).toEqual(bones);
    expect(requireRig(s).pose).toBe('crouched');
  });

  it('leaves an enemy in the code-built skin, and takes a soldier back to it when it becomes one', () => {
    const skin = standIn();
    provideDetailedSkin(skin);
    const s = createHumanoidSoldier('remote');
    const code = soldierSkin(s).geometry;
    setSoldierPalette(s, 'enemy');
    expect(soldierSkin(s).geometry).toBe(code);
    setSoldierPalette(s, 'slot-3');
    expect(soldierSkin(s).geometry).toBe(skin.geometry);
    setSoldierPalette(s, 'enemy');
    expect(soldierSkin(s).geometry).toBe(code);
    expect(Array.isArray(soldierSkin(s).material)).toBe(false);
  });

  it('skins to the bones: a crouch carries the head’s vertices down with the head', () => {
    const skin = standIn();
    provideDetailedSkin(skin);
    const s = createHumanoidSoldier('local');
    setSoldierPalette(s, 'local');
    const mesh = soldierSkin(s);
    const head = HUMANOID_BONES.indexOf('head') * 4;
    const at = () => {
      s.updateMatrixWorld(true);
      mesh.skeleton.update();
      return mesh.applyBoneTransform(head, new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute, head));
    };
    const standing = at();
    // At rest the skin is exactly its authored geometry: the bind pose is the rig's.
    expect(standing.y).toBeCloseTo(mesh.geometry.getAttribute('position').getY(head), 6);
    requireRig(s).setPose('crouched');
    expect(at().y).toBeLessThan(standing.y - 0.35);
    requireRig(s).setPose('standing');
    expect(at().y).toBeCloseTo(standing.y, 9);
  });

  it('keeps the rig contract: hands on the rifle in every pose, a gait that comes back to rest', () => {
    provideDetailedSkin(standIn());
    const s = createHumanoidSoldier('local');
    setSoldierPalette(s, 'local');
    s.position.set(0, HUMANOID_ROOT_LIFT_M, 0);
    const rig = requireRig(s);
    for (const pose of ['standing', 'crouched', 'prone'] as const) {
      rig.setPose(pose);
      s.updateMatrixWorld(true);
      const aim = new THREE.Vector3().setFromMatrixPosition(rig.aim.matrixWorld);
      expect(new THREE.Vector3().setFromMatrixPosition(rig.bone('hand-right')!.matrixWorld).distanceTo(aim)).toBeLessThan(0.3);
    }
    rig.setPose('standing');
    const rest = snapshot(s);
    const driver = createLocomotionPoseDriver(rig);
    const walk = { state: 'walk', direction: 'forward', speed: 4.2, normalizedSpeed: 1, gaitRate: 1, airborne: false, directionAngle: 0, vaultProgress: 0 } as const;
    for (let i = 0; i < 30; i++) driver.update(walk, 1 / 60);
    expect(snapshot(s)).not.toEqual(rest);
    driver.update({ ...walk, state: 'idle', speed: 0, normalizedSpeed: 0, gaitRate: 0 }, 1 / 60);
    expect(snapshot(s)).toEqual(rest);
  });

  it('frees a despawned soldier’s own skin, never the shared detailed one', () => {
    const skin = standIn();
    provideDetailedSkin(skin);
    const s = createHumanoidSoldier('remote');
    const code = soldierSkin(s).geometry;
    setSoldierPalette(s, 'slot-5');
    let shared = 0;
    let own = 0;
    skin.geometry.addEventListener('dispose', () => shared++);
    code.addEventListener('dispose', () => own++);
    disposeSoldier(s);
    expect(shared).toBe(0);
    expect(own).toBe(1);
  });
});
