import { Detour, importNavMesh, type NavMesh as DetourMesh } from '@recast-navigation/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG as config, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder,
  type WorldBox,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { buildDepotWorld, depotFloors } from './qalatDepot.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { inConvex, type Point, type Polygon } from './planStrata.ts';

type Node = Point & { y: number; id: string };
// Independent §7.2 witnesses. Both storeys at A6/B6 deliberately share x/z.
const rooms: Node[] = [
  [-2, 96], [-20, 120], [-36, 160], [-18, 200], [8, 232], [30, 270], [-14, 310], [-14, 346], [-8, 370],
].map(([x, z], i) => ({ id: `B${i + 1}`, x: x!, y: 0, z: z! }));
const surface: Node[] = [
  [32, 64], [32, 98], [12, 128], [-37, 142], [-28, 210], [26, 232], [30, 270], [-18, 302], [16, 332], [32, 350],
].map(([x, z], i) => ({ id: i === 0 ? 'D0' : `A${i}`, x: x!, y: 8, z: z! }));
const west: Node = { id: 'B10', x: 8, y: 8, z: 374 };
const backing: Node[] = [
  [-60, 96], [-60, 160], [-60, 270], [-60, 370], [60, 160], [60, 270],
].map(([x, z], i) => ({ id: `backing-${i}`, x: x!, y: 0, z: z! }));
// GEO-04 removes the exact two registered lower doorways, with their actual
// vertical intervals. No plan-area cut may accidentally seal another floor.
const portals = [
  { minX: 3.9, maxX: 4.7, minZ: 94, maxZ: 98, minY: 0, maxY: 3 },
  { minX: -10, maxX: -6, minZ: 375.9, maxZ: 376.7, minY: 0, maxY: 3 },
];
const world = buildDepotWorld();
let nav: NavMesh, mesh: DetourMesh;
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('U-173 furnished depot has exactly the two registered connections', () => {
  beforeAll(async () => { await initNav(); const bytes = await bakeRoadSupportNav(world); nav = NavMesh.load(bytes); mesh = importNavMesh(bytes).navMesh; }, 240_000);
  afterAll(() => { nav?.destroy(); mesh?.destroy(); });

  it('requires valid targets, reaches both endpoints, then isolates every room from the surface and backing plane', () => {
    expect(nav.links()).toEqual([]);
    for (const node of [...rooms, ...surface, west, ...backing]) {
      const hit = nav.nearestPoint(node)?.point;
      expect(hit, `${node.id}: missing target would make a negative path test vacuous`).toBeDefined();
      expect(Math.hypot(hit!.x - node.x, hit!.z - node.z), node.id).toBeLessThan(.1);
      expect(Math.abs(hit!.y - node.y), `${node.id}: wrong storey`).toBeLessThanOrEqual(.05002);
    }
    let queries = 0;
    const connected = (a: Node, b: Node, expected: boolean) => {
      for (const [from, to] of [[a, b], [b, a]]) {
        const path = nav.path(from!, to!), length = completePathLength(path, from!, to!);
        const label = `${from!.id}→${to!.id}`;
        if (expected) { expect(length, label).not.toBeNull(); expect(path!.vaults, label).toEqual([]); }
        else expect(length, `${label}: unlisted connection`).toBeNull();
        queries++;
      }
    };
    // Positive controls cover every source and destination before introducing
    // blockers. B10 is a real isolated porch until U-116 builds the outpost.
    for (const room of rooms) for (const end of [surface[0]!, west]) connected(room, end, true);
    for (const road of surface) connected(surface[0]!, road, true);
    for (const room of rooms) for (const outside of backing) connected(room, outside, false);
    for (const closed of [0, 1]) {
      nav.setBlocker(`one-depot-endpoint-${closed}`, [portals[closed]!], true);
      try {
        for (const room of rooms) {
          connected(room, closed === 0 ? surface[0]! : west, false);
          connected(room, closed === 0 ? west : surface[0]!, true);
        }
      } finally { nav.setBlocker(`one-depot-endpoint-${closed}`, [], false); }
    }
    nav.setBlocker('both-depot-endpoints', portals, true);
    try {
      for (const room of rooms) {
        // All nine rooms still form one connected basement component. A
        // broad blocker that deletes the depot itself must fail this control.
        connected(room, rooms[4]!, true);
        for (const outside of [...surface, west, ...backing]) connected(room, outside, false);
      }
      for (const road of surface) connected(surface[0]!, road, true);
    } finally { nav.setBlocker('both-depot-endpoints', [], false); }
    for (const room of rooms) for (const end of [surface[0]!, west]) connected(room, end, true);
    // Audit every live Detour adjacency after the two exact cuts, rather
    // than relying only on a finite set of negative destination queries.
    const polygons = nav.polygons(), byRef = new Map(polygons.map((p) => [p.ref, p]));
    const removed = new Set(polygons.filter((p) => portals.some((b) =>
      Math.max(...p.corners.map((v) => v.x)) > b.minX && Math.min(...p.corners.map((v) => v.x)) < b.maxX &&
      Math.max(...p.corners.map((v) => v.z)) > b.minZ && Math.min(...p.corners.map((v) => v.z)) < b.maxZ &&
      p.centre.y < b.maxY && p.centre.y + config.height > b.minY)).map((p) => p.ref));
    const seen = new Set<number>(), todo = [nav.nearestPoint(rooms[4]!)!.polyRef];
    for (let i = 0; i < todo.length; i++) {
      const ref = todo[i]!;
      if (seen.has(ref) || removed.has(ref)) continue;
      seen.add(ref);
      const { tile, poly } = mesh.getTileAndPolyByRefUnsafe(ref);
      for (let index = poly.firstLink(); index !== Detour.DT_NULL_LINK;) {
        const link = tile.links(index), next = link.ref();
        if (byRef.has(next) && !seen.has(next)) todo.push(next);
        index = link.next();
      }
    }
    expect(seen.size).toBeGreaterThan(100);
    for (const room of rooms) expect(seen.has(nav.nearestPoint(room)!.polyRef), room.id).toBe(true);
    const escaped = [...seen].map((ref) => byRef.get(ref)!).filter((p) => Math.abs(p.centre.y) > .05002 || !contains(p.centre));
    expect(escaped, 'actual basement component reached stairs, surface or exterior backing plane').toEqual([]);
    console.log('U-173 exact furnished depot graph', JSON.stringify({ rooms: rooms.length,
      surfaceTargets: surface.length + 1, backingTargets: backing.length, portals: portals.length, bidirectionalQueries: queries, auditedBasementPolygons: seen.size }));
  }, 120_000);
});

