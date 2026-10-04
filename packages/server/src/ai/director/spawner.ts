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
 * WHY NOTHING CAME (U-001). A group can be waiting on its trigger, have
 * members queued that the cap or the eyes hold back, be down to stragglers,
 * be beaten, or have been stopped by the script; `status` says which, and how
 * many queued members the last step could not place and why, so a report of
 * an empty map can be read off the session rather than guessed.
 *
 * Pure of the session: it talks to it through `SpawnerHost`, so a test can
 * give it eyes and a squad of its own.
 */
import {
  getEnemy,
  DEFAULT_MOVE_CONFIG,
  type Encounter,
  type EncounterGroup,
  type GroundArea,
  type World,
  type WorldBox,
  overlapsFootprint,
  rayWorld,
  resolveArea,
  areaContains,
} from '@sandline/shared';
import { spawnGround, SPAWN_ON_MESH_M } from './spawnGround.ts';
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
  squadFeet(): readonly { x: number; y?: number; z: number }[];
  /** Every living enemy's feet, this spawner's or not: the alive cap counts them all. */
  enemyFeet(): readonly { x: number; y?: number; z: number }[];
  isAlive(netId: number): boolean;
  /** Spawn one; null when the session refuses (its own hard cap). */
  spawn(archetype: string, at: Vec3 & { yaw: number; posture: EnemyPosture; group: number; captive?: boolean; path?: readonly { x: number; z: number }[] }): number | null;
  /** Snap a point onto the navmesh, or null when it is off it. Absent: every fitting point is ground. */
  ground?(p: Vec3, authoredY?: number): Vec3 | null;
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

function fits(p: Vec3, boxes: readonly WorldBox[]): boolean {
  return !boxes.some((b) => b.maxY > p.y + .05 && b.minY < p.y + HEADROOM_M && overlapsFootprint(p.x, p.z, FOOTPRINT_HALF_M, b));
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
  /** U-001: stopped by the script — no more waves. */
  stopped: boolean;
  /** U-001: when it came down to stragglers (every wave placed, few left), or null. */
  stragglingSince: number | null;
}

/** Where a group stands, for `status` (U-001). */
export type GroupState = 'waiting' | 'queued' | 'fighting' | 'stragglers' | 'beaten' | 'dead' | 'stopped';

export interface GroupStatus {
  id: string;
  state: GroupState;
  /** What starts it, while it waits: its trigger's kind. */
  trigger: EncounterGroup['trigger']['kind'];
  wavesSent: number;
  waves: number;
  placed: number;
  alive: number;
  queued: number;
}

/** Queued members the last step could not place, by why (U-001). */
export interface HeldBack {
  /** The alive cap was reached. */
  cap: number;
  /** Every free candidate of the zone was in a human's sight. */
  seen: number;
  /** Every candidate of the zone was stood on. */
  occupied: number;
}

interface Pending {
  run: GroupRun;
  wave: number;
  archetype: string;
}

/** U-059: where a spawner stood at a checkpoint — every group's progress, and the members still queued. */
export interface SpawnerCheckpoint {
  runs: {
    id: string;
    firedAt: number | null;
    wavesSent: number;
    lastWaveAt: number;
    waveTimes: number[];
    spawned: number[];
    stopped: boolean;
    stragglingSince: number | null;
  }[];
  queue: { group: string; wave: number; archetype: string }[];
}

export class Spawner {
  private readonly runs: GroupRun[];
  private readonly queue: Pending[] = [];
  private readonly candidates = new Map<string, Vec3[]>();
  /** Every spawn made, in order. */
  readonly log: SpawnEvent[] = [];
  /** The seconds of the latest step. */
  private now = 0;
  private held: HeldBack = { cap: 0, seen: 0, occupied: 0 };

  constructor(
    readonly encounter: Encounter,
    private readonly world: World,
    private readonly host: SpawnerHost,
    /** The first session group id to hand out; one per encounter group. */
    firstGroupId = 1000,
    private readonly pacing: Pacing = FIXED_PACING,
    /** T-4.15: when true, first waves are activated by the mission event runner. */
    private readonly externalTriggers = false,
    /** Groups completed before a checkpoint retry: keep them dead without respawning them. */
    completedGroups: readonly string[] = [],
  ) {
    if (encounter.world !== world.id) throw new Error(`encounter for '${encounter.world}' on world '${world.id}'`);
    this.runs = encounter.groups.map((def, i) => ({ def, sessionGroup: firstGroupId + i, firedAt: null, wavesSent: 0, lastWaveAt: 0, waveTimes: [], spawned: [], stopped: false, stragglingSince: null }));
    for (const id of completedGroups) {
      const run = this.runs.find((r) => r.def.id === id);
      if (!run) throw new Error(`no completed group '${id}'`);
      run.firedAt = 0;
      run.wavesSent = run.def.waves.count;
      run.lastWaveAt = 0;
    }
    for (const zone of world.mission!.spawnZones) {
      const points: Vec3[] = [];
      for (const c of zoneCandidates(zone)) {
        const at = { x: c.x, y: zone.y ?? 0, z: c.z };
        const ground = host.ground ? host.ground(at, zone.y) : spawnGround(at, zone.y, world.boxes, DEFAULT_MOVE_CONFIG);
        if (ground && (zone.y === undefined || Math.abs(ground.y - zone.y) <= SPAWN_ON_MESH_M) && (zone.minY === undefined || areaContains(zone, ground)) && fits(ground, world.boxes)) points.push(ground);
      }
      if (zone.y !== undefined && points.length === 0) throw new Error(`spawn zone '${zone.id}': no valid candidates on authored floor y=${zone.y}`);
      this.candidates.set(zone.id, points);
    }
  }

