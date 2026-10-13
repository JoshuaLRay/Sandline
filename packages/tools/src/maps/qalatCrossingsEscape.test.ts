import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder } from '@sandline/shared';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { inConvex, rectPolygon, type Point, type Polygon } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';

// Independent §6.3 coordinates and the compulsory 4×4 interior landings.
const CROSSINGS = [
  { id: 'C12-L', spine: [{ x: 12, y: 8, z: 128 }, { x: 28, y: 8, z: 134 }, { x: 40, y: 12, z: 140 },
    { x: 54, y: 16, z: 140 }, { x: 64, y: 20, z: 128 }] },
  { id: 'C12-U', spine: [{ x: 26, y: 8, z: 232 }, { x: 40, y: 8, z: 218 }, { x: 62, y: 14, z: 216 },
    { x: 78, y: 20, z: 224 }, { x: 66, y: 24, z: 244 }, { x: 86, y: 30, z: 248 }] },
];
const world = buildRoadSupportWorld();
const crossingFloors = world.boxes.filter((b) => b.id.startsWith('crossing-floor-'));
const nearby = (p: Point) => world.boxes.filter((b) => b.maxX >= p.x - 12 && b.minX <= p.x + 12 && b.maxZ >= p.z - 12 && b.minZ <= p.z + 12);
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
const expanded = (polys: Polygon[], margin: number) => polys.map((poly) => convexHull(poly.flatMap((p) => [-margin, margin].flatMap((dx) =>
  [-margin, margin].map((dz) => ({ x: p.x + dx, z: p.z + dz }))))));
const contains = (polys: Polygon[], p: Point) => polys.some((poly) => inConvex(poly, p));

describe('U-168 GEO-05 C12 stair balustrades and landings reject unlisted route changes', () => {
  for (const c of CROSSINGS) it(`${c.id} rejects walking, sprint-jump/vault, crouch/prone and downhill drop attempts at both edges`, async () => {
    const polygons = [...ribbonPieces(c.spine, 4), ...c.spine.slice(1, -1).map((n) =>
      rectPolygon({ minX: n.x - 2, maxX: n.x + 2, minZ: n.z - 2, maxZ: n.z + 2 }))];
    const allowed = expanded(polygons, .06);
    const endpoints = [c.spine[0]!, c.spine.at(-1)!];
    const attemptCounts = new Map<string, number>();
    let attempts = 0;
    const attempt = (inside: Point, out: Point, highY: number, label: string) => {
      // Open junctions, another stair ribbon and shared corner bevels are
      // lawful movement. Sample only edges whose other side is rock/cheek.
      if (endpoints.some((n) => Math.hypot(inside.x - n.x, inside.z - n.z) < 6)) return;
      if (contains(polygons, { x: inside.x + out.x, z: inside.z + out.z })) return;
      const boxes = nearby(inside), y = supportUnder(inside.x, inside.z, DEFAULT_MOVE_CONFIG.radius, highY + .3, boxes, 0);
      if (y < 7.9 || blockedAt(inside.x, inside.z, DEFAULT_MOVE_CONFIG.radius, y, .05, DEFAULT_MOVE_CONFIG.height, boxes)) return;
      expect(supportUnder(inside.x, inside.z, DEFAULT_MOVE_CONFIG.radius, y + .01, crossingFloors, 0), `${label} did not start on a crossing`).toBeCloseTo(y, 6);
      const yaw = ((Math.round(Math.atan2(out.x, out.z) / (2 * Math.PI) * 1024) % 1024) + 1024) % 1024;
      for (const stance of ['walk', 'jump', 'crouch', 'prone']) {
        let state = { ...createMoveState(inside.x, y, inside.z), grounded: true };
        for (let tick = 0; tick < 60; tick++) state = stepCharacter(state, {
          moveX: 0, moveY: 1, yaw, sprint: stance !== 'walk', jump: stance === 'jump', crouch: stance === 'crouch', prone: stance === 'prone',
        }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        for (let tick = 0; tick < 45; tick++) state = stepCharacter(state, {
          moveX: 0, moveY: 0, yaw, sprint: false, jump: false, crouch: false, prone: false,
        }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        expect(state.vault, `${label}/${stance} ended in a vault`).toBeNull();
        expect(contains(allowed, state), `${label}/${stance} crossed the balustrade from ${JSON.stringify(inside)} to ${JSON.stringify(state)}`).toBe(true);
        expect(state.y, `${label}/${stance} dropped beneath the legal floor`).toBeGreaterThanOrEqual(7.9);
        expect(supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y + .01, crossingFloors, 0),
          `${label}/${stance} changed route or reached a cheek/rock top`).toBeCloseTo(state.y, 6);
        attempts++;
        attemptCounts.set(label, (attemptCounts.get(label) ?? 0) + 1);
      }
    };
    for (const [i, a] of c.spine.slice(0, -1).entries()) {
      const b = c.spine[i + 1]!, length = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
      for (let t = 1; t < length - 1; t += 2) for (const side of [-1, 1]) {
        const out = { x: -uz * side, z: ux * side };
        attempt({ x: a.x + ux * t + out.x * 1.4, z: a.z + uz * t + out.z * 1.4 }, out, Math.max(a.y, b.y), `segment${i}/side${side}`);
      }
      await yieldWorker();
    }
    for (const [i, n] of c.spine.slice(1, -1).entries()) {
      for (const offset of [-1, 0, 1]) for (const side of [-1, 1]) {
        attempt({ x: n.x + offset, z: n.z + side * 1.4 }, { x: 0, z: side }, n.y, `landing${i}/z${side}`);
        attempt({ x: n.x + side * 1.4, z: n.z + offset }, { x: side, z: 0 }, n.y, `landing${i}/x${side}`);
      }
      await yieldWorker();
    }
    // Mandatory exercised samples prevent a changed footprint or obstruction
    // from quietly skipping an entire ascending flight or all interior pads.
    for (let i = 1; i < c.spine.length - 1; i++) for (const side of [-1, 1])
      expect(attemptCounts.get(`segment${i}/side${side}`), `untested flight ${i}, side ${side}`).toBeGreaterThanOrEqual(4);
    expect([...attemptCounts.keys()].some((label) => label.startsWith('landing'))).toBe(true);
    expect(attempts).toBeGreaterThan(120);
    console.log(`U-168 ${c.id} stair escapes`, JSON.stringify({ attempts, stances: ['walk', 'sprint-jump/vault', 'crouch', 'prone'], pushTicks: 60, settleTicks: 45 }));
  }, 120_000);
});
