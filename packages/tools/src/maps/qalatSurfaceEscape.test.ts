import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG as config, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder, type WorldBox,
} from '@sandline/shared';
import { insertionFloors, onInsertionFloor } from './qalatInsertion.ts';
import { ROAD_COMBAT, combatFootprint } from './qalatRoadCombat.ts';
import { buildRoadSupportWorld, roadSupportFloors } from './qalatRoadSupports.ts';
import { RIDGE, ridgeFloors } from './qalatRidge.ts';
import { C12, crossingFloors } from './qalatC12.ts';
import { tankIngressFloors } from './qalatTankIngress.ts';
import { returnShelterFloors } from './qalatReturnShelters.ts';
import { inConvex, rectPolygon, type Point, type Polygon } from './planStrata.ts';
import { ribbonPieces } from './roadSightLines.ts';

const world = buildRoadSupportWorld();
const ACTIONS = ['walk/drop', 'sprint/drop', 'sprint-jump/vault', 'crouch', 'prone'] as const;
const PUSH = 60, SETTLE = 45, STACK_PUSH = 90, WINDOW = 24;
// Even an uninterrupted sprint or repeated ordinary vault cannot leave this
// complete-scene collision window, including its footprint and vault probe.
const reach = Math.max(config.sprintSpeed, config.vaultDistance / config.vaultSeconds)
  * STACK_PUSH * TICK_SECONDS + config.radius + config.vaultProbe + config.vaultDistance;
const lowRoad = /^road-combat-(A-C03|A-C04|A-C06|A-C08|A-C09|A-C11)-/;
const lowRidge = /^ridge-(hut-sack-|cover-(R3-low-rock|R6-low-wall)$)/;
type Route = 'road' | 'ridge' | 'insertion' | 'C12-L' | 'C12-U';
function routeOf(b: WorldBox): Route | null {
  if (b.id.startsWith('crossing-floor-')) return b.minZ < 190 ? 'C12-L' : 'C12-U';
  if (/^ridge-(floor|slab|bridge-deck)/.test(b.id) || lowRidge.test(b.id)) return 'ridge';
  if (b.id.startsWith('road-support-') || lowRoad.test(b.id)) return 'road';
  return b.id === 'insertion-foundation' ? 'insertion' : null;
}
const near = (p: Point) => world.boxes.filter((b) => b.maxX >= p.x - WINDOW && b.minX <= p.x + WINDOW
  && b.maxZ >= p.z - WINDOW && b.minZ <= p.z + WINDOW);
const valid = new Map<Polygon, boolean>();
const contains = (polys: readonly Polygon[], p: Point) => polys.some((poly) => {
  if (!valid.has(poly)) valid.set(poly, poly.length >= 3 && Math.abs(poly.reduce((area, a, i) => {
    const b = poly[(i + 1) % poly.length]!; return area + a.x * b.z - b.x * a.z;
  }, 0)) > 1e-7);
  return valid.get(poly) && inConvex(poly, p); // straight bridge bevels have no area
});
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
// Independent §3.1/§6.3 junction limits. A stair's middle is never a mouth.
const hub = [...ribbonPieces([{ x: 32, z: 64 }, { x: 62, z: 68 }], 8),
  rectPolygon({ minX: 20, maxX: 44, minZ: 53, maxZ: 75 })];
