import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, ENEMIES, blockedAt, cos, sin, supportUnder,
  wireToTable, rayWorld, type WorldBox, type WorldRay,
} from '@sandline/shared';
import { bodyParts, vehicleHitbox } from '../../../server/src/net/lagComp.ts';
import { between, sampleRoute } from './insertionScreening.ts';
import { ROAD_COMBAT } from './qalatRoadCombat.ts';
import { ROAD_SUPPORTS, buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { TANK_INGRESS, tankIngressPath } from './qalatTankIngress.ts';

type Point = { x: number; y: number; z: number };
type Target = Point & { kind: string; yaws: number[] };
type Observer = Point & { area: string };
const tank = ENEMIES['tank']!.vehicle!, world = buildRoadSupportWorld();
const yaws = Array.from({ length: 16 }, (_, i) => i * 64);
const heights = [...new Set([.05, DEFAULT_MUZZLE_RIG.proneEyeHeight, DEFAULT_MOVE_CONFIG.proneHeight,
  DEFAULT_MUZZLE_RIG.crouchEyeHeight, DEFAULT_MOVE_CONFIG.crouchHeight,
  DEFAULT_MUZZLE_RIG.eyeHeight, DEFAULT_MOVE_CONFIG.height])];
const pads = ROAD_COMBAT.regroupPads.filter((p) => ['A-C11', 'A-C12'].includes(p.cover));
const v3 = { x: 66, y: 26, z: 286 };
const PAD_GRID_M = .5, ROUTE_GRID_M = 1;
// X5 names the centre of the clear 12 m reveal mouth. The physical silhouette
// can enter that mouth while the origin remains outside it. Bound that reach
// from production capsules. Route-station resolution is reported separately
// and cannot permit an observed reveal before physical mouth entry.
const BODY_PLAN_REACH_M = Math.max(...[tank.hull, tank.turret].flatMap((part) =>
  [part.from, part.to].map(([right, _up, forward]) => Math.hypot(right, forward) + part.radius)));
const X5_REVEAL_RADIUS_M = TANK_INGRESS.carriagewayWidth / 2 + BODY_PLAN_REACH_M;
// Independently pin the canonical 12 m mouth about X5 (54,8,334). Optional
// junction support patches may be smaller without shrinking this opening.
const mouth = { minX: 48, maxX: 60, minZ: 328, maxZ: 340 };

/** Exact distance between a projected capsule axis and the reveal rectangle.
 * Segment clipping catches crossings; otherwise the closest pair includes
 * an axis endpoint or a rectangle vertex. Production axes lie above the floor,
 * so a planar capsule intersection contains actual above-floor body volume.
 */
function segmentMouthDistance(a: Point, b: Point): number {
  let lo = 0, hi = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, mouth.minX, mouth.maxX],
    [a.z, b.z - a.z, mouth.minZ, mouth.maxZ]]) {
    if (delta === 0) { if (origin! < min! || origin! > max!) hi = -1; continue; }
    const first = (min! - origin!) / delta!, second = (max! - origin!) / delta!;
    lo = Math.max(lo, Math.min(first, second)); hi = Math.min(hi, Math.max(first, second));
  }
  if (lo <= hi) return 0;
  const endpoint = (p: Point) => Math.hypot(Math.max(mouth.minX - p.x, 0, p.x - mouth.maxX),
    Math.max(mouth.minZ - p.z, 0, p.z - mouth.maxZ));
  const corners = [[mouth.minX, mouth.minZ], [mouth.minX, mouth.maxZ],
    [mouth.maxX, mouth.minZ], [mouth.maxX, mouth.maxZ]] as const;
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  return Math.min(endpoint(a), endpoint(b), ...corners.map(([x, z]) => {
    const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
    return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
  }));
}
function bodyTouchesMouth(position: Point, yaw: number): boolean {
  return bodyParts(vehicleHitbox(tank), 'standing', position, yaw).some((part) =>
    Math.min(part.a.y, part.b.y) > ROAD_SUPPORTS.floorY && segmentMouthDistance(part.a, part.b) <= part.radius);
}

/** Remove only rock in the future outpost's room/court envelopes. Existing
 * exterior landform remains available; unbuilt rooms cannot mask a leak.
 */