  /** U-059: the whole of this spawner's progress, as plain data for a checkpoint. */
  checkpoint(): SpawnerCheckpoint {
    return {
      runs: this.runs.map((r) => ({
        id: r.def.id,
        firedAt: r.firedAt,
        wavesSent: r.wavesSent,
        lastWaveAt: r.lastWaveAt,
        waveTimes: [...r.waveTimes],
        spawned: [...r.spawned],
        stopped: r.stopped,
        stragglingSince: r.stragglingSince,
      })),
      queue: this.queue.map((p) => ({ group: p.run.def.id, wave: p.wave, archetype: p.archetype })),
    };
  }

  /**
   * U-059: put a checkpoint's progress back into this (fresh) spawner. `remap` maps the netId an enemy had then to the
   * one it has now. A member absent from it was dead at the checkpoint: it stays counted as sent, under an id no enemy
   * has (a negative one — a resumed process hands out the old positive ids again, to other enemies).
   */
  restore(saved: SpawnerCheckpoint, remap: ReadonlyMap<number, number>): void {
    let gone = 0;
    for (const r of saved.runs) {
      const run = this.run(r.id);
      run.firedAt = r.firedAt;
      run.wavesSent = r.wavesSent;
      run.lastWaveAt = r.lastWaveAt;
      run.waveTimes = [...r.waveTimes];
      run.spawned = r.spawned.map((id) => remap.get(id) ?? -++gone);
      run.stopped = r.stopped;
      run.stragglingSince = r.stragglingSince;
    }
    this.queue.length = 0;
    for (const q of saved.queue) this.queue.push({ run: this.run(q.group), wave: q.wave, archetype: q.archetype });
  }

  /** U-059: the session group id a group's enemies share. */
  sessionGroupOf(groupId: string): number {
    return this.run(groupId).sessionGroup;
  }