const mouths = {
  'C12-L': { road: [...ribbonPieces([{ x: 12, z: 128 }, { x: 28, z: 134 }], 4),
    rectPolygon({ minX: 26, maxX: 30, minZ: 132, maxZ: 136 })],
  ridge: rectPolygon({ minX: 58, maxX: 70, minZ: 122, maxZ: 134 }), top: 20 },
  'C12-U': { road: [...ribbonPieces([{ x: 26, z: 232 }, { x: 40, z: 218 }], 4),
    rectPolygon({ minX: 38, maxX: 42, minZ: 216, maxZ: 220 })],
  ridge: rectPolygon({ minX: 80, maxX: 92, minZ: 242, maxZ: 254 }), top: 30 },
};
// These are the actual authored outlines, so this integrated sweep adapts to
// all carved masses. Inherited suites independently pin their coordinates.
const outlines = {
  insertion: insertionFloors(), road: [...roadSupportFloors(), ...tankIngressFloors(), ...returnShelterFloors()],
  ridge: ridgeFloors(), stairs: crossingFloors(),
};
const spines: Partial<Record<Route, readonly Point[]>> = {
  ridge: [RIDGE.approach, ...RIDGE.spine], 'C12-L': C12.stairs[0]!.spine, 'C12-U': C12.stairs[1]!.spine,
};
function segmentAt(p: Point, spine: readonly Point[]) {
  let best = Infinity, index = -1;
  for (const [i, a] of spine.slice(0, -1).entries()) {
    const b = spine[i + 1]!, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
    if (distance < best) { best = distance; index = i; }
  }
  return index;
}

/** Uniform arc-length samples, including the many short apron polygon edges. */
function edges(polys: readonly Polygon[], spacing: number) {
  const samples: { edge: Point; out: Point }[] = [];
  for (const poly of polys) {
    const centre = { x: poly.reduce((sum, p) => sum + p.x, 0) / poly.length,
      z: poly.reduce((sum, p) => sum + p.z, 0) / poly.length };
    let next = .5;
    for (const [i, a] of poly.entries()) {
      const b = poly[(i + 1) % poly.length]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length < 1e-9) continue;
      let out = { x: -dz / length, z: dx / length };
      if (out.x * (centre.x - a.x) + out.z * (centre.z - a.z) > 0) out = { x: -out.x, z: -out.z };
      for (; next < length; next += spacing) samples.push({ edge: { x: a.x + dx * next / length, z: a.z + dz * next / length }, out });
      next -= length;
    }
  }
  return samples;
}

