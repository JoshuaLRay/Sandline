import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, rayWorld, stepCharacter, supportUnder,
} from '@sandline/shared';
import { buildDepotWorld } from './qalatDepot.ts';
import type { Point } from './planStrata.ts';

// Independent §7.2 transcription. The author's manifest is deliberately not
// the oracle for any width, elevation, tread, rest or endpoint below.
const FLIGHTS = [
  { id: 'B0-first', x: -2, z: 76, y: 8, dz: 1, dy: -1 },
  { id: 'B0-second', x: 8, z: 86, y: 4, dz: 1, dy: -1 },
  { id: 'B10-first', x: -8, z: 376, y: 0, dz: 1, dy: 1 },
  { id: 'B10-second', x: 2, z: 386, y: 4, dz: -1, dy: 1 },
] as const;
// A launch tread at the exact node, ten risers to the central rest, then ten
// to the exact destination. The 2 m rest is not counted as extra stair run.
const RISERS = [ .4, .8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4,
  6, 6.4, 6.8, 7.2, 7.6, 8, 8.4, 8.8, 9.2, 9.6 ];
const floorAt = (flight: typeof FLIGHTS[number], distance: number) =>
  flight.y + flight.dy * .2 * RISERS.filter((r) => r <= distance + 1e-8).length;
const world = buildDepotWorld();
const nearby = (p: Point) => world.boxes.filter((b) => b.maxX >= p.x - 12 && b.minX <= p.x + 12
  && b.maxZ >= p.z - 12 && b.minZ <= p.z + 12);
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
const at = (f: typeof FLIGHTS[number], distance: number, side = 0) => ({ x: f.x + side, z: f.z + f.dz * distance });

