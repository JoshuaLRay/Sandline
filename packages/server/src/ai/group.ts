/**
 * Suppress and flank (T-3.21): enemies spawned together share a group.
 *
 * The group has a blackboard of its own — its target, where that target was
 * last known, whether it is pinned — and hands out roles. When every member
 * has lost sight of the target for `pinSeconds` (it has gone to ground), one
 * member becomes the **suppressor**, firing at the target's last known
 * position without a line of sight to keep its head down, and another the
 * **flanker**, sent to a cover point from which a standing eye sees the
 * target's crouched body — its concealed side — along a navmesh path that
 * prices the ground the target can see (`NavMesh.pathAvoiding`). Everyone
 * else fights as a rifleman does. Roles are kept while the target is known,
 * so its peeking over its cover does not reshuffle them; they end when it is
 * lost, dies, or the group falls below two.
 *
 * Server-only (§7.9 rule 2); deterministic — ties go to the lower netId and
 * the earlier baked point. The members' own leaves read the group through
 * their body (`actions/combat.ts`).
 */
import { DEFAULT_MUZZLE_RIG, type TargetMemory, type WorldBox, rayWorld } from '@sandline/shared';
import { type CoverSystem, DEFAULT_COVER_BODY } from './cover.ts';
import type { CoverPoint } from './nav/baked/types.ts';
import type { NavMesh, NavPath, NavPoint } from './nav/NavMesh.ts';
import RAW_GROUP from './group.json' with { type: 'json' };

type Vec3 = { x: number; y: number; z: number };

export type GroupRole = 'suppressor' | 'flanker';

/** A path query against polygons already marked to avoid (`NavMesh.avoiding`). */
type PathOf = (from: NavPoint, to: NavPoint, searchM?: number) => NavPath | null;

/** Group tuning (`group.json`). */
export interface GroupConfig {
  pinSeconds: number;
  suppressAimUpM: number;
  flankMinM: number;
  flankMaxM: number;
  flankExposureCost: number;
  waypointM: number;
  waypointGridM: number;
  waypointSearchM: number;
}

class GroupDataError extends Error {}

export function parseGroupConfig(raw: unknown): GroupConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new GroupDataError('group: expected an object');
  const row = raw as Record<string, unknown>;
  const keys = ['$comment', 'pinSeconds', 'suppressAimUpM', 'flankMinM', 'flankMaxM', 'flankExposureCost', 'waypointM', 'waypointGridM', 'waypointSearchM'];
  for (const k of Object.keys(row)) if (!keys.includes(k)) throw new GroupDataError(`group: unknown key "${k}"`);
  const num = (key: string, min: number, max: number): number => {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new GroupDataError(`group.${key} must be a finite number, got ${String(v)}`);
    if (v < min || v > max) throw new GroupDataError(`group.${key} must be in [${min}, ${max}], got ${v}`);
    return v;
  };
  const out = {
    pinSeconds: num('pinSeconds', 0, 30),
    suppressAimUpM: num('suppressAimUpM', 0, 3),
    flankMinM: num('flankMinM', 0, 100),
    flankMaxM: num('flankMaxM', 1, 200),
    // At least 1: a penalty below 1 would draw the route INTO the target's sight.
    flankExposureCost: num('flankExposureCost', 1, 100),
    waypointM: num('waypointM', 0.1, 10),
    waypointGridM: num('waypointGridM', 0.5, 20),
    waypointSearchM: num('waypointSearchM', 0, 60),
  };
  if (out.flankMaxM <= out.flankMinM) throw new GroupDataError('group: flankMaxM is not above flankMinM');
  return out;
}

export const GROUP: GroupConfig = parseGroupConfig(RAW_GROUP);

/** A member as the group sees it: enough of an `EnemyEntity` to plan with. */
export interface GroupMember {
  readonly netId: number;
  readonly state: Readonly<Vec3>;
  readonly alive: boolean;
  readonly memory: TargetMemory;
  readonly target: number | null;
  /** T-3.23: the role its archetype is handed first (the MG suppresses), or null. */
  readonly prefers?: GroupRole | null;
}

/** What a group plans against: the session's cover, geometry and mesh. */
export interface GroupWorld {
  readonly cover: CoverSystem | null;
  readonly boxes: readonly WorldBox[];
  readonly mesh: NavMesh | null;
}

/** The flank in progress: who, where to, and the route there. */
export interface Flank {
  readonly netId: number;
  readonly point: CoverPoint;
  readonly route: readonly NavPoint[];
  /** Index of the route point it is walking to. */
  waypoint: number;
  /** Set once it has reached the point. */
  arrived: boolean;
}

function clear(from: Vec3, to: Vec3, boxes: readonly WorldBox[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-9) return true;
  return rayWorld({ origin: from, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length }, boxes) === null;
}

