import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { classById, type SupplyCacheDef, type WorldBox } from '@sandline/shared';
import { SUPPLY_FIXTURES, SUPPLY_FIXTURE_INVENTORY } from './supplyFixtures.ts';
import { supplyChoiceModel, supplyInReach } from './supplyModel.ts';
import { SupplyModels } from '../weapons/supplyModels.ts';

const capacity = classById('brennan')!;

describe('cache presentation previews and scenery (U-134)', () => {
  it('offers one type at a time, shows capacity limits and preserves exact partial stock', () => {
    const before = structuredClone(SUPPLY_FIXTURES);
    const cache = { ...SUPPLY_FIXTURES[0]!, stock: { ...SUPPLY_FIXTURES[0]!.stock, primaryAmmoUnits: 13200 } };
    const view = supplyChoiceModel(cache, SUPPLY_FIXTURE_INVENTORY, capacity, [], 1);
    expect(view.choices.map(row => [row.item.kind, row.detail])).toEqual([
      ['projectile', 'Take 2'], ['health-kit', 'Take 1 kit charge'], ['primary-ammo', 'Take 15 rounds'],
    ]);
    expect(view.choices[2]!.stock).toBe('5.5 magazine equivalents');
    expect(supplyChoiceModel(cache, { ...SUPPLY_FIXTURE_INVENTORY, equipment: -1, kits: 3, ammo: 30 }, capacity, [], 1)
      .choices.map(row => row.status)).toEqual(['incompatible', 'full', 'full']);
    expect(supplyChoiceModel(cache, { ...SUPPLY_FIXTURE_INVENTORY, heldWeapon: 'sidearm' }, capacity, [], 1).choices[2]!.status).toBe('incompatible');
    expect(SUPPLY_FIXTURES).toEqual(before);
  });

  it('uses only accepted host selection and percent, including other users and empty clearing', () => {
    const uses = [{ slot: 1, cacheId: 'P-SOUTH', item: { kind: 'primary-ammo' } as const, percent: 40 },
      { slot: 0, cacheId: 'P-SOUTH', item: { kind: 'health-kit' } as const, percent: 70 }];
    const view = supplyChoiceModel(SUPPLY_FIXTURES[0]!, SUPPLY_FIXTURE_INVENTORY, capacity, uses, 1);
    expect(view.own?.percent).toBe(40); expect(view.others).toEqual([uses[1]]);
    const watching = supplyChoiceModel(SUPPLY_FIXTURES[0]!, null, capacity, uses, 1, true);
    expect(watching.own).toBeNull(); expect(watching.others).toEqual(uses);
    expect(watching.choices.every(row => row.status === 'watching')).toBe(true);
    expect(supplyChoiceModel(SUPPLY_FIXTURES[0]!, SUPPLY_FIXTURE_INVENTORY, capacity, [], 1).own).toBeNull();
  });

  it('hides hints through walls, beyond 3D reach or across stacked floors', () => {
    const feet = { x: 0, y: 0, z: -1 }; const eye = { ...feet, y: 1.6 };
    expect(supplyInReach(SUPPLY_FIXTURES, feet, eye, [])?.id).toBe('P-SOUTH');
    expect(supplyInReach(SUPPLY_FIXTURES, { ...feet, y: 1.1 }, eye, [])).toBeNull();
    expect(supplyInReach(SUPPLY_FIXTURES, { ...feet, z: -2.01 }, eye, [])).toBeNull();
    const wall: WorldBox = { id: 'wall', kind: 'cover', minX: -1, maxX: 1, minY: 0, maxY: 3, minZ: -.6, maxZ: -.4 };
    expect(supplyInReach(SUPPLY_FIXTURES, feet, eye, [wall])).toBeNull();
    const between = { x: 2, y: 0, z: 0 };
    expect(supplyInReach(SUPPLY_FIXTURES, between, { ...between, y: 1.6 }, [], 'P-SOUTH')?.id).toBe('P-SOUTH');
  });

  it('keeps all five exhausted boxes in the scene, without adding draw calls on contention updates', () => {
    const scene = new THREE.Scene(); const scenery = new SupplyModels(scene);
    scenery.update(SUPPLY_FIXTURES); expect(scenery.count).toBe(5); expect(scene.children).toHaveLength(2);
    const meshes = [...scene.children];
    const spent: SupplyCacheDef[] = SUPPLY_FIXTURES.map(cache => ({ ...cache, stock: { projectiles: {}, healthKits: 0, primaryAmmoUnits: 0 } }));
    scenery.update(spent); expect(scenery.count).toBe(5); expect(scene.children).toEqual(meshes);
    expect(supplyChoiceModel(spent[4]!, SUPPLY_FIXTURE_INVENTORY, capacity, [], 1).empty).toBe(true);
    scenery.clear(); expect(scenery.count).toBe(0);
  });
});