describe('U-171 exact covered B0/B10 stairs', () => {
  for (const flight of FLIGHTS) it(`${flight.id}: twenty 0.20/0.40 risers/treads, 2 m rest, 4 m clear and covered`, () => {
    const boxes = nearby(at(flight, 5));
    const treadCentres = Array.from({ length: 20 }, (_, i) => i * .4 + (i >= 10 ? 2 : 0) + .2);
    const distances = [...treadCentres, 4.01, 4.5, 5, 5.5, 5.99];
    for (const distance of distances) for (const side of [-1.99, -1, 0, 1, 1.99]) {
      const p = at(flight, distance, side), y = floorAt(flight, distance), label = `${flight.id} ${distance}/${side}`;
      expect(supportUnder(p.x, p.z, .001, y + .01, boxes, 0), `${label}: wrong tread floor`).toBeCloseTo(y, 6);
      expect(blockedAt(p.x, p.z, .001, y, .001, 3.199, boxes), `${label}: lost clear stair volume`).toBe(false);
      const roof = rayWorld({ origin: { ...p, y: y + 1.6 }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 20 }, boxes);
      expect(roof, `${label}: usable skylight`).not.toBeNull();
      expect(roof!.distance, `${label}: inadequate overhead`).toBeGreaterThanOrEqual(1.6 - 1e-6);
    }
    // Boundaries independently identify all twenty 0.20 m risers. Testing
    // only the end points would also accept a ramp or an early floor drop.
    for (const distance of RISERS) {
      const before = at(flight, distance - .001), after = at(flight, distance + .001);
      const beforeY = floorAt(flight, distance - .001), afterY = floorAt(flight, distance + .001);
      expect(supportUnder(before.x, before.z, .00001, beforeY + .01, boxes, 0)).toBeCloseTo(beforeY, 6);
      expect(supportUnder(after.x, after.z, .00001, afterY + .01, boxes, 0)).toBeCloseTo(afterY, 6);
      expect(Math.abs(afterY - beforeY)).toBeCloseTo(.2, 8);
    }
    for (const distance of [0, 10]) {
      const p = at(flight, distance), y = floorAt(flight, distance);
      expect(supportUnder(p.x, p.z, .001, y + .01, boxes, 0), `${flight.id} exact node`).toBeCloseTo(y, 6);
    }
  });

  it('keeps the 24×20 B0 loading room, its east doorway and the open 8×8 west landing exact', () => {
    const loading = nearby({ x: -2, z: 68 });
    for (let x = -13.9; x < 10; x += 1) for (let z = 58.1; z < 78; z += 1) {
      if (x >= -4 && x <= 0 && z >= 76) continue; // Named stair well inside B0.
      expect(supportUnder(x, z, .001, 8.01, loading, 0), `B0 floor ${x}/${z}`).toBeCloseTo(8, 6);
      expect(blockedAt(x, z, .001, 8, .001, 3.999, loading), `B0 inside ${x}/${z}`).toBe(false);
      expect(rayWorld({ origin: { x, y: 9.6, z }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 10 }, loading)?.distance,
        `B0 ceiling ${x}/${z}`).toBeCloseTo(2.4, 6);
    }
    for (const z of [66.01, 68, 69.99]) {
      expect(blockedAt(10.3, z, .001, 8, .001, 3.199, loading), `B0 endpoint doorway ${z}`).toBe(false);
      expect(supportUnder(10.3, z, .001, 8.01, loading, 0)).toBeCloseTo(8, 6);
    }
    for (const z of [65.99, 70.01]) expect(blockedAt(10.3, z, .001, 8, .001, 1.8, loading), `B0 east jamb ${z}`).toBe(true);
    const porch = nearby({ x: 8, z: 374 });
    for (const x of [4.01, 8, 11.99]) for (const z of [370.01, 374, 377.99]) {
      expect(supportUnder(x, z, .001, 8.01, porch, 0), `B10 floor ${x}/${z}`).toBeCloseTo(8, 6);
      expect(blockedAt(x, z, .001, 8, .001, 3.199, porch), `B10 inside ${x}/${z}`).toBe(false);
      expect(rayWorld({ origin: { x, y: 9.6, z }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 30 }, porch),
        `B10 open porch ${x}/${z}`).toBeNull();
    }
  });

  it('rejects walking, sprint-jump/vault, crouch/prone and downhill drops over every stair cheek', async () => {
    let attempts = 0;
    for (const flight of FLIGHTS) {
      const boxes = nearby(at(flight, 5));
      for (const distance of [1, 3, 5, 7, 9]) for (const side of [-1, 1]) {
        const start = at(flight, distance, 1.4 * side), y = floorAt(flight, distance);
        expect(supportUnder(start.x, start.z, DEFAULT_MOVE_CONFIG.radius, y + .01, boxes, 0), `${flight.id} launch`).toBeCloseTo(y, 6);
        expect(blockedAt(start.x, start.z, DEFAULT_MOVE_CONFIG.radius, y, .05, DEFAULT_MOVE_CONFIG.height, boxes), `${flight.id} launch blocked`).toBe(false);
        for (const stance of ['walk', 'jump', 'crouch', 'prone']) {
          let state = { ...createMoveState(start.x, y, start.z), grounded: true };
          const label = `${flight.id}/${distance}/${side}/${stance}`;
          for (let tick = 0; tick < 105; tick++) {
            state = stepCharacter(state, { moveX: 0, moveY: tick < 60 ? 1 : 0, yaw: side > 0 ? 256 : 768,
              sprint: tick < 60 && stance !== 'walk', jump: tick < 60 && stance === 'jump',
              crouch: tick < 60 && stance === 'crouch', prone: tick < 60 && stance === 'prone',
            }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
            expect(state.vault, `${label}: vaulted a cheek`).toBeNull();
            expect(Math.abs(state.x - flight.x), `${label}: left the 4 m stair: ${JSON.stringify(state)}`).toBeLessThanOrEqual(2.06);
            if (state.grounded) expect(state.y, `${label}: landed on a cheek, roof or dropped past a tread`).toBeCloseTo(y, 6);
          }
          expect(state.grounded, `${label}: never settled`).toBe(true);
          expect(state.y, `${label}: drop shortcut`).toBeCloseTo(y, 6);
          attempts++;
        }
      }
      await yieldWorker();
    }
    expect(attempts).toBe(160);
    console.log('U-171 stair cheek escapes', JSON.stringify({ attempts, stances: ['walk', 'sprint-jump/vault', 'crouch', 'prone'], pushTicks: 60, settleTicks: 45 }));
  }, 120_000);

  it('closes B0 room-floor drop shortcuts and the exposed B10 platform edges in every stance', async () => {
    const EDGES = [
      { id: 'B0-west-rim', x: -5, y: 8, z: 77, yaw: 256, axis: 'x', bound: -4.3, direction: 1 },
      { id: 'B0-east-rim', x: 1, y: 8, z: 77, yaw: 768, axis: 'x', bound: .3, direction: -1 },
      { id: 'B10-east-edge', x: 11, y: 8, z: 374, yaw: 256, axis: 'x', bound: 12.06, direction: 1 },
      { id: 'B10-south-edge', x: 8, y: 8, z: 371, yaw: 512, axis: 'z', bound: 369.94, direction: -1 },
      { id: 'B10-north-edge', x: 8, y: 8, z: 377, yaw: 0, axis: 'z', bound: 378.06, direction: 1 },
    ] as const;
    let attempts = 0;
    for (const edge of EDGES) {
      const boxes = nearby(edge);
      expect(supportUnder(edge.x, edge.z, DEFAULT_MOVE_CONFIG.radius, edge.y + .01, boxes, 0), `${edge.id}: supported launch`).toBeCloseTo(edge.y, 6);
      expect(blockedAt(edge.x, edge.z, DEFAULT_MOVE_CONFIG.radius, edge.y, .05, DEFAULT_MOVE_CONFIG.height, boxes), `${edge.id}: clear launch`).toBe(false);
      for (const stance of ['walk', 'jump', 'crouch', 'prone']) {
        let state = { ...createMoveState(edge.x, edge.y, edge.z), grounded: true };
        for (let tick = 0; tick < 135; tick++) {
          state = stepCharacter(state, { moveX: 0, moveY: tick < 90 ? 1 : 0, yaw: edge.yaw,
            sprint: tick < 90 && stance !== 'walk', jump: tick < 90 && stance === 'jump',
            crouch: tick < 90 && stance === 'crouch', prone: tick < 90 && stance === 'prone',
          }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
          const label = `${edge.id}/${stance}/${tick}: ${JSON.stringify(state)}`;
          expect(state.vault, `${label}: vaulted the endpoint rim`).toBeNull();
          expect((state[edge.axis] - edge.bound) * edge.direction, `${label}: crossed a closed edge`).toBeLessThanOrEqual(1e-6);
          if (state.grounded) expect(state.y, `${label}: landed on a wall, roof or drop shortcut`).toBeCloseTo(edge.y, 6);
        }
        expect(state.grounded, `${edge.id}/${stance}: never settled`).toBe(true);
        expect(state.y, `${edge.id}/${stance}: endpoint drop`).toBeCloseTo(8, 6);
        attempts++;
      }
      await yieldWorker();
    }
    expect(attempts).toBe(20);
    console.log('U-171 endpoint rim/drop escapes', JSON.stringify({ attempts, edges: EDGES.map((e) => e.id) }));
  }, 120_000);
});