/**
 * The low body at `feet` — shin and crouched chest, not the head: what hides
 * behind low cover, prone or crouched. Seeing one of these is seeing round
 * or over the cover, not merely over its top edge to where a head would be.
 */
export function concealedProbes(feet: Vec3): Vec3[] {
  return DEFAULT_COVER_BODY.crouched.slice(0, 2).map((h) => ({ x: feet.x, y: feet.y + h, z: feet.z }));
}

/** Whether a standing soldier at `from` sees the low body at `feet`: sight of its concealed side. */
export function seesConcealed(from: Vec3, feet: Vec3, boxes: readonly WorldBox[]): boolean {
  const eye = { x: from.x, y: from.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: from.z };
  return concealedProbes(feet).some((p) => clear(eye, p, boxes));
}

/** Whether a standing eye at `eyeFeet` sees a soldier's chest standing at `at`: ground the flank route prices. */
export function seesGround(eyeFeet: Vec3, at: Vec3, boxes: readonly WorldBox[]): boolean {
  return clear(
    { x: eyeFeet.x, y: eyeFeet.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: eyeFeet.z },
    { x: at.x, y: at.y + DEFAULT_COVER_BODY.standing[1]!, z: at.z },
    boxes,
  );
}

/**
 * A route's length with the stretches the target at `feet` can see priced
 * `cost` times over, sampled every half metre: how the group compares flanks.
 */
export function pricedLength(points: readonly Vec3[], feet: Vec3, boxes: readonly WorldBox[], cost: number): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let k = 0; k < steps; k++) {
      const f = (k + 0.5) / steps;
      const at = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      total += (len / steps) * (seesGround(feet, at, boxes) ? cost : 1);
    }
  }
  return total;
}

export class EnemyGroup {
  readonly members: number[] = [];
  /** The target it is fighting, by consensus of its members' own choices. */
  target: number | null = null;
  /** Where the target's feet were last known, from the freshest member memory. */
  targetFeet: Vec3 | null = null;
  /** When every member last had it out of sight continuously from, seconds, or null while one sees it. */
  concealedSince: number | null = null;
  readonly roles = new Map<number, GroupRole>();
  flank: Flank | null = null;
  /**
   * Where the suppressor fires from: where it stood when it got the role if
   * it could see its aim point from there, else the nearest free cover point
   * that can. Null while there is no suppressor.
   */
  suppressFrom: NavPoint | null = null;

  constructor(
    readonly id: number,
    private readonly config: GroupConfig = GROUP,
  ) {}

  add(netId: number): void {
    if (!this.members.includes(netId)) this.members.push(netId);
  }

  role(netId: number): GroupRole | null {
    return this.roles.get(netId) ?? null;
  }

  /** Where a suppressor aims: just over the target's cover, at its last known position. */
  suppressPoint(): Vec3 | null {
    const f = this.targetFeet;
    return f ? { x: f.x, y: f.y + this.config.suppressAimUpM, z: f.z } : null;
  }

  /** Whether the target is pinned: out of every member's sight for `pinSeconds`. */
  pinned(now: number): boolean {
    return this.concealedSince !== null && now - this.concealedSince >= this.config.pinSeconds;
  }

  /**
   * One group think: settle the target and where it is, whether it is
   * pinned, and the roles. `members` is every member, living or dead.
   */
  think(members: readonly GroupMember[], world: GroupWorld, now: number): void {
    const living = members.filter((m) => m.alive);
    for (const m of members) {
      if (m.alive) continue;
      this.roles.delete(m.netId);
      if (this.flank?.netId === m.netId) this.endFlank(world);
    }

    // The target: the one most members have chosen, ties to the lower netId.
    const votes = new Map<number, number>();
    for (const m of living) if (m.target !== null) votes.set(m.target, (votes.get(m.target) ?? 0) + 1);
    let target: number | null = null;
    for (const [id, n] of [...votes].sort((a, b) => a[0] - b[0])) if (target === null || n > (votes.get(target) ?? 0)) target = id;
    if (target !== this.target) {
      this.target = target;
      this.concealedSince = null;
      this.clearRoles(world);
    }
    if (target === null) {
      this.targetFeet = null;
      return;
    }

    // Where it was last known, and whether anyone sees it now.
    let freshest = -Infinity;
    let seen = false;
    for (const m of living) {
      const entry = m.memory.entries.get(target);
      if (!entry) continue;
      if (entry.visible) seen = true;
      if (entry.updatedAt > freshest) {
        freshest = entry.updatedAt;
        // A heard shot is placed at the shooter's eye; a sighting at its feet.
        const lifted = entry.y - m.state.y > DEFAULT_MUZZLE_RIG.eyeHeight * 0.5;
        this.targetFeet = { x: entry.x, y: lifted ? entry.y - DEFAULT_MUZZLE_RIG.eyeHeight : entry.y, z: entry.z };
      }
    }
    if (seen) this.concealedSince = null;
    else this.concealedSince ??= now;

    if (living.length < 2) {
      this.clearRoles(world);
      return;
    }
    if (this.roles.size === 0 && this.pinned(now)) this.assign(living, world);
    // A flanker walks its route: the next point once it is near this one.
    const flank = this.flank;
    if (flank) {
      const me = living.find((m) => m.netId === flank.netId);
      if (me) {
        const next = flank.route[flank.waypoint];
        if (next && Math.hypot(me.state.x - next.x, me.state.z - next.z) <= this.config.waypointM && flank.waypoint < flank.route.length - 1) flank.waypoint++;
        // At the point, by the fighting leaves' own measure (0.4 m, `actions/rifleman.ts`).
        if (Math.hypot(me.state.x - flank.point.x, me.state.z - flank.point.z) <= 0.4) flank.arrived = true;
      }
    }
  }