  /** U-059: the encounter group that spawned this enemy, or null. */
  groupOfEnemy(netId: number): string | null {
    return this.runs.find((r) => r.spawned.includes(netId))?.def.id ?? null;
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

  /** Queued members the latest step could not place, and why. */
  get heldBack(): Readonly<HeldBack> {
    return this.held;
  }

  /** Every group, where it stands (U-001's diagnostics). */
  status(): GroupStatus[] {
    return this.runs.map((run) => {
      const alive = run.spawned.filter((id) => this.host.isAlive(id)).length;
      const queued = this.queue.filter((p) => p.run === run).length;
      const id = run.def.id;
      const state: GroupState =
        run.firedAt === null ? 'waiting'
        : this.dead(id) ? (run.stopped ? 'stopped' : 'dead')
        : this.broken(id) ? 'beaten'
        : run.stragglingSince !== null ? 'stragglers'
        : queued > 0 && alive === 0 ? 'queued'
        : 'fighting';
      return { id, state, trigger: run.def.trigger.kind, wavesSent: run.wavesSent, waves: run.def.waves.count, placed: run.spawned.length, alive, queued };
    });
  }

  /** `status` in a line: every group that is not waiting or dead, and what the last step held back. */
  describe(): string {
    const groups = this.status().map((g) => `${g.id} ${g.state === 'waiting' ? `waiting(${g.trigger})` : g.state} ${g.alive}/${g.placed} w${g.wavesSent}/${g.waves}${g.queued ? ` q${g.queued}` : ''}`);
    const h = this.held;
    return `${groups.join(', ')}; held back: cap ${h.cap}, seen ${h.seen}, occupied ${h.occupied}`;
  }

  /** A group is dead once every member it will send has been placed and none of them lives. */
  dead(groupId: string): boolean {
    const run = this.run(groupId);
    if (run.firedAt === null || run.wavesSent < run.def.waves.count) return false;
    if (this.queue.some((p) => p.run === run)) return false;
    return run.spawned.every((id) => !this.host.isAlive(id));
  }

  /**
   * U-001: dead, or down to stragglers (the file's `stragglers`) for long
   * enough — what a `dead` trigger and a script's `group-dead` wait on, so a
   * survivor nobody can find does not hold the mission.
   */
  broken(groupId: string): boolean {
    if (this.dead(groupId)) return true;
    const since = this.run(groupId).stragglingSince;
    return since !== null && this.now - since >= this.encounter.stragglers.seconds;
  }

  /**
   * U-001: the script's `stop-group` — no more waves, and its queued members
   * dropped; the living fight on, and it is dead once they are. A group
   * never sent is stopped as sent-and-empty. Idempotent.
   */
  stop(groupId: string, seconds: number): boolean {
    const run = this.run(groupId);
    if (run.stopped) return false;
    run.stopped = true;
    if (run.firedAt === null) run.firedAt = seconds;
    run.wavesSent = Math.max(run.wavesSent, run.def.waves.count);
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]!.run === run) this.queue.splice(i, 1);
    return true;
  }

  private run(groupId: string): GroupRun {
    const run = this.runs.find((r) => r.def.id === groupId);
    if (!run) throw new Error(`no group '${groupId}'`);
    return run;
  }

  /** Activate a group's first wave from T-4.15's event runner. Idempotent. */
  activate(groupId: string, seconds: number): boolean {
    const run = this.run(groupId);
    if (run.firedAt !== null) return false;
    run.firedAt = seconds;
    this.enqueue(run, seconds);
    return true;
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
        return this.host.squadFeet().some((p) => areaContains(area, p));
      }
      case 'dead':
        return this.broken(t.group);
      case 'script':
        return false;
    }
  }

  private enqueue(run: GroupRun, seconds: number): void {
    run.wavesSent++;
    run.lastWaveAt = seconds;
    run.waveTimes.push(seconds);
    // Sized now, by the pacing: a wave already on its way keeps its size.
    for (const m of run.def.members) {
      const def = getEnemy(m.archetype);
      const count = run.def.fixedCount || def.friendly || def.vehicle ? m.count : this.pacing.waveSize(m.count);
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
    this.now = seconds;
    this.held = { cap: 0, seen: 0, occupied: 0 };
    for (const run of this.runs) {
      // Stragglers: every wave placed, at least one lost, few enough left.
      if (run.stragglingSince === null && run.firedAt !== null && run.wavesSent >= run.def.waves.count && !this.queue.some((p) => p.run === run)) {
        const alive = run.spawned.filter((id) => this.host.isAlive(id)).length;
        if (alive > 0 && alive < run.spawned.length && alive <= this.encounter.stragglers.alive) run.stragglingSince = seconds;
      }
    }
    for (const run of this.runs) {
      if (run.firedAt === null) {
        if (this.externalTriggers || !this.triggered(run, seconds)) continue;
        this.activate(run.def.id, seconds);
      } else if (run.wavesSent < run.def.waves.count && this.pacing.waveDue(seconds - run.lastWaveAt, run.def.waves)) {
        this.enqueue(run, seconds);
      }
    }
    if (this.queue.length === 0) return;

    const eyes = this.host.humanEyes();
    const taken = this.host.enemyFeet().map((p) => ({ ...p }));
    let alive = taken.length;
    /** Zones with nowhere left this tick: later members for them wait too. */
    const full = new Set<string>();
    const cap = this.pacing.aliveCap(this.encounter.aliveCap);
    /** Zone → why it had nowhere this tick. */
    const why = new Map<string, 'seen' | 'occupied'>();
    let i = 0;
    for (; i < this.queue.length && alive < cap; ) {
      const item = this.queue[i]!;
      const zone = item.run.def.zone;
      if (full.has(zone)) {
        this.held[why.get(zone)!]++;
        i++;
        continue;
      }
      let skippedVisible = 0;
      let point: Vec3 | null = null;
      for (const c of this.candidatesOf(zone)) {
        if (taken.some((q) => (q.y === undefined || Math.abs(q.y - c.y) < HEADROOM_M) && Math.sqrt((q.x - c.x) ** 2 + (q.z - c.z) ** 2) < OCCUPIED_M)) continue;
        if (seenByAny(c, this.encounter.probes, eyes, this.world.boxes)) {
          skippedVisible++;
          continue;
        }
        point = c;
        break;
      }
      if (!point) {
        full.add(zone);
        why.set(zone, skippedVisible > 0 ? 'seen' : 'occupied');
        this.held[why.get(zone)!]++;
        i++;
        continue;
      }
      const posture = this.postureFor(item.run.def, point);
      const face = posture.kind === 'patrol' ? posture.route[0]! : posture.face;
      const yaw = yawToward(face.x - point.x, face.z - point.z);
      const netId = this.host.spawn(item.archetype, { ...point, yaw, posture, group: item.run.sessionGroup, ...(item.run.def.captive === undefined ? {} : { captive: item.run.def.captive }), ...(item.run.def.path ? { path: item.run.def.path } : {}) });
      if (netId === null) break;
      item.run.spawned.push(netId);
      this.log.push({ seconds, group: item.run.def.id, wave: item.wave, archetype: item.archetype, netId, point: { ...point }, skippedVisible });
      taken.push({ ...point });
      alive++;
      this.queue.splice(i, 1);
    }
    // What the cap held back: every member the loop did not reach.
    this.held.cap += this.queue.length - i;
  }
}