const ACTIONS = ['walk/drop', 'sprint/drop', 'sprint-jump/vault', 'crouch', 'prone'] as const;
const PUSH = 90, SETTLE = 60, CELL = 4, QUERY = 3;
// Every collision solid is retained. This broadphase expands each cell past
// the controller's furthest vault probe/landing and ordinary tick movement.
const grid = new Map<string, WorldBox[]>();
for (const b of world.boxes) for (let x = Math.floor((b.minX - QUERY) / CELL); x <= Math.floor((b.maxX + QUERY) / CELL); x++)
  for (let z = Math.floor((b.minZ - QUERY) / CELL); z <= Math.floor((b.maxZ + QUERY) / CELL); z++) {
    const key = `${x}/${z}`, list = grid.get(key) ?? []; list.push(b); grid.set(key, list);
  }
const nearby = (p: Point) => grid.get(`${Math.floor(p.x / CELL)}/${Math.floor(p.z / CELL)}`) ?? [];
const isFloor = (b: WorldBox) => /^depot-(floor-|stair-floor-)/.test(b.id);
const isFurniture = (b: WorldBox) => b.id.startsWith('depot-furniture-') && b.maxY <= 2.200001;
const isSurface = (b: WorldBox) => b.id.startsWith('road-support-') || b.id.startsWith('insertion-foundation')
  || /^road-combat-(A-C03|A-C04|A-C06|A-C08|A-C09|A-C11)-/.test(b.id);
