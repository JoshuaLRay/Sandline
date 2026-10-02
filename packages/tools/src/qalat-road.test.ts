import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encounterFor, rayWorld, requireWorld } from '@sandline/shared';
import { initNav, type NavMesh, type NavPoint } from '../../server/src/ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../../server/src/ai/nav/bakedNav.ts';

const world = requireWorld('qalat-road');
let nav: NavMesh;
function clear(from: NavPoint, to: NavPoint): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return rayWorld({ origin: from, direction: { x: dx / distance, y: dy / distance, z: dz / distance }, maxDistance: distance }, world.boxes) === null;
}
function connected(from: NavPoint, to: NavPoint): void {
  const path = nav.path(from, to);
  expect(path).not.toBeNull();
  const end = path!.points.at(-1)!;
  expect(Math.sqrt((end.x - to.x) ** 2 + (end.z - to.z) ** 2)).toBeLessThan(.5);
  expect(Math.abs(end.y - to.y)).toBeLessThan(.5);
}

describe('U-092 valley routes and authored sight lines', () => {
  beforeAll(async () => { await initNav(); nav = loadWorldNavMesh(world.id); });
  afterAll(() => nav.destroy());
  it('connects each named lane to the compound and back to extraction', () => {
    const m = world.mission!;
    expect(m.routes.map((r) => r.id)).toEqual(['riverbed', 'road', 'terraces']);
    for (const route of m.routes) {
      const stops = [m.start, ...route.via, m.objective].map((p) => ({ ...p, y: 0 }));
      for (let i = 1; i < stops.length; i++) {
        connected(stops[i - 1]!, stops[i]!);
        connected(stops[i]!, stops[i - 1]!);
      }
    }
  });
  it('has walkable raised terraces, including the view onto the east gate', () => {
    for (const z of [60, 114, 164]) {
      const bottom = { x: 40, y: 0, z: z - 7 };
      const top = { x: 40, y: 3.25, z };
      connected(bottom, top);
      connected(top, bottom);
    }
    expect(clear({ x: 40, y: 4.85, z: 164 }, { x: 20, y: 1.6, z: 182 })).toBe(true);
  });
  it('gives the MG a long road line and a visible northern tank bend', () => {
    expect(clear({ x: 0, y: 1.6, z: 169 }, { x: 0, y: 1.6, z: 34 })).toBe(true);
    expect(clear({ x: 8, y: 1.6, z: 174 }, { x: 8, y: 1.6, z: 126 })).toBe(true);
    connected({ x: 8, y: 0, z: 174 }, { x: 8, y: 0, z: 126 });
  });
  it('screens the squad start and authors a captive prisoner', () => {
    expect(clear({ x: 0, y: 1.6, z: -6 }, { x: 0, y: 1.6, z: 60 })).toBe(false);
    expect(encounterFor(world.id)!.groups.find((g) => g.id === 'prisoner')!.captive).toBe(true);
  });
});