  /**
   * Hand out the roles. The flanker and its point are the pair with the
   * cheapest priced route (ground the target can see costing
   * `flankExposureCost` times as much), so a longer covered way round beats a
   * short walk in the open; the suppressor is, of the rest, the nearest to
   * the target that can see the spot it will fire at, or the nearest if none
   * can. T-3.23: a member that prefers to suppress (the MG) is never the
   * flanker, and of the rest is the suppressor if any is; a group of nothing
   * but such members gets no roles. Nothing is assigned when no flank point exists — a suppressor alone
   * pins nobody the group can then kill.
   */
  private assign(living: readonly GroupMember[], world: GroupWorld): void {
    const feet = this.targetFeet;
    const cover = world.cover;
    if (!feet || !cover) return;
    const { flankMinM, flankMaxM, flankExposureCost } = this.config;
    const candidates = cover.points
      .map((point, index) => ({ point, index }))
      .filter(({ point, index }) => {
        const holder = cover.holder(index);
        if (holder !== null && !living.some((m) => m.netId === holder)) return false;
        const d = Math.hypot(point.x - feet.x, point.z - feet.z);
        return d >= flankMinM && d <= flankMaxM && seesConcealed(point, feet, world.boxes);
      });
    if (candidates.length === 0) return;
    // What the target sees, once for every route this assignment prices.
    const seen = this.seenPolygons(feet, world);
    let best = null as { member: GroupMember; point: CoverPoint; index: number; cost: number; route: NavPoint[] } | null;
    // A member that would rather suppress (the MG) is not sent round, while anyone else can be.
    const rather = (m: GroupMember) => m.prefers === 'suppressor';
    const flankers = living.some((m) => !rather(m)) ? living.filter((m) => !rather(m)) : [];
    // Every route against one marking of what the target sees (`NavMesh.avoiding`): the same routes, priced once.
    const price = (pathOf?: PathOf) => {
      for (const member of [...flankers].sort((a, b) => a.netId - b.netId)) {
        for (const c of candidates) {
          const route = this.route(member.state, c.point, seen, world, pathOf);
          if (!route) continue;
          const cost = pricedLength([member.state, ...route], feet, world.boxes, flankExposureCost);
          if (!best || cost < best.cost) best = { member, point: c.point, index: c.index, cost, route };
        }
      }
    };
    if (world.mesh && seen) world.mesh.avoiding((poly) => seen.has(poly.ref), flankExposureCost, price);
    else price();
    if (!best) return;
    const chosen = best;
    const aim = this.suppressPoint()!;
    const others = living.filter((m) => m.netId !== chosen.member.netId);
    const near = (m: GroupMember) => Math.hypot(m.state.x - feet.x, m.state.z - feet.z);
    // One whose archetype suppresses first, if there is one (T-3.23); of those, one that sees the spot.
    const preferred = others.filter((m) => m.prefers === 'suppressor');
    const candidatesFor = preferred.length > 0 ? preferred : others;
    const withSight = candidatesFor.filter((m) => clear({ x: m.state.x, y: m.state.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: m.state.z }, aim, world.boxes));
    const pool = withSight.length > 0 ? withSight : candidatesFor;
    const suppressor = pool.reduce((a, b) => (near(a) <= near(b) ? a : b));
    cover.reserve(chosen.member.netId, chosen.index);
    this.suppressFrom = this.suppressSpot(suppressor, aim, chosen.index, world);
    this.roles.set(chosen.member.netId, 'flanker');
    this.roles.set(suppressor.netId, 'suppressor');
    const route = this.refine(chosen.member.state, chosen.route, feet, world);
    this.flank = { netId: chosen.member.netId, point: chosen.point, route, waypoint: 0, arrived: false };
  }