const allowed = (boxes: readonly WorldBox[], p: Point & { y: number }, surfaceStart: boolean) => {
  // A y0 support query without a real slab must not accept implicit ground.
  // Structural walls, balustrades and all roof tops are intentionally absent.
  const floors = boxes.filter((b) => isFloor(b) || isFurniture(b) || (surfaceStart || p.y === 8) && isSurface(b));
  return p.y >= 0 && Math.abs(supportUnder(p.x, p.z, config.radius, p.y + .01, floors, -100) - p.y) < 1e-6;
};
const polys = depotFloors().filter((poly) => poly.length >= 3 && Math.abs(poly.reduce((sum, a, i) => {
  const b = poly[(i + 1) % poly.length]!; return sum + a.x * b.z - b.x * a.z;
}, 0)) > 1e-7);
const contains = (p: Point) => polys.some((poly) => inConvex(poly, p));
function edges(polygons: readonly Polygon[], spacing: number) {
  const samples: { edge: Point; out: Point }[] = [];
  for (const poly of polygons) {
    const centre = { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, z: poly.reduce((s, p) => s + p.z, 0) / poly.length };
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
// Independent §7.2 stage centreline distinguishes physically adjacent flights
// at different elevations. An airborne drop across the cheek may not skip a
// flight even if it ultimately lands on another legitimate depot floor.
const stairs = [
  [[-2, 8, 68], [-2, 8, 76], [-2, 4, 86], [8, 4, 86], [8, 0, 96], [-2, 0, 96]],
  [[-8, 0, 370], [-8, 0, 376], [-8, 4, 386], [2, 4, 386], [2, 8, 376], [8, 8, 374]],
].map((nodes) => nodes.map(([x, y, z]) => ({ x: x!, y: y!, z: z! })));
function stageAt(p: Point & { y: number }, spine: typeof stairs[number]) {
  let stage = -1, distance = Infinity;
  for (const [i, a] of spine.slice(0, -1).entries()) {
    const b = spine[i + 1]!, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / (dx * dx + dy * dy + dz * dz)));
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy, p.z - a.z - t * dz);
    if (d < distance) { distance = d; stage = i; }
  }
  return stage;
}

