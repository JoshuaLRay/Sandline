/**
 * The grey-box mission map (T-3.31), from the committed bake: two approach
 * routes from the squad start to the objective that are connected and
 * mostly apart, every spawn zone on the mesh, cover along each route, the
 * overwatch route's long sight lines and the assault route's lack of them,
 * and a soldier walking either route in the controller without sticking.
 *
 * The thresholds are the world file's own (`mission.checks`), not numbers
 * of this test's: the map and what it promises are one piece of data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG,
  DEFAULT_MUZZLE_RIG,
  type MissionRoute,
  SPAWN_POINTS,
  TICK_SECONDS,
  type WorldMission,
  createMoveState,
  rayWorld,
  requireWorld,
} from '@sandline/shared';
import { NavMesh, type NavPoint, initNav, pathLength } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, bakedNavFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { DEFAULT_NAV_AGENT, navBakeHash, onMesh } from './bake.ts';

const ID = 'greybox-01';
const world = requireWorld(ID);
const mission = world.mission as WorldMission;
const checks = mission.checks;
const TICK_MS = 1000 / 30;
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** A leg of a route is connected when its path ends this near where it was asked to go. */
const REACH_M = 0.5;

interface Walked {
  route: MissionRoute;
  /** The route's navmesh path, leg after leg: start → via… → objective. */
  points: NavPoint[];
  corridor: Set<number>;
  length: number;
  /** Every `sampleM` along `points`. */
  samples: NavPoint[];
}

function stops(route: MissionRoute): NavPoint[] {
  return [
    { x: mission.start.x, y: 0, z: mission.start.z },
    ...route.via.map((p) => ({ x: p.x, y: 0, z: p.z })),
    { x: mission.objective.x, y: 0, z: mission.objective.z },
  ];
}

function sampleAlong(points: readonly NavPoint[], step: number): NavPoint[] {
  const out: NavPoint[] = [{ ...points[0]! }];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    let t = step - carry;
    while (t <= length) {
      const f = t / length;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
      t += step;
    }
    carry = length - (t - step);
  }
  return out;
}

function walk(mesh: NavMesh, route: MissionRoute): Walked {
  const at = stops(route);
  const points: NavPoint[] = [];
  const corridor = new Set<number>();
  for (let i = 1; i < at.length; i++) {
    const path = mesh.path(at[i - 1]!, at[i]!);
    expect(path, `${route.id}: no path for leg ${i}`).not.toBeNull();
    expect(flat(path!.points.at(-1)!, at[i]!), `${route.id}: leg ${i} stops short`).toBeLessThanOrEqual(REACH_M);
    points.push(...(i === 1 ? path!.points : path!.points.slice(1)));
    for (const ref of path!.corridor) corridor.add(ref);
  }
  return { route, points, corridor, length: pathLength(points), samples: sampleAlong(points, checks.sampleM) };
}

