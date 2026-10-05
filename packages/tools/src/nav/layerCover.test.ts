import { describe, expect, it } from 'vitest';
import { loadWorld, boxFrom } from '@sandline/shared';
import { initNav, NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { CoverSystem, COVER, firingPosition } from '../../../server/src/ai/cover.ts';
import { EnemyGroup } from '../../../server/src/ai/group.ts';
import type { CoverPoint } from '../../../server/src/ai/nav/baked/types.ts';
import { bakeWorld, DEFAULT_NAV_AGENT, onMesh } from './bake.ts';
import { coverPoints } from './cover.ts';

const world = loadWorld({ id: 'layer-cover', floor: { halfExtent: 20 }, cover: [
  { id: 'deck', x: 0, y: 5.5, z: 0, w: 20, d: 20, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 20, d: 20, h: 2 },
  { id: 'wall', x: 0, y: 0, z: 2, w: 8, d: .3, h: 19 },
  { id: 'lower-crate', x: -5, y: 0, z: 0, w: 2, d: 1.2, h: 1.2 },
  { id: 'upper-crate', x: -5, y: 8, z: 0, w: 2, d: 1.2, h: 1.2 },
] });
const upper: CoverPoint = { box: 'upper-crate', x: -5, y: 8, z: -1.05, nx: 0, nz: -1, height: 'low' };
const lower: CoverPoint = { ...upper, box: 'lower-crate', y: 0 };
const threat = { x: -5, y: 9.55, z: 6 };
async function meshOf() { await initNav(); return NavMesh.load(await bakeWorld(world)); }

describe('stacked-floor cover (U-122)', () => {
  it('bakes usable cover along a wall on every supported level', async () => {
    const mesh = await meshOf();
    try {
      const points = coverPoints(world, DEFAULT_NAV_AGENT, (p) => onMesh(mesh, p, DEFAULT_NAV_AGENT.climb));
      for (const y of [0, 8, 16]) expect(points.some((p) => p.box === 'wall' && p.y === y)).toBe(true);
      expect(points.filter((p) => p.box === 'deck' && p.y === 0)).toHaveLength(0);
    } finally { mesh.destroy(); }
  });
  it('a real Session rejects partial paths to cover on the other floor', async () => {
    const mesh = await meshOf();
    try {
      const session = new Session(undefined, '', world, { navMesh: mesh, cover: [upper], testHumanCount: 0 });
      expect(session.cover!.choose(100, { from: lower, threats: [threat], combat: false })).toBeNull();
      expect(session.cover!.choose(101, { from: upper, threats: [threat], combat: false })?.point.y).toBe(8);
      const surfaceSession = new Session(undefined, '', world, { navMesh: mesh, cover: [lower], testHumanCount: 0 });
      expect(surfaceSession.cover!.choose(102, { from: upper, threats: [{ ...threat, y: 1.55 }], combat: false })).toBeNull();
      const group = new EnemyGroup(1);
      expect(group.route(lower, upper, new Set(), { mesh, cover: session.cover, boxes: world.boxes })).toBeNull();
    } finally { mesh.destroy(); }
  });
  it('crowding and reservation tracking distinguish identical x/z on separate floors', () => {
    const cover = new CoverSystem([upper], world.boxes);
    const query = { from: upper, threats: [threat], combat: false };
    const score = cover.rank(query)[0]!.score;
    expect(cover.rank({ ...query, friends: [lower] })[0]!.score).toBe(score);
    expect(cover.rank({ ...query, friends: [upper] })[0]!.score).toBe(score - COVER.weights.crowd);
    expect(cover.reserve(1, 0, lower)).toBe(false);
    expect(cover.reserve(1, 0, upper)).toBe(true);
    cover.track(1, upper, true);
    cover.track(1, lower, true);
    expect(cover.heldPoint(1)).toBeNull();
  });
  it('retains visible support fire from an elevated ledge toward a lower target', () => {
    const ledge = loadWorld({ id: 'support-cover', floor: { halfExtent: 80 }, cover: [
      { id: 'platform', x: 0, y: 5.5, z: -4.7, w: 8, d: 10.6, h: 2.5 },
      { id: 'crate', x: 0, y: 8, z: 0, w: 2, d: 1.2, h: 1.2 },
    ] });
    const point: CoverPoint = { ...upper, box: 'crate', x: 0 };
    const cover = new CoverSystem([point], ledge.boxes);
    expect(cover.choose(1, { from: point, threats: [{ x: 0, y: 1.55, z: 60 }] })?.firingFrom?.y).toBe(8);
  });
  it('refreshes cached headroom when a scripted blocker changes in a real Session', async () => {
    const mesh = await meshOf();
    try {
      const session = new Session(undefined, '', world, { navMesh: mesh, cover: [upper], testHumanCount: 0 });
      const query = { from: upper, threats: [threat], combat: false };
      expect(session.cover!.rank(query)).toHaveLength(1);
      const blocker = { id: 'headroom', active: true, boxes: [boxFrom({ id: 'headroom', x: -5, y: 9, z: -1.05, w: 2, d: 2, h: .5 }, 'blocker')] };
      const internals = session as unknown as { setBlocker(value: typeof blocker): void };
      internals.setBlocker(blocker);
      expect(session.cover!.rank(query)).toHaveLength(0);
      internals.setBlocker({ ...blocker, active: false });
      expect(session.cover!.rank(query)).toHaveLength(1);
    } finally { mesh.destroy(); }
  });
  it('rejects a firing sidestep that would hang over a platform edge', () => {
    const ledge = loadWorld({ id: 'ledge-cover', floor: { halfExtent: 15 }, cover: [
      { id: 'platform', x: 0, y: 5.5, z: 0, w: 1, d: 4, h: 2.5 },
      { id: 'wall', x: 0, y: 8, z: 1, w: 1, d: .3, h: 2.4 },
    ] });
    const point: CoverPoint = { box: 'wall', x: 0, y: 8, z: .4, nx: 0, nz: -1, height: 'high' };
    expect(firingPosition(point, { x: 0, y: 9.55, z: 8 }, ledge.boxes)).toBeNull();
  });
});
