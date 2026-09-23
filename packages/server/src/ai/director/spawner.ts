/**
 * The spawner (T-3.32): an encounter file (`data/encounters/<world>.json`)
 * played out on a session, tick by tick.
 *
 * Each group waits on its TRIGGER — the mission's start, a time since it, a
 * living squad soldier inside an area, or another group dead (every member
 * it will ever send spawned, and none alive) — then spawns in its zone, and
 * again every `waves.everySeconds` until it has sent `waves.count` waves.
 * What a wave sends is queued; each tick the queue is drained in order while
 * fewer than `aliveCap` enemies live, so waves that come faster than they
 * die wait rather than pile up.
 *
 * WHERE. A zone offers a fixed list of candidate points, nearest its centre
 * first: the centre, a ring of 6 at half its radius, a ring of 12 at its
 * edge — only those where a soldier fits (no box in its footprint) and, with
 * a navmesh, that are on it. A candidate is used only when NO human can see
 * it: a ray from every seated human's eye to each of the file's probe
 * heights above the point must meet a box. A candidate a human can see is
 * skipped for the next; one another enemy stands on is too. When none is
 * left the member waits for a later tick.
 *
 * Pure of the session: it talks to it through `SpawnerHost`, so a test can
 * give it eyes and a squad of its own.
 */
import {
  type Encounter,
  type EncounterGroup,
  type GroundArea,
  type World,
  type WorldBox,
  overlapsFootprint,
  rayWorld,
  resolveArea,
} from '@sandline/shared';
import type { EnemyPosture } from '../actions/posture.ts';
import { yawToward } from '../locomotion/followPath.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** What the spawner needs of a session. */
export interface SpawnerHost {
  /** Where every seated human's eyes are (alive or downed). */
  humanEyes(): readonly Vec3[];
  /** Where every living squad soldier stands, human or bot: who "the squad" is to an `enter` trigger. */
  squadFeet(): readonly { x: number; z: number }[];
  /** Every living enemy's feet, this spawner's or not: the alive cap counts them all. */
  enemyFeet(): readonly { x: number; z: number }[];
  isAlive(netId: number): boolean;
  /** Spawn one; null when the session refuses (its own hard cap). */
  spawn(archetype: string, at: Vec3 & { yaw: number; posture: EnemyPosture; group: number }): number | null;
  /** Snap a point onto the navmesh, or null when it is off it. Absent: every fitting point is ground. */
  ground?(p: Vec3): Vec3 | null;
}

/**
 * How big waves are and when the next one goes (T-3.33's director). Without
 * one, `FIXED_PACING`: the file as written, each wave `everySeconds` after
 * the last.
 */
export interface Pacing {
  /** A member count as a wave sends it now. */
  waveSize(count: number): number;
  /** The alive cap now, from the file's. */
  aliveCap(fileCap: number): number;
  /** Whether a group's next wave goes now, `since` seconds after its last, inside the file's bounds. */
  waveDue(since: number, waves: EncounterGroup['waves']): boolean;
}

export const FIXED_PACING: Pacing = {
  waveSize: (count) => count,
  aliveCap: (cap) => cap,
  waveDue: (since, waves) => since >= waves.everySeconds,
};

/** One spawn, or one candidate given up because a human could see it. */
export interface SpawnEvent {
  seconds: number;
  group: string;
  wave: number;
  archetype: string;
  netId: number;
  point: Vec3;
  /** Candidates of its zone a human could see, passed over before this one. */
  skippedVisible: number;
}

/** Half a soldier's footprint, metres: the capsule radius (`DEFAULT_HITBOX`). */
const FOOTPRINT_HALF_M = 0.35;
/** A candidate this near a living enemy is taken. */
const OCCUPIED_M = 1.0;
/** Boxes this far above the ground do not stop a soldier standing under them. */
const HEADROOM_M = 1.8;

