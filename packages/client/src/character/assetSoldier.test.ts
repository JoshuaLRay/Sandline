/**
 * The detailed skin on the live rig (T-4.08), headless. The skin here is a
 * small stand-in built with the real soldier's layout (the rig's bones, two
 * material groups); the generated soldier itself is checked by the tools'
 * tests, and loaded on a GPU in `loader.browser.test.ts`. What is checked is
 * the contract: the swap changes the skin and nothing the rig owns.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DETAILED_SOLDIER_ASSET,
  FIGHTER_PARTS,
  FIGHTER_VARIANTS,
  type FighterSkin,
  accentMaterial,
  detailedSkinFromArrays,
  fighterMaterials,
  fighterVariantFor,
  parseFighterLook,
  provideDetailedSkin,
  provideFighterSkin,
} from './assetSoldier.ts';
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

  it('leaves an enemy in the code-built skin until the fighter loads, and takes a soldier back to it when it becomes one', () => {
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

/** A fighter stand-in: the stand-in soldier's quads, one group a part in `FIGHTER_PARTS` order. */
function fighterStandIn(): FighterSkin {
  const soldier = standIn();
  const geometry = soldier.geometry.clone();
  geometry.clearGroups();
  const count = geometry.index!.count;
  const per = Math.floor(count / 3 / FIGHTER_PARTS.length) * 3;
  FIGHTER_PARTS.forEach((_, i) => geometry.addGroup(i * per, i === FIGHTER_PARTS.length - 1 ? count - i * per : per, i));
  const material = new THREE.MeshLambertMaterial();
  material.name = 'fighter';
  return { geometry, material };
}

describe('the enemy fighter on the live rig (T-4.35)', () => {
  afterEach(() => {
    provideFighterSkin(null);
    provideDetailedSkin(null);
  });

  it('dresses every enemy as the fighter, and no squad soldier; the rig untouched', () => {
    const fighter = fighterStandIn();
    provideFighterSkin(fighter);
    provideDetailedSkin(standIn());
    const enemy = createHumanoidSoldier('remote');
    const squad = createHumanoidSoldier('remote');
    const skeleton = soldierSkin(enemy).skeleton;
    const bones = snapshot(enemy);
    setSoldierPalette(enemy, 'enemy', { variant: 0 });
    setSoldierPalette(squad, 'slot-2');
    expect(soldierSkin(enemy).geometry).toBe(fighter.geometry);
    expect(soldierSkin(squad).geometry).not.toBe(fighter.geometry);
    expect(soldierSkin(enemy).skeleton).toBe(skeleton);
    expect(snapshot(enemy)).toEqual(bones);
    // A soldier changing sides changes clothes and nothing else.
    setSoldierPalette(squad, 'enemy', { variant: 1 });
    expect(soldierSkin(squad).geometry).toBe(fighter.geometry);
  });

  it('wears one headgear or the other by variant, tinted by the variant, and the bandolier on the gunner only', () => {
    provideFighterSkin(fighterStandIn());
    const pakol = FIGHTER_VARIANTS.findIndex((v) => v.headgear === 'pakol');
    const turban = FIGHTER_VARIANTS.findIndex((v) => v.headgear === 'turban');
    const shown = (m: THREE.Material | undefined) => m?.visible ?? false;
    const [body, cloth, p, t, band] = fighterMaterials(pakol, false);
    expect([body, cloth, p, t, band].map(shown)).toEqual([true, true, true, false, false]);
    expect((cloth as THREE.MeshLambertMaterial).color.getHexString()).toBe(new THREE.Color(FIGHTER_VARIANTS[pakol]!.cloth).getHexString());
    expect((p as THREE.MeshLambertMaterial).color.getHexString()).toBe(new THREE.Color(FIGHTER_VARIANTS[pakol]!.head).getHexString());
    expect(fighterMaterials(turban, false).map(shown)).toEqual([true, true, false, true, false]);
    expect(fighterMaterials(turban, true).map(shown)).toEqual([true, true, false, true, true]);
    // Shared by every fighter who looks the same: no material a fighter.
    expect(fighterMaterials(turban, true)).toBe(fighterMaterials(turban, true));
    // And one texture for them all.
    const enemy = createHumanoidSoldier('remote');
    setSoldierPalette(enemy, 'enemy', { variant: turban, gunner: true });
    expect(soldierSkin(enemy).material).toBe(fighterMaterials(turban, true));
  });

  it('keeps a fighter’s variant for its life, and spreads a group across the variants', () => {
    expect(fighterVariantFor(40)).toBe(fighterVariantFor(40));
    const seen = new Set(Array.from({ length: 12 }, (_, i) => fighterVariantFor(1000 + i)));
    expect(seen.size).toBe(FIGHTER_VARIANTS.length);
    expect(FIGHTER_VARIANTS.some((v) => v.headgear === 'pakol') && FIGHTER_VARIANTS.some((v) => v.headgear === 'turban')).toBe(true);
    for (const n of [-7, 0, 123456]) expect(fighterVariantFor(n)).toBeGreaterThanOrEqual(0);
  });

  it('refuses a look file with a headgear or a colour it cannot draw', () => {
    expect(() => parseFighterLook({ variants: [] })).toThrow(/non-empty/);
    expect(() => parseFighterLook({ variants: [{ headgear: 'helmet', cloth: '#aabbcc', head: '#aabbcc' }] })).toThrow(/headgear/);
    expect(() => parseFighterLook({ variants: [{ headgear: 'pakol', cloth: 'tan', head: '#aabbcc' }] })).toThrow(/cloth/);
  });

  it('frees a despawned fighter’s own skin, never the shared fighter', () => {
    const fighter = fighterStandIn();
    provideFighterSkin(fighter);
    const s = createHumanoidSoldier('remote');
    const code = soldierSkin(s).geometry;
    setSoldierPalette(s, 'enemy');
    let shared = 0;
    let own = 0;
    fighter.geometry.addEventListener('dispose', () => shared++);
    code.addEventListener('dispose', () => own++);
    disposeSoldier(s);
    expect(shared).toBe(0);
    expect(own).toBe(1);
  });
});