function outsideFutureOutpost(boxes: readonly WorldBox[]): WorldBox[] {
  let result = [...boxes];
  for (const area of [{ minX: 7, maxX: 57, minZ: 355, maxZ: 413 },
    { minX: 23, maxX: 41, minZ: 433, maxZ: 449 }]) {
    result = result.flatMap((box) => {
      const minX = Math.max(box.minX, area.minX), maxX = Math.min(box.maxX, area.maxX);
      const minZ = Math.max(box.minZ, area.minZ), maxZ = Math.min(box.maxZ, area.maxZ);
      if (minX >= maxX || minZ >= maxZ) return [box];
      return [
        { ...box, maxX: minX }, { ...box, minX: maxX },
        { ...box, minX, maxX, maxZ: minZ }, { ...box, minX, maxX, minZ: maxZ },
      ].filter((part) => part.minX < part.maxX && part.minZ < part.maxZ);
    });
  }
  return result;
}
/** Adjacent target rays usually hit the same actual solid. Cache that hit;
 * misses use the same conservative BVH/shared-rayWorld selection as the
 * insertion proof. A cached box is still ray-tested on every single query.
 */
function cachedOcclusion(boxes: readonly WorldBox[]): (ray: WorldRay) => boolean {
  interface Node { bounds: WorldBox; boxes?: readonly WorldBox[]; children?: readonly Node[] }
  const tree = (items: readonly WorldBox[]): Node => {
    const bounds: WorldBox = { id: 'query-bound', kind: 'blocker',
      minX: Math.min(...items.map((b) => b.minX)), maxX: Math.max(...items.map((b) => b.maxX)),
      minY: Math.min(...items.map((b) => b.minY)), maxY: Math.max(...items.map((b) => b.maxY)),
      minZ: Math.min(...items.map((b) => b.minZ)), maxZ: Math.max(...items.map((b) => b.maxZ)) };
    if (items.length <= 8) return { bounds, boxes: items };
    const alongX = bounds.maxX - bounds.minX > bounds.maxZ - bounds.minZ;
    const sorted = [...items].sort((a, b) => alongX ? a.minX + a.maxX - b.minX - b.maxX : a.minZ + a.maxZ - b.minZ - b.maxZ);
    const mid = Math.floor(sorted.length / 2);
    return { bounds, children: [tree(sorted.slice(0, mid)), tree(sorted.slice(mid))] };
  };
  const root = tree(boxes);
  let last: WorldBox | undefined;
  const recent: WorldBox[] = [];
  const remember = (box: WorldBox) => {
    last = box;
    if (!recent.includes(box)) {
      recent.unshift(box);
      if (recent.length > 32) recent.pop();
    }
  };
  const test = (node: Node, ray: WorldRay): boolean => {
    if (rayWorld(ray, [node.bounds]) === null) return false;
    if (node.boxes) {
      const hit = rayWorld(ray, node.boxes);
      if (hit) remember(hit.box);
      return hit !== null;
    }
    return node.children!.some((child) => test(child, ray));
  };
  return (ray) => {
    if (last && rayWorld(ray, [last])) return true;
    const hit = rayWorld(ray, recent);
    if (hit) { last = hit.box; return true; }
    return test(root, ray);
  };
}
const blocked = cachedOcclusion(outsideFutureOutpost(world.boxes.filter((box) => box.maxY > ROAD_SUPPORTS.floorY)));

/** Production capsules at their nose, rear and midsection surface extremes,
 * and production turret muzzle transforms at sixteen turning orientations.
 * Deduplication removes coincident sphere/rotation samples, never orientations.
 * This is finite 3D visibility evidence, separate from continuous hull sweep.
 */
function relativeTargets(): Target[] {
  const axes = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  const points: (Point & { kind: string; yaw: number })[] = [];
  for (const yaw of yaws) {
    for (const part of bodyParts(vehicleHitbox(tank), 'standing', { x: 0, y: 0, z: 0 }, yaw)) {
      const middle = { x: (part.a.x + part.b.x) / 2, y: (part.a.y + part.b.y) / 2, z: (part.a.z + part.b.z) / 2 };
      for (const end of [part.a, middle, part.b]) for (const axis of axes) {
        const point = { x: end.x + axis.x * part.radius, y: end.y + axis.y * part.radius,
          z: end.z + axis.z * part.radius, kind: part.part!, yaw };
        if (point.y > 0) points.push(point);
      }
      // The hull extends below its y8 floor. Its visible near-ground sphere
      // rings are real body surface points omitted by cardinal sphere poles;
      // an elevated eye may reveal these before the y9 side/nose extremes.
      if (part.part === 'hull') for (const end of [part.a, middle, part.b]) {
        for (const y of [.05, .25, .5]) {
          const vertical = y - end.y;
          if (Math.abs(vertical) > part.radius) continue;
          const horizontal = Math.sqrt(part.radius ** 2 - vertical ** 2);
          for (const axis of axes.filter((axis) => axis.y === 0)) points.push({
            x: end.x + horizontal * axis.x, y, z: end.z + horizontal * axis.z, kind: part.part, yaw,
          });
        }
      }
    }
    const angle = wireToTable(yaw), fx = sin(angle), fz = cos(angle);
    for (const [kind, muzzle] of [['cannon', tank.cannon.muzzle], ['machine-gun', tank.machineGun.muzzle]] as const) {
      const [right, up, forward] = muzzle;
      points.push({ x: -right * fz + forward * fx, y: up, z: right * fx + forward * fz, kind, yaw });
    }
  }
  const unique = new Map<string, Target>();
  for (const { yaw, ...point } of points) {
    const key = `${point.kind}:${point.x.toFixed(9)},${point.y.toFixed(9)},${point.z.toFixed(9)}`;
    const previous = unique.get(key);
    if (previous) { if (!previous.yaws.includes(yaw)) previous.yaws.push(yaw); }
    else unique.set(key, { ...point, yaws: [yaw] });
  }
  return [...unique.values()].sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
}
const relative = relativeTargets();
const at = (origin: Point): Target[] => relative.map((point) => ({
  x: origin.x + point.x, y: origin.y + point.y, z: origin.z + point.z, kind: point.kind,
  yaws: point.yaws,
}));
const padFeet = pads.flatMap((pad) => {
  const points: (Point & { area: string })[] = [];
  for (let x = pad.x - pad.w / 2; x <= pad.x + pad.w / 2 + 1e-8; x += PAD_GRID_M)
    for (let z = pad.z - pad.d / 2; z <= pad.z + pad.d / 2 + 1e-8; z += PAD_GRID_M)
      points.push({ x, y: ROAD_SUPPORTS.floorY, z, area: pad.cover });
  return points;
});
const observers: Observer[] = [...padFeet, { ...v3, area: 'V3' }]
  .flatMap((p) => heights.map((height) => ({ ...p, y: p.y + height })));