/** A zone's candidate points, nearest its centre first, before the world has had its say. */
export function zoneCandidates(zone: GroundArea): { x: number; z: number }[] {
  const out = [{ x: zone.x, z: zone.z }];
  for (const [n, r] of [[6, zone.radius / 2], [12, zone.radius]] as const) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      out.push({ x: zone.x + Math.sin(a) * r, z: zone.z + Math.cos(a) * r });
    }
  }
  return out;
}

function fits(p: { x: number; z: number }, boxes: readonly WorldBox[]): boolean {
  return !boxes.some((b) => b.minY < HEADROOM_M && overlapsFootprint(p.x, p.z, FOOTPRINT_HALF_M, b));
}

/** Whether any of these eyes has a clear line to any probe above the point. */
export function seenByAny(point: Vec3, probes: readonly number[], eyes: readonly Vec3[], boxes: readonly WorldBox[]): boolean {
  for (const eye of eyes) {
    for (const h of probes) {
      const to = { x: point.x, y: point.y + h, z: point.z };
      const dx = to.x - eye.x;
      const dy = to.y - eye.y;
      const dz = to.z - eye.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length < 1e-6) return true;
      const hit = rayWorld({ origin: eye, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length }, boxes);
      if (hit === null) return true;
    }
  }
  return false;
}

interface GroupRun {
  def: EncounterGroup;
  /** Session group id its enemies share. */
  sessionGroup: number;
  firedAt: number | null;
  wavesSent: number;
  lastWaveAt: number;
  waveTimes: number[];
  spawned: number[];
}

interface Pending {
  run: GroupRun;
  wave: number;
  archetype: string;
}

export class Spawner {
  private readonly runs: GroupRun[];
  private readonly queue: Pending[] = [];
  private readonly candidates = new Map<string, Vec3[]>();
  /** Every spawn made, in order. */
  readonly log: SpawnEvent[] = [];

  constructor(
    readonly encounter: Encounter,
    private readonly world: World,
    private readonly host: SpawnerHost,
    /** The first session group id to hand out; one per encounter group. */
    firstGroupId = 1000,
    private readonly pacing: Pacing = FIXED_PACING,
  ) {
    if (encounter.world !== world.id) throw new Error(`encounter for '${encounter.world}' on world '${world.id}'`);
    this.runs = encounter.groups.map((def, i) => ({ def, sessionGroup: firstGroupId + i, firedAt: null, wavesSent: 0, lastWaveAt: 0, waveTimes: [], spawned: [] }));
    for (const zone of world.mission!.spawnZones) {
      const points: Vec3[] = [];
      for (const c of zoneCandidates(zone)) {
        if (!fits(c, world.boxes)) continue;
        const at = { x: c.x, y: 0, z: c.z };
        const ground = host.ground ? host.ground(at) : at;
        if (ground) points.push(ground);
      }
      this.candidates.set(zone.id, points);
    }
  }

  /** The candidate points of a zone, in the order they are tried. */
  candidatesOf(zoneId: string): readonly Vec3[] {
    return this.candidates.get(zoneId) ?? [];
  }

  /** Whether a group has fired, by id. */
  fired(groupId: string): boolean {
    return this.run(groupId).firedAt !== null;
  }

  /** The netIds a group has spawned, in order. */
  spawnedBy(groupId: string): readonly number[] {
    return this.run(groupId).spawned;
  }

  /** When each wave of a group was sent, seconds. */
  wavesOf(groupId: string): readonly number[] {
    return this.run(groupId).waveTimes;
  }

  /** Members queued and not yet placed. */
  get pending(): number {
    return this.queue.length;
  }

  /** A group is dead once every member it will send has been placed and none of them lives. */
  dead(groupId: string): boolean {
    const run = this.run(groupId);
    if (run.firedAt === null || run.wavesSent < run.def.waves.count) return false;
    if (this.queue.some((p) => p.run === run)) return false;
    return run.spawned.every((id) => !this.host.isAlive(id));
  }

  private run(groupId: string): GroupRun {
    const run = this.runs.find((r) => r.def.id === groupId);
    if (!run) throw new Error(`no group '${groupId}'`);
    return run;
  }

