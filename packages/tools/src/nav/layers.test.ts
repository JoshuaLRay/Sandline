import { describe, expect, it } from 'vitest';
import { loadWorld, createMoveState, stepCharacter, TICK_SECONDS, DEFAULT_MOVE_CONFIG } from '@sandline/shared';
import { initNav, NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { bakeWorld, meshLinks, dropLinks } from './bake.ts';

const stacked = loadWorld({ id: 'layer-query', floor: { halfExtent: 40 }, cover: [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
] });
async function meshOf(world = stacked) { await initNav(); return NavMesh.load(await bakeWorld(world)); }

describe('floor-preserving navigation (U-121)', () => {
  it('widens horizontal searches without falling to another floor', async () => {
    const mesh = await meshOf();
    try {
      expect(mesh.resolvePoint({ x: 30, y: 16, z: 0 }, 40)?.point.y).toBeCloseTo(16.05);
      expect(mesh.resolvePoint({ x: 0, y: 4, z: 0 }, 40)).toBeNull();
      expect(mesh.resolvePoint({ x: 30, y: 16, z: 0 }, 20)).toBeNull();
      expect(mesh.resolvePoint({ x: 0, y: 16.5, z: 0 }, 40, .1)).toBeNull();
      for (const limit of [-1, NaN, Infinity]) expect(mesh.resolvePoint({ x: 0, y: 0, z: 0 }, limit)).toBeNull();
      expect(mesh.path({ x: 0, y: 16, z: 0 }, { x: 30, y: 16, z: 0 }, 40)?.points.at(-1)?.y).toBeCloseTo(16.05);
    } finally { mesh.destroy(); }
  });
  it('blocks only the occupied storey, reference-counts overlaps, and preserves 2D blockers', async () => {
    const mesh = await meshOf();
    const box = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, minY: 0, maxY: 2 };
    const point = (y: number) => mesh.nearestPoint({ x: 0, y, z: 0 }, { x: .1, y: .2, z: .1 });
    try {
      mesh.setBlocker('a', [box], true);
      expect(point(0)).toBeNull();
      expect(point(8)).not.toBeNull();
      expect(point(16)).not.toBeNull();
      mesh.setBlocker('b', [box], true);
      mesh.setBlocker('a', [box], false);
      expect(point(0)).toBeNull();
      mesh.setBlocker('b', [box], false);
      expect(point(0)).not.toBeNull();
      // A hanging obstacle intersects a standing body even if it misses feet.
      mesh.setBlocker('hanging', [{ ...box, minY: 9.2, maxY: 9.6 }], true);
      expect(point(0)).not.toBeNull();
      expect(point(8)).toBeNull();
      expect(point(16)).not.toBeNull();
      mesh.setBlocker('hanging', [], false);
      mesh.setBlocker('legacy', [{ minX: -8, maxX: 8, minZ: -8, maxZ: 8 }], true);
      for (const y of [0, 8, 16]) expect(point(y)).toBeNull();
      mesh.setBlocker('legacy', [], false);
      for (const y of [0, 8, 16]) expect(point(y)).not.toBeNull();
    } finally { mesh.destroy(); }
  });
  it('still connects different floors by actual stairs', async () => {
    const world = loadWorld({ id: 'stairs-layer', floor: { halfExtent: 25 }, cover: [
      { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `step-${i}`, x: 17.75 - i * .5, y: 0, z: 0, w: .5, d: 3, h: (i + 1) * .4 })),
    ] });
    const mesh = await meshOf(world);
    try {
      const path = mesh.path({ x: 20, y: 0, z: 0 }, { x: 0, y: 8, z: 0 });
      expect(path?.points.at(-1)?.y).toBeCloseTo(8.05, 1);
      const follower = new PathFollower(mesh, world.boxes);
      let state = createMoveState(20, 0, 0);
      let yaw = 0;
      let crossedMiddle = false;
      for (let tick = 0; tick < 900; tick++) {
        const next = follower.step(state, { goal: { x: 0, y: 8, z: 0 }, pace: 'walk' }, yaw);
        state = stepCharacter(state, next.input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
        yaw = next.input.yaw;
        crossedMiddle ||= state.y > 1 && state.y < 7;
        if (next.status === 'arrived') break;
      }
      expect(crossedMiddle).toBe(true);
      expect(Math.hypot(state.x, state.z)).toBeLessThan(.5);
      expect(state.y).toBeCloseTo(8, 1);
    } finally { mesh.destroy(); }
  });
});

function elevated(ceiling = false) {
  return loadWorld({ id: 'elevated-vault', floor: { halfExtent: 12 }, cover: [
    { id: 'deck', x: 0, y: 5.5, z: 0, w: 18, d: 18, h: 2.5 },
    { id: 'obstacle', x: 0, y: 8, z: 0, w: 6, d: .3, h: 1 },
    ...(ceiling ? [{ id: 'lintel', x: 0, y: 10.1, z: 0, w: 6, d: .3, h: .3 }] : []),
  ] });
}
describe('elevated traversal links (U-121)', () => {
  it('finds vaults above the ground plane', async () => {
    const links = await meshLinks(elevated());
    expect(links.vaults.filter((l) => l.from.y === 8 && l.to.y === 8).length).toBeGreaterThan(0);
    const world = elevated();
    const mesh = await meshOf(world);
    try {
      const follower = new PathFollower(mesh, world.boxes);
      let state = { ...createMoveState(0, 8, -3), grounded: true };
      let yaw = 0;
      let vaulted = false;
      for (let tick = 0; tick < 300; tick++) {
        const next = follower.step(state, { goal: { x: 0, y: 8, z: 3 }, pace: 'walk' }, yaw);
        state = stepCharacter(state, next.input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
        yaw = next.input.yaw;
        vaulted ||= state.vault != null;
        if (next.status === 'arrived') break;
      }
      expect(vaulted).toBe(true);
      expect(state.z).toBeGreaterThan(2.5);
      expect(state.y).toBeCloseTo(8, 1);
    } finally { mesh.destroy(); }
  });
  it('keeps supported elevated drops and rejects a lintel across their body sweep', async () => {
    const plain = { id: 'drop-layer', floor: { halfExtent: 12 }, cover: [
      { id: 'deck', x: 0, y: 5.5, z: 0, w: 18, d: 18, h: 2.5 },
      { id: 'block', x: 0, y: 8, z: 0, w: 2.2, d: 2.2, h: 1 },
    ] };
    const clear = await meshLinks(loadWorld(plain));
    expect(clear.drops.filter((l) => l.from.y === 9 && l.to.y === 8)).toHaveLength(4);
    const obstructed = loadWorld({ ...plain, cover: [...plain.cover,
      { id: 'lintel', x: 0, y: 10.5, z: 1.1, w: 3, d: .1, h: .2 },
    ] });
    expect(dropLinks(obstructed).filter((l) => l.box === 'block' && l.yaw === 0)).toHaveLength(0);
    const blocked = await meshLinks(obstructed);
    expect(blocked.drops.filter((l) => l.box === 'block' && l.yaw === 0)).toHaveLength(0);
  });
  it('refuses an overhead collision along the vault even when both endpoints fit', async () => {
    const links = await meshLinks(elevated(true));
    expect(links.vaults.filter((l) => l.from.y === 8)).toEqual([]);
  });
});