let rayQueries = 0;
const leak = (from: Observer, targets: readonly Target[]) => targets.find((to) => {
  rayQueries++;
  return !blocked(between(from, to));
});

describe('U-162 first-X5 forecourt screening', () => {
  it('screens near-ground hull rings on the final approach outside the X5 mouth', () => {
    const x5 = TANK_INGRESS.spine.find((p) => p.id === 'X5')!;
    expect(x5).toEqual({ id: 'X5', x: 54, y: 8, z: 334 });
    expect(TANK_INGRESS.carriagewayWidth).toBe(12);
    const route = sampleRoute(tankIngressPath().map((p) => [p.x, p.y, p.z]), ROUTE_GRID_M);
    const x5Index = route.findIndex((p) => p.x === x5.x && p.z === x5.z);
    const lastLeg = route.slice(0, x5Index + 1).filter((p) => Math.hypot(p.x - x5.x, p.z - x5.z) <= 20);
    const nearGround = relative.filter((target) => target.kind === 'hull' && target.y <= .5);
    for (const position of lastLeg) {
      const touching = new Set(yaws.filter((yaw) => bodyTouchesMouth(position, yaw)));
      const targets = nearGround.filter((p) => p.yaws.some((yaw) => !touching.has(yaw)))
        .map((p) => ({ ...p, x: p.x + position.x, y: p.y + position.y, z: p.z + position.z }));
      for (const from of observers) {
        const exposed = leak(from, targets);
        if (exposed) {
          throw new Error(`Near-ground approach exposes before body enters X5 mouth: ${JSON.stringify(position)}: ${JSON.stringify(from)} → ${JSON.stringify(exposed)}`);
        }
      }
    }
  }, 120_000);

  it('screens every listed X0–X4 body/turret/muzzle from both full forecourt pads and V3 at all stance/body heights', async () => {
    expect(pads.map((pad) => pad.cover)).toEqual(['A-C11', 'A-C12']);
    // The complete authored pad area remains air and supported; blockers at an
    // observer or removal of its floor must not manufacture a screening pass.
    for (const p of padFeet) {
      expect(supportUnder(p.x, p.z, .001, p.y + .05, world.boxes, 0), JSON.stringify(p)).toBe(8);
      expect(blockedAt(p.x, p.z, .001, p.y, 0, DEFAULT_MOVE_CONFIG.height, world.boxes), JSON.stringify(p)).toBe(false);
    }
    const before = rayQueries;
    for (const node of TANK_INGRESS.spine.slice(0, 5)) {
      const targets = at(node);
      for (const [index, from] of observers.entries()) {
        const exposed = leak(from, targets);
        if (exposed) throw new Error(`${node.id} ${exposed.kind} exposed ${JSON.stringify(from)} → ${JSON.stringify(exposed)}`);
        if (index % 64 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    const rays = rayQueries - before;
    expect(rays).toBeGreaterThan(500_000);
    console.log('U-162 listed first-X5 screening', JSON.stringify({ observers: observers.length,
      targets: relative.length, rays, padGridM: PAD_GRID_M, orientations: yaws.length,
      method: 'production capsule/muzzle rays; future outpost envelope excluded' }));
  }, 120_000);

  it('exposes the X5 body from V3 and both standing forecourt firing-pad centres', () => {
    const x5 = TANK_INGRESS.spine.find((node) => node.id === 'X5')!;
    const targets = at(x5).filter((target) => ['hull', 'turret'].includes(target.kind));
    for (const point of [...pads.map((pad) => ({ x: pad.x, y: 8, z: pad.z })), v3]) {
      const from = { ...point, y: point.y + DEFAULT_MUZZLE_RIG.eyeHeight, area: 'named firing centre' };
      expect(leak(from, targets), `X5 hidden from ${JSON.stringify(from)}`).toBeDefined();
    }
  });

  it('screens the whole approach outside the derived X5 reveal mouth and records first reveal across both full pads and V3', async () => {
    const path = tankIngressPath(), route = sampleRoute(path.map((p) => [p.x, p.y, p.z]), ROUTE_GRID_M);
    const x4 = TANK_INGRESS.spine.find((p) => p.id === 'X4')!, x5 = TANK_INGRESS.spine.find((p) => p.id === 'X5')!;
    const x4Index = route.findIndex((p) => p.x === x4.x && p.z === x4.z);
    const x5Index = route.findIndex((p) => p.x === x5.x && p.z === x5.z);
    expect(x4Index).toBeGreaterThan(0); expect(x5Index).toBeGreaterThan(x4Index);
    const stations = [0];
    for (let i = 1; i < route.length; i++) stations.push(stations[i - 1]! +
      Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y, route[i]!.z - route[i - 1]!.z));
    const first = new Map<Observer, { index: number; target: Target }>();
    const before = rayQueries;
    for (const [index, position] of route.slice(0, x5Index + 1).entries()) {
      const targets = at(position);
      const touching = new Set(yaws.filter((yaw) => bodyTouchesMouth(position, yaw)));
      const forbidden = targets.filter((target) => target.yaws.some((yaw) => !touching.has(yaw)));
      for (const from of observers) {
        const premature = leak(from, forbidden);
        if (premature) {
          throw new Error(`Approach reveals before matching body orientation enters actual X5 mouth: ${JSON.stringify(position)}: ${JSON.stringify(from)} → ${JSON.stringify(premature)}`);
        }
        if (forbidden.length === targets.length) continue;
        if (first.has(from)) continue;
        const exposed = leak(from, targets);
        if (!exposed) continue;
        if (index <= x4Index) throw new Error(`Pre-X4 approach exposed ${JSON.stringify(position)}: ${JSON.stringify(from)} → ${JSON.stringify(exposed)}`);
        if (Math.hypot(position.x - x5.x, position.z - x5.z) > X5_REVEAL_RADIUS_M) {
          throw new Error(`Approach reveals outside X5 mouth (${X5_REVEAL_RADIUS_M} m): ${JSON.stringify(position)}: ${JSON.stringify(from)} → ${JSON.stringify(exposed)}`);
        }
        first.set(from, { index, target: exposed });
      }
      if (index % 4 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const earliest = ['A-C11', 'A-C12', 'V3'].map((area) => {
      const witness = [...first].filter(([observer]) => observer.area === area).sort((a, b) => a[1].index - b[1].index)[0];
      expect(witness, `No X5 approach reveal from ${area}`).toBeDefined();
      const [from, reveal] = witness!;
      return { area, from, vehicleOrigin: route[reveal.index], target: reveal.target,
        routeDistanceBeforeX5M: stations[x5Index]! - stations[reveal.index]!,
        planDistanceToX5M: Math.hypot(route[reveal.index]!.x - x5.x, route[reveal.index]!.z - x5.z),
        matchingOrientationsTouchMouth: reveal.target.yaws.every((yaw) => bodyTouchesMouth(route[reveal.index]!, yaw)),
        previousHiddenOrigin: route[reveal.index - 1],
        hiddenToVisibleStepM: stations[reveal.index]! - stations[reveal.index - 1]! };
    });
    const rays = rayQueries - before;
    console.log('U-162 approach first-reveal measurement', JSON.stringify({ routeSamples: x5Index + 1,
      observers: observers.length, targets: relative.length, rays, routeGridM: ROUTE_GRID_M,
      revealMouthHalfWidthM: TANK_INGRESS.carriagewayWidth / 2,
      physicalMouth: mouth, physicalContactMethod: 'exact capsule-axis/rectangle distance, matching production yaw',
      bodyPlanReachM: BODY_PLAN_REACH_M, revealRadiusM: X5_REVEAL_RADIUS_M,
      first: earliest, method: 'finite ≤1 m full-path stations; no claim of exact continuous boundary' }));
    expect(rays).toBeGreaterThan(10_000_000);
  }, 240_000);
});