describe('the grey-box mission map (T-3.31)', () => {
  let mesh: NavMesh;
  let routes: Walked[];
  const byRole = (role: MissionRoute['role']) => routes.find((r) => r.route.role === role)!;

  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh(ID);
    routes = mission.routes.map((r) => walk(mesh, r));
  });

  it('is a named world with a mission, and its committed bake is fresh', () => {
    expect(mission.routes.map((r) => r.role).sort()).toEqual(['assault', 'overwatch']);
    expect(bakedNavFor(ID)?.hash).toBe(navBakeHash(world));
  });

  it('starts the squad on the spawn line, on the mesh, with the objective on it too', () => {
    for (const p of SPAWN_POINTS) {
      expect(flat(p, mission.start)).toBeLessThanOrEqual(mission.start.radius);
      expect(onMesh(mesh, p, DEFAULT_NAV_AGENT.climb)).toBe(true);
    }
    expect(onMesh(mesh, { x: mission.objective.x, y: 0, z: mission.objective.z }, DEFAULT_NAV_AGENT.climb)).toBe(true);
  });

  it('has both routes connected from start to objective, and apart for the share the file asks', () => {
    for (const r of routes) {
      const other = routes.find((o) => o !== r)!;
      const apart = r.samples.filter((s) => {
        const hit = mesh.nearestPoint(s);
        return hit !== null && !other.corridor.has(hit.polyRef);
      }).length;
      const share = apart / r.samples.length;
      console.log(`[greybox] ${r.route.id}: ${r.length.toFixed(1)} m, ${(share * 100).toFixed(0)}% on polygons the other never touches (floor ${checks.minDistinctShare * 100}%)`);
      expect(share).toBeGreaterThanOrEqual(checks.minDistinctShare);
    }
  });

  it('keeps each route to its own lane: the overwatch west of the spine, the assault east', () => {
    const lane = (r: Walked) => r.samples.filter((s) => s.z > 8 && s.z < 58);
    expect(lane(byRole('overwatch')).every((s) => s.x < -3)).toBe(true);
    expect(lane(byRole('assault')).every((s) => s.x > 3)).toBe(true);
  });

  it('has every spawn zone on the mesh — its centre and its rim — and each on what it names', () => {
    for (const zone of mission.spawnZones) {
      const ring = [{ x: zone.x, z: zone.z }];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ring.push({ x: zone.x + Math.sin(a) * zone.radius, z: zone.z + Math.cos(a) * zone.radius });
      }
      for (const p of ring) expect(onMesh(mesh, { x: p.x, y: 0, z: p.z }, DEFAULT_NAV_AGENT.climb), `${zone.id} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(true);
      if (zone.on === 'objective') {
        // Behind it: further up range than the objective.
        expect(zone.z).toBeGreaterThan(mission.objective.z);
      } else {
        // Beside its route, and not beside the other.
        const near = (r: Walked) => Math.min(...r.samples.map((s) => flat(s, zone)));
        const own = routes.find((r) => r.route.id === zone.on)!;
        const other = routes.find((r) => r.route.id !== zone.on)!;
        expect(near(own)).toBeLessThan(near(other));
        expect(near(own)).toBeLessThanOrEqual(15);
      }
    }
    expect(mission.spawnZones.map((z) => z.on).sort()).toEqual(['assault', 'objective', 'overwatch']);
  });

  it('has cover along each route: no stretch longer than its role allows without a cover point near', () => {
    const cover = bakedCoverFor(ID);
    for (const r of routes) {
      let longest = 0;
      let run = 0;
      let covered = 0;
      for (const s of r.samples) {
        if (cover.some((c) => flat(c, s) <= checks.coverWithinM)) {
          covered++;
          run = 0;
        } else {
          run += checks.sampleM;
          longest = Math.max(longest, run);
        }
      }
      const cap = checks.maxUncoveredM[r.route.role];
      console.log(`[greybox] ${r.route.id}: covered at ${((covered / r.samples.length) * 100).toFixed(0)}% of samples, longest uncovered ${longest.toFixed(1)} m (cap ${cap} m)`);
      expect(longest).toBeLessThanOrEqual(cap);
    }
    // The assault route is the close one.
    expect(checks.maxUncoveredM.assault).toBeLessThan(checks.maxUncoveredM.overwatch);
  });

  it('gives the overwatch route long sight lines along itself, and the assault route none that long', () => {
    const eye = DEFAULT_MUZZLE_RIG.eyeHeight;
    const longestSight = (r: Walked) => {
      const pts = sampleAlong(r.points, 2);
      let best = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i]!;
          const b = pts[j]!;
          const d = Math.hypot(b.x - a.x, b.z - a.z);
          if (d <= best) continue;
          const from = { x: a.x, y: a.y + eye, z: a.z };
          const dy = b.y - a.y;
          const len = Math.hypot(b.x - a.x, dy, b.z - a.z);
          const ray = { origin: from, direction: { x: (b.x - a.x) / len, y: dy / len, z: (b.z - a.z) / len }, maxDistance: len };
          if (rayWorld(ray, world.boxes) === null) best = d;
        }
      }
      return best;
    };
    const overwatch = longestSight(byRole('overwatch'));
    const assault = longestSight(byRole('assault'));
    console.log(`[greybox] longest clear sight line along a route: overwatch ${overwatch.toFixed(1)} m, assault ${assault.toFixed(1)} m (the line ${checks.sightM} m)`);
    expect(overwatch).toBeGreaterThanOrEqual(checks.sightM);
    expect(assault).toBeLessThan(checks.sightM);
  });

  describe('a soldier walks either route in the controller (path following)', () => {
    for (const role of ['overwatch', 'assault'] as const) {
      it(`${role}: start to objective through each via, arriving at every stop, never stuck`, () => {
        const route = mission.routes.find((r) => r.role === role)!;
        const session = new Session(undefined, '', world);
        const slot = session.slots[0]!;
        slot.state = createMoveState(mission.start.x, 0, mission.start.z);
        const follower = new PathFollower(mesh, world.boxes);
        let now = 0;
        let ticks = 0;
        let walked = 0;
        const at = stops(route).slice(1);
        for (const goal of at) {
          let arrived = false;
          for (let t = 0; t < 2400 && !arrived; t++) {
            const { input, status } = follower.step(slot.state, { goal, pace: 'walk' }, slot.yaw);
            if (status === 'arrived') {
              arrived = true;
              break;
            }
            slot.input = input;
            const before = { x: slot.state.x, z: slot.state.z };
            now += TICK_MS;
            session.step(now);
            walked += flat(before, slot.state);
            ticks++;
          }
          expect(arrived, `${role}: never reached ${goal.x}, ${goal.z}`).toBe(true);
        }
        const ideal = routes.find((r) => r.route.role === role)!.length / (DEFAULT_MOVE_CONFIG.walkSpeed * TICK_SECONDS);
        console.log(`[greybox] walked the ${role} route: ${walked.toFixed(1)} m in ${ticks} ticks (ideal ${ideal.toFixed(0)}), ${follower.repaths} stuck repaths`);
        expect(follower.repaths).toBe(0);
        expect(ticks).toBeLessThanOrEqual(Math.ceil(1.15 * ideal));
        expect(flat(slot.state, mission.objective)).toBeLessThanOrEqual(mission.objective.radius);
      });
    }
  });
});