  private triggered(run: GroupRun, seconds: number): boolean {
    const t = run.def.trigger;
    switch (t.kind) {
      case 'start':
        return true;
      case 'time':
        return seconds >= t.seconds;
      case 'enter': {
        const area = resolveArea(t.area, this.encounter, this.world);
        return this.host.squadFeet().some((p) => Math.sqrt((p.x - area.x) ** 2 + (p.z - area.z) ** 2) <= area.radius);
      }
      case 'dead':
        return this.dead(t.group);
    }
  }

  private enqueue(run: GroupRun, seconds: number): void {
    run.wavesSent++;
    run.lastWaveAt = seconds;
    run.waveTimes.push(seconds);
    // Sized now, by the pacing: a wave already on its way keeps its size.
    for (const m of run.def.members) {
      const count = this.pacing.waveSize(m.count);
      for (let i = 0; i < count; i++) this.queue.push({ run, wave: run.wavesSent, archetype: m.archetype });
    }
  }

  /** The posture a member of `def` spawns in, resolved at `at`. */
  private postureFor(def: EncounterGroup, at: Vec3): EnemyPosture {
    const start = this.world.mission!.start;
    const p = def.posture;
    if (p.kind === 'hold') {
      const face = resolveArea(p.face, this.encounter, this.world);
      return { kind: 'hold', post: { ...at }, face: { x: face.x, z: face.z }, route: [], area: null, leg: 0 };
    }
    if (p.kind === 'patrol') return { kind: 'patrol', post: { ...at }, face: { x: start.x, z: start.z }, route: p.route.map((q) => ({ ...q })), area: null, leg: 1 };
    const area = resolveArea(p.at, this.encounter, this.world);
    return { kind: 'garrison', post: { ...at }, face: { x: start.x, z: start.z }, route: [], area: { ...area }, leg: 0 };
  }

  /** Fire triggers, send waves, and place what the cap and the eyes allow. Call once a tick, with seconds since the mission began. */
  step(seconds: number): void {
    for (const run of this.runs) {
      if (run.firedAt === null) {
        if (!this.triggered(run, seconds)) continue;
        run.firedAt = seconds;
        this.enqueue(run, seconds);
      } else if (run.wavesSent < run.def.waves.count && this.pacing.waveDue(seconds - run.lastWaveAt, run.def.waves)) {
        this.enqueue(run, seconds);
      }
    }
    if (this.queue.length === 0) return;

    const eyes = this.host.humanEyes();
    const taken = this.host.enemyFeet().map((p) => ({ x: p.x, z: p.z }));
    let alive = taken.length;
    /** Zones with nowhere left this tick: later members for them wait too. */
    const full = new Set<string>();
    const cap = this.pacing.aliveCap(this.encounter.aliveCap);
    for (let i = 0; i < this.queue.length && alive < cap; ) {
      const item = this.queue[i]!;
      const zone = item.run.def.zone;
      if (full.has(zone)) {
        i++;
        continue;
      }
      let skippedVisible = 0;
      let point: Vec3 | null = null;
      for (const c of this.candidatesOf(zone)) {
        if (taken.some((q) => Math.sqrt((q.x - c.x) ** 2 + (q.z - c.z) ** 2) < OCCUPIED_M)) continue;
        if (seenByAny(c, this.encounter.probes, eyes, this.world.boxes)) {
          skippedVisible++;
          continue;
        }
        point = c;
        break;
      }
      if (!point) {
        full.add(zone);
        i++;
        continue;
      }
      const posture = this.postureFor(item.run.def, point);
      const face = posture.kind === 'patrol' ? posture.route[0]! : posture.face;
      const yaw = yawToward(face.x - point.x, face.z - point.z);
      const netId = this.host.spawn(item.archetype, { ...point, yaw, posture, group: item.run.sessionGroup });
      if (netId === null) return;
      item.run.spawned.push(netId);
      this.log.push({ seconds, group: item.run.def.id, wave: item.wave, archetype: item.archetype, netId, point: { ...point }, skippedVisible });
      taken.push({ x: point.x, z: point.z });
      alive++;
      this.queue.splice(i, 1);
    }
  }
}
