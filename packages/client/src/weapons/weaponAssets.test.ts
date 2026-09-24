/**
 * The generated weapons on the rig and in the hands (T-4.36), headless, with
 * stand-in templates: once provided, every item is drawn as its side's
 * model, the hold is the code builder's exactly, and a soldier who changes
 * side or whose weapons arrive rebuilds what it holds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { requireRig } from '../character/humanoidRig.ts';
import { createHumanoidSoldier, setSoldierPalette } from '../character/humanoidSoldier.ts';
import { createWeaponModel, hasWeaponAsset, provideWeaponAssets, weaponAssetId, weaponAssetsVersion } from './weaponModels.ts';

const KEYS = ['m4', 'dmr', 'shotgun', 'pistol', 'm67', 'at4', 'm249', 'ak', 'pkm', 'rpg7'];

function templates(): Map<string, THREE.Object3D> {
  const shared = new THREE.MeshLambertMaterial();
  return new Map(
    KEYS.map((k) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), shared);
      mesh.name = `generated ${k}`;
      return [`weapon-${k}`, mesh] as const;
    }),
  );
}

/** The generated meshes actually drawn under `o`: visible, and every ancestor visible too. */
const drawn = (o: THREE.Object3D): string[] => {
  const names: string[] = [];
  o.traverseVisible((c) => {
    if (c instanceof THREE.Mesh && c.name.startsWith('generated')) names.push(c.name);
  });
  return names;
};

describe('the period weapons in the hands (T-4.36)', () => {
  afterEach(() => provideWeaponAssets(new Map()));

  it('draws the code-built model until the generated ones are provided, and the generated one after', () => {
    expect(hasWeaponAsset('carbine', 'squad')).toBe(false);
    const before = createWeaponModel('carbine');
    expect(drawn(before.object)).toEqual([]);
    const version = weaponAssetsVersion();
    const t = templates();
    provideWeaponAssets(t);
    expect(weaponAssetsVersion()).toBe(version + 1);
    const after = createWeaponModel('carbine');
    expect(drawn(after.object)).toEqual(['generated m4']);
    // The hold is the code builder's, exactly: the IK, the viewmodel and the muzzle rig do not move.
    expect(after.spec).toEqual(before.spec);
    // A clone that shares its geometry and material with every other.
    const mesh = after.object.getObjectByName('generated m4') as THREE.Mesh;
    expect(mesh.geometry).toBe((t.get('weapon-m4') as THREE.Mesh).geometry);
    expect(mesh).not.toBe(t.get('weapon-m4'));
  });

  it('draws the enemy’s own models for what it carries, and the squad’s for the rest', () => {
    provideWeaponAssets(templates());
    expect(drawn(createWeaponModel('carbine', 'enemy').object)).toEqual(['generated ak']);
    expect(drawn(createWeaponModel('lmg', 'enemy').object)).toEqual(['generated pkm']);
    expect(drawn(createWeaponModel('rocket', 'enemy').object)).toEqual(['generated rpg7']);
    expect(drawn(createWeaponModel('lmg', 'squad').object)).toEqual(['generated m249']);
    expect(weaponAssetId('frag', 'enemy')).toBe('weapon-m67');
  });

  it('on the rig: the carbine becomes the M4 when the weapons arrive, and an enemy holds an AK', () => {
    const squad = createHumanoidSoldier('local');
    const rig = requireRig(squad);
    rig.setHeld('carbine');
    expect(drawn(rig.aim)).toEqual([]);
    expect(rig.aim.getObjectByName('rifle')!.visible).toBe(true);
    provideWeaponAssets(templates());
    rig.setHeld('carbine');
    expect(rig.held).toBe('carbine');
    expect(drawn(rig.aim)).toEqual(['generated m4']);
    expect(rig.aim.getObjectByName('rifle')!.visible).toBe(false);

    const enemy = createHumanoidSoldier('remote');
    setSoldierPalette(enemy, 'enemy');
    requireRig(enemy).setHeld('carbine');
    expect(drawn(requireRig(enemy).aim)).toEqual(['generated ak']);
    // A soldier that changes side changes what it holds on the next hold.
    setSoldierPalette(enemy, 'slot-2');
    requireRig(enemy).setHeld('carbine');
    expect(drawn(requireRig(enemy).aim)).toEqual(['generated m4']);
  });

  it('puts the hands on the same grips as the code-built model', () => {
    const a = requireRig(createHumanoidSoldier('local'));
    a.setHeld('breacher');
    a.hold({ pitch: 0.1, weight: 1 });
    a.root.updateMatrixWorld(true);
    const handBefore = new THREE.Vector3().setFromMatrixPosition(a.bone('hand-right')!.matrixWorld);
    provideWeaponAssets(templates());
    const b = requireRig(createHumanoidSoldier('local'));
    b.setHeld('breacher');
    b.hold({ pitch: 0.1, weight: 1 });
    b.root.updateMatrixWorld(true);
    expect(new THREE.Vector3().setFromMatrixPosition(b.bone('hand-right')!.matrixWorld).distanceTo(handBefore)).toBeLessThan(1e-9);
  });
});