describe('U-169 GEO-05 complete surface rejects unregistered shortcuts', () => {
  it('sweeps mass edges, stair sides, bridge parapets, bays, screens and reachable decorative stacks', async () => {
    expect(reach).toBeLessThan(WINDOW);
    expect(world.boxes.some((b) => b.id.startsWith('ridge-bay-V3-'))).toBe(true);
    for (const range of [[124, 142], [214, 250]]) expect(world.boxes.some((b) => b.id.startsWith('crossing-floor-')
      && b.minZ >= range[0]! && b.maxZ <= range[1]!)).toBe(true);
    const counts = new Map<string, number>(), transitions = new Map<string, number>();
    let vaultTicks = 0, dropTicks = 0, attempts = 0;
    const attempt = (start: Point & { y?: number }, out: Point, label: string, mandatory = false) => {
      const boxes = near(start), legal = boxes.filter((b) => routeOf(b) !== null);
      const y = start.y ?? supportUnder(start.x, start.z, config.radius, 30.01, legal, 0);
      if (y < 7.9 || blockedAt(start.x, start.z, config.radius, y, .05, config.height, boxes)) {
        expect(mandatory, `unoccupiable mandatory start ${label}: ${JSON.stringify(start)}`).toBe(false); return;
      }
      const groups = new Map<Route, WorldBox[]>();
      for (const b of legal) { const route = routeOf(b)!; const group = groups.get(route) ?? []; group.push(b); groups.set(route, group); }
      const supported = (p: Point & { y: number }): Route[] => [...groups].filter(([route, group]) =>
        (route !== 'insertion' || onInsertionFloor(p, .06) || contains(returnShelterFloors(), p))
        && Math.abs(supportUnder(p.x, p.z, config.radius, p.y + .01, group, 0) - p.y) < 1e-6).map(([route]) => route)
        .concat(Math.abs(p.y - 8) < .01 && supportUnder(p.x, p.z, config.radius, 8.01, groups.get('insertion') ?? [], 0) === 8
          ? (['road', 'ridge'] as const).filter((route) => contains(outlines[route], p)) : []);
      expect(supported({ ...start, y }).length, `${label} must start on a listed support`).toBeGreaterThan(0);
      const yaw = (Math.round(Math.atan2(out.x, out.z) / (2 * Math.PI) * 1024) + 1024) % 1024;
      const pushTicks = label.startsWith('stack/') ? STACK_PUSH : PUSH;
      for (const action of ACTIONS) {
        let state = { ...createMoveState(start.x, y, start.z), grounded: true };
        let previous = supported(state), previousPoint = state;
        for (let tick = 0; tick < pushTicks + SETTLE; tick++) {
          const pushing = tick < pushTicks, oldY = state.y;
          state = stepCharacter(state, { moveX: 0, moveY: pushing ? 1 : 0, yaw,
            sprint: pushing && (action === 'sprint/drop' || action === 'sprint-jump/vault'),
            jump: pushing && action === 'sprint-jump/vault', crouch: pushing && action === 'crouch', prone: pushing && action === 'prone',
          }, TICK_SECONDS, config, boxes);
          const where = `${label}/${action} from ${JSON.stringify(start)}: ${JSON.stringify(state)}`;
          expect(Math.max(Math.abs(state.x - start.x), Math.abs(state.z - start.z)) + config.radius
            + config.vaultProbe + config.vaultDistance, where).toBeLessThan(WINDOW);
          if (state.vault) vaultTicks++;
          if (state.y < oldY - .001) dropTicks++;
          if (!state.grounded) continue;
          const current = supported(state);
          expect(current.length, `${where} landed on rock, canopy, roof or an unlisted floor`).toBeGreaterThan(0);
          for (const route of current.filter((r) => previous.includes(r))) {
            const spine = spines[route];
            if (spine) expect(Math.abs(segmentAt(state, spine) - segmentAt(previousPoint, spine)),
              `${where} jumped/dropped onto a nonadjacent ${route} segment`).toBeLessThanOrEqual(1);
          }
          if (!current.some((route) => previous.includes(route))) {
            // Only D0's southern hub and the two authored C12 ribbons join
            // road/ridge. Outpost is capped; basement has no surface opening.
            const d0 = Math.abs(state.y - 8) < .01 && Math.abs(previousPoint.y - 8) < .01
              && (contains(hub, state) || contains(hub, previousPoint));
            const crossing = [...previous, ...current].some((route) => {
              if (route !== 'C12-L' && route !== 'C12-U') return false;
              const mouth = mouths[route], other = previous.includes(route) ? current : previous;
              return other.includes('road') && Math.abs(state.y - 8) < .01 && Math.abs(previousPoint.y - 8) < .01
                && (contains(mouth.road, state) || contains(mouth.road, previousPoint))
                || other.includes('ridge') && Math.abs(state.y - mouth.top) < .01 && Math.abs(previousPoint.y - mouth.top) < .01
                && (inConvex(mouth.ridge, state) || inConvex(mouth.ridge, previousPoint));
            });
            expect(d0 || crossing, `${where} changed routes outside D0/C12 mouths or dropped from a stair`).toBe(true);
            const key = `${previous.join('+')}→${current.join('+')}`;
            transitions.set(key, (transitions.get(key) ?? 0) + 1);
          }
          previous = current; previousPoint = state;
        }
        expect(state.grounded, `${label}/${action} failed to settle`).toBe(true);
        expect(state.vault, `${label}/${action} failed to finish a vault`).toBeNull();
        counts.set(label, (counts.get(label) ?? 0) + 1); attempts++;
      }
    };
    for (const [category, polys] of Object.entries(outlines)) {
      for (const [i, { edge, out }] of edges(polys, category === 'road' ? 4 : 2).entries()) {
        const start = { x: edge.x - out.x * .6, z: edge.z - out.z * .6 };
        if (contains(polys, { x: edge.x + out.x * .5, z: edge.z + out.z * .5 })) continue; // an internal floor seam
        attempt(start, out, category);
        if (i % 16 === 0) await yieldWorker();
      }
      expect(counts.get(category) ?? 0, `entire ${category} boundary was skipped`).toBeGreaterThan(30);
      console.log('U-169 boundary coverage', category, counts.get(category));
      await yieldWorker();
    }
    // Every screen's accessible faces, including those inside the broad road
    // apron rather than on its geometric outside edge, must contribute.
    for (const screen of ROAD_COMBAT.screens) {
      for (const { edge, out } of edges([combatFootprint(screen)], 2))
        attempt({ x: edge.x + out.x * .6, z: edge.z + out.z * .6, y: 8 }, { x: -out.x, z: -out.z }, `screen/${screen.id}`);
      expect(counts.get(`screen/${screen.id}`) ?? 0, `untested screen ${screen.id}`).toBeGreaterThanOrEqual(5);
      await yieldWorker();
    }
    // Mandatory independent samples guard against union-outline skips at the
    // occupied overpass, all stair flights, and the low view-slot frames.
    for (const z of [323, 326, 329, 331, 336, 341, 344, 347]) for (const side of [-1, 1])
      attempt({ x: 70 + side * 3.4, z }, { x: side, z: 0 }, 'bridge', true);
    for (const c of C12.stairs) {
      for (const [i, a] of c.spine.slice(0, -1).entries()) {
        const b = c.spine[i + 1]!, length = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
        for (const side of [-1, 1]) {
          const out = { x: -uz * side, z: ux * side }, label = `${c.id}/flight${i}/side${side}`;
          for (let t = 2; t < length - 1; t += 2) attempt({ x: a.x + ux * t + out.x * 1.4,
            z: a.z + uz * t + out.z * 1.4 }, out, label);
          expect(counts.get(label), `untested ${label}`).toBeGreaterThanOrEqual(5);
        }
        await yieldWorker();
      }
    }
    for (const bay of RIDGE.bays.list) {
      for (let z = bay.z - 3.5; z <= bay.z + 3.5; z += .5)
        attempt({ x: bay.x - .8 + .25 + .4, y: bay.y, z }, { x: -1, z: 0 }, `bay/${bay.id}`, true);
      expect(counts.get(`bay/${bay.id}`)).toBe(75);
    }
    const stacks = [
      ...RIDGE.furniture.cover.filter((b) => b.h < 1.25).map((b) => ({ x: b.x, y: b.y + b.h, z: b.z })),
      ...RIDGE.furniture.sacks.zs.map((z) => ({ x: RIDGE.furniture.sacks.x, y: 14.7, z })),
      ...ROAD_COMBAT.cover.filter((b) => b.height < 1.25).map((b) => ({ x: b.x, y: b.y + b.height, z: b.z })),
    ];
    for (const [i, start] of stacks.entries()) {
      for (let direction = 0; direction < 8; direction++) attempt(start,
        { x: Math.sin(direction * Math.PI / 4), z: Math.cos(direction * Math.PI / 4) }, `stack/${i}`, true);
      expect(counts.get(`stack/${i}`)).toBe(40);
      await yieldWorker();
    }
    expect(attempts).toBeGreaterThan(2500);
    expect(vaultTicks, 'ordinary jump intent must actually exercise the automatic vault path').toBeGreaterThan(0);
    expect(dropTicks, 'reachable low tops must exercise ordinary downhill/drop movement').toBeGreaterThan(0);
    console.log('U-169 integrated GEO-05', JSON.stringify({ attempts, counts: Object.fromEntries(counts),
      actions: ACTIONS, pushTicks: PUSH, stackPushTicks: STACK_PUSH, settleTicks: SETTLE, vaultTicks, dropTicks,
      legalTransitions: Object.fromEntries(transitions), windowM: WINDOW, reachBoundM: reach }));
  }, 240_000);
});