it('U-173 sweeps every furnished basement boundary, roof, stair side, balustrade and prop face with real escape inputs', async () => {
  expect(config.vaultDistance + config.radius + config.vaultProbe + config.sprintSpeed * TICK_SECONDS).toBeLessThan(QUERY);
  const counts = new Map<string, number>(), violations: string[] = [];
  let attempts = 0, vaultTicks = 0, dropTicks = 0;
  const attempt = (start: Point & { y: number }, out: Point, label: string,
    options: { mandatory?: boolean; surface?: boolean; stair?: number; crouched?: boolean; floorOnly?: boolean } = {}) => {
    const boxes = nearby(start), height = options.crouched ? config.crouchHeight : config.height;
    if (blockedAt(start.x, start.z, config.radius, start.y, .05, height, boxes)
      || !allowed(boxes, start, options.surface ?? false)) {
      expect(options.mandatory, `${label}: invalid start ${JSON.stringify(start)}`).not.toBe(true); return;
    }
    const yaw = (Math.round(Math.atan2(out.x, out.z) / (2 * Math.PI) * 1024) + 1024) % 1024;
    // B9's 2.2 m crate has only 1.4 m above its top and no reachable
    // stepping stone. Ground-level jump/vault probes below must prove that
    // top unreachable; artificial top starts exercise only fitting stances.
    const actions = options.crouched ? ACTIONS.filter((a) => a !== 'sprint-jump/vault') : ACTIONS;
    for (const action of actions) {
      let state = { ...createMoveState(start.x, start.y, start.z), grounded: true, crouched: options.crouched ?? false };
      let previousStage = options.stair === undefined ? -1 : stageAt(state, stairs[options.stair]!);
      for (let tick = 0; tick < PUSH + SETTLE; tick++) {
        const pushing = tick < PUSH, oldY = state.y;
        // Turn after a first sustained push: exercise chained corner/vault
        // escape attempts rather than accepting a one-direction collision.
        state = stepCharacter(state, { moveX: 0, moveY: pushing ? 1 : 0, yaw: (yaw + (tick >= 60 ? 128 : 0)) % 1024,
          sprint: pushing && (action === 'sprint/drop' || action === 'sprint-jump/vault'), jump: pushing && action === 'sprint-jump/vault',
          crouch: pushing && action === 'crouch', prone: pushing && action === 'prone' }, TICK_SECONDS, config, nearby(state));
        if (state.vault) vaultTicks++;
        if (state.y < oldY - .001) dropTicks++;
        if (!state.grounded) continue;
        const reason = options.floorOnly && state.y > .001 ? 'reached the inaccessible B9 crate top'
          : !allowed(nearby(state), state, options.surface ?? false) ? 'landed on backing plane, wall, balustrade or roof'
          : !options.surface && options.stair === undefined && state.y > 2.200001 ? 'changed from basement to another storey' : '';
        if (reason) { violations.push(`${label}/${action} from ${JSON.stringify(start)} at tick ${tick}: ${reason}: ${JSON.stringify(state)}`); break; }
        if (options.stair !== undefined) {
          const stage = stageAt(state, stairs[options.stair]!);
          if (Math.abs(stage - previousStage) > 1) {
            violations.push(`${label}/${action} skipped flight ${previousStage}→${stage}: ${JSON.stringify(state)}`); break;
          }
          previousStage = stage;
        }
      }
      expect(state.grounded, `${label}/${action}: did not settle`).toBe(true);
      expect(state.vault, `${label}/${action}: unfinished vault`).toBeNull();
      attempts++; counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  };
  for (const [i, { edge, out }] of edges(polys, 2).entries()) {
    if (contains({ x: edge.x + out.x * .2, z: edge.z + out.z * .2 })) continue;
    // The B9 lower door is a legal stair entrance, not a basement wall.
    if (edge.z >= 375.9 && edge.z <= 376.7 && edge.x >= -10 && edge.x <= -6) continue;
    attempt({ x: edge.x - out.x * .65, y: 0, z: edge.z - out.z * .65 }, out, 'basement-shell');
    if (i % 16 === 0) await yieldWorker();
  }
  // Every flight at one-metre intervals, both sides, starts on actual tread
  // support. All rest/landing and B0 opening edges remain represented.
  for (const [system, spine] of stairs.entries()) {
    for (const [i, a] of spine.slice(0, -1).entries()) {
      const b = spine[i + 1]!, length = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
      for (const side of [-1, 1]) for (let t = 1; t < length; t++) {
        const out = { x: -uz * side, z: ux * side }, p = { x: a.x + ux * t + out.x * 1.35, z: a.z + uz * t + out.z * 1.35 };
        const y = supportUnder(p.x, p.z, config.radius, Math.max(a.y, b.y) + .01,
          nearby(p).filter(isFloor), -100);
        attempt({ ...p, y }, out, `B${system === 0 ? '0' : '10'}-stage-${i}`, { stair: system });
      }
      expect(counts.get(`B${system === 0 ? '0' : '10'}-stage-${i}`) ?? 0, 'entire stair stage skipped').toBeGreaterThanOrEqual(10);
      await yieldWorker();
    }
  }
  const furniture = world.boxes.filter((b) => b.id.startsWith('depot-furniture-'));
  for (const box of furniture) {
    const poly: Polygon = [{ x: box.minX, z: box.minZ }, { x: box.maxX, z: box.minZ }, { x: box.maxX, z: box.maxZ }, { x: box.minX, z: box.maxZ }];
    for (const { edge, out } of edges([poly], 2)) attempt({ x: edge.x + out.x * .65, y: 0, z: edge.z + out.z * .65 },
      { x: -out.x, z: -out.z }, box.id, { floorOnly: box.id === 'depot-furniture-B9-crate' });
    expect(counts.get(box.id) ?? 0, `all faces skipped: ${box.id}`).toBeGreaterThanOrEqual(5);
    if (isFurniture(box)) {
      const start = { x: (box.minX + box.maxX) / 2, y: box.maxY, z: (box.minZ + box.maxZ) / 2 };
      for (let direction = 0; direction < 8; direction++) attempt(start,
        { x: Math.sin(direction * Math.PI / 4), z: Math.cos(direction * Math.PI / 4) }, `top/${box.id}`,
        { mandatory: true, crouched: box.id === 'depot-furniture-B9-crate' });
      expect(counts.get(`top/${box.id}`)).toBe(box.id === 'depot-furniture-B9-crate' ? 32 : 40);
    }
    await yieldWorker();
  }
  for (const room of rooms) for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    const p = { x: room.x + dx, y: 8, z: room.z + dz };
    if (!allowed(nearby(p), p, true) || blockedAt(p.x, p.z, config.radius, 8, .05, config.height, nearby(p))) continue;
    for (let direction = 0; direction < 8; direction++) attempt(p,
      { x: Math.sin(direction * Math.PI / 4), z: Math.cos(direction * Math.PI / 4) }, `surface-above-${room.id}`, { surface: true, mandatory: true });
    await yieldWorker();
  }
  expect(counts.get('basement-shell')).toBeGreaterThan(500);
  expect(counts.get('surface-above-B6')).toBe(360);
  expect(attempts).toBeGreaterThan(1500);
  expect(vaultTicks, 'jump input must exercise the real automatic vault').toBeGreaterThan(0);
  expect(dropTicks, 'prop tops must exercise real descending/drop movement').toBeGreaterThan(0);
  console.log('U-173 furnished depot GEO-05', JSON.stringify({ attempts, counts: Object.fromEntries(counts),
    actions: ACTIONS, pushTicks: PUSH, settleTicks: SETTLE, vaultTicks, dropTicks, violations: violations.length }));
  expect(violations, 'every attempt must retain its legal floor and adjacent stair stage').toEqual([]);
}, 240_000);