  /**
   * Where `suppressor` should fire from: where it stands, if its standing eye
   * sees `aim`; else the nearest free cover point (not the flank's) that does,
   * reserved for it; else where it stands, for want of better.
   */
  private suppressSpot(suppressor: GroupMember, aim: Vec3, flankIndex: number, world: GroupWorld): NavPoint {
    const eyeAt = (p: Vec3) => ({ x: p.x, y: p.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: p.z });
    const here = { x: suppressor.state.x, y: suppressor.state.y, z: suppressor.state.z };
    if (clear(eyeAt(here), aim, world.boxes) || !world.cover) return here;
    const cover = world.cover;
    let best: { index: number; d: number } | null = null;
    cover.points.forEach((p, index) => {
      if (index === flankIndex) return;
      const holder = cover.holder(index);
      if (holder !== null && holder !== suppressor.netId) return;
      if (!clear(eyeAt(p), aim, world.boxes)) return;
      const d = Math.hypot(p.x - here.x, p.z - here.z);
      if (!best || d < best.d) best = { index, d };
    });
    if (!best) return here;
    const { index } = best;
    cover.reserve(suppressor.netId, index);
    const p = cover.points[index]!;
    return { x: p.x, y: p.y, z: p.z };
  }

  /**
   * The polygons the target at `feet` can see any of — centre or corner, for
   * open-floor polygons are large and one judged by its centre alone can be
   * half in plain view. Null without a mesh.
   */
  private seenPolygons(feet: Vec3, world: GroupWorld): Set<number> | null {
    if (!world.mesh) return null;
    const seen = new Set<number>();
    for (const poly of world.mesh.polygons()) {
      if (seesGround(feet, poly.centre, world.boxes) || poly.corners.some((c) => seesGround(feet, c, world.boxes))) seen.add(poly.ref);
    }
    return seen;
  }

  /** The flanker's route: the target's sight priced, on the mesh; a straight line without one. */
  route(from: Vec3, point: CoverPoint, seen: Set<number> | null, world: GroupWorld, pathOf?: PathOf): NavPoint[] | null {
    const to = { x: point.x, y: point.y, z: point.z };
    if (!world.mesh || !seen) return [to];
    const path = pathOf ? pathOf(from, to, 4) : world.mesh.pathAvoiding(from, to, (poly) => seen.has(poly.ref), this.config.flankExposureCost, 4);
    return path ? [...path.points.slice(1), to] : null;
  }

  /**
   * The chosen route, refined: the priced path as Detour found it, or a way
   * through one hidden stopover if that prices cheaper. Detour prices a whole
   * polygon at once, and on an untiled mesh over open ground a polygon spans
   * tens of metres — a covered strip behind a wall shares one with the open
   * field in front of it, and the filter cannot tell them apart. So points on
   * a `waypointGridM` grid round the route, on the mesh and out of the
   * target's sight, are each tried as a stopover, and the cheapest priced
   * route of all wins. Done once, when the flank is handed out.
   */
  private refine(from: Vec3, route: NavPoint[], feet: Vec3, world: GroupWorld): NavPoint[] {
    const mesh = world.mesh;
    if (!mesh || route.length === 0) return route;
    const goal = route[route.length - 1]!;
    const cost = this.config.flankExposureCost;
    let best = route;
    let bestCost = pricedLength([from, ...route], feet, world.boxes, cost);
    const margin = this.config.waypointSearchM;
    const step = this.config.waypointGridM;
    const minX = Math.min(from.x, goal.x) - margin;
    const maxX = Math.max(from.x, goal.x) + margin;
    const minZ = Math.min(from.z, goal.z) - margin;
    const maxZ = Math.max(from.z, goal.z) + margin;
    for (let x = minX; x <= maxX; x += step) {
      for (let z = minZ; z <= maxZ; z += step) {
        const near = mesh.nearestPoint({ x, y: feet.y, z });
        if (!near || Math.hypot(near.point.x - x, near.point.z - z) > step / 2) continue;
        const via = near.point;
        if (seesGround(feet, via, world.boxes)) continue;
        const a = mesh.path(from, via, 4);
        const b = mesh.path(via, goal, 4);
        if (!a || !b) continue;
        const candidate = [...a.points.slice(1), ...b.points.slice(1), goal];
        const c = pricedLength([from, ...candidate], feet, world.boxes, cost);
        if (c < bestCost) {
          bestCost = c;
          best = candidate;
        }
      }
    }
    return best;
  }

  private endFlank(world: GroupWorld): void {
    if (this.flank) world.cover?.release(this.flank.netId);
    this.flank = null;
  }

  private clearRoles(world: GroupWorld): void {
    this.roles.clear();
    this.suppressFrom = null;
    this.endFlank(world);
  }
}
