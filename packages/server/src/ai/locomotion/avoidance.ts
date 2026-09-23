/**
 * Local avoidance (T-3.06).
 *
 * Soldiers do not collide with each other — `stepCharacter` collides with
 * boxes only — so without this a squad walks through itself. Detour's crowd
 * supplies the avoidance *velocities* and nothing else (§7.9 rule 1):
 *
 *   1. every soldier's position and actual velocity are written into the
 *      crowd from its `MoveState`, every tick;
 *   2. a bot asks for the velocity its path-following input would walk at
 *      (`requestMoveVelocity`) — path following still routes, vaults and
 *      arrives (T-3.05); the crowd plans nothing;
 *   3. the crowd is updated, and the velocity it settled on for each bot is
 *      turned back into move axes against the bot's own facing.
 *
 * "The velocity it settled on" is how far the crowd moved its own copy of
 * the agent in the update, per second: the obstacle-adjusted velocity plus
 * Detour's push apart of agents already overlapping, held to the mesh. The
 * obstacle-adjusted velocity alone has no answer for an overlap — two
 * soldiers inside each other would stay there — and the push is what the
 * crowd would have done about it.
 *
 * The crowd never moves an agent: whatever it did to its own copy of a
 * position during the update is overwritten by the next tick's write, and
 * `stepCharacter` moves the soldier from the input like anyone else's.
 *
 * PATIENCE. Detour's avoidance has no right of way. Two soldiers meeting in
 * a doorway one soldier wide (the range's west doorway is 1.2 m) each wait
 * for the other, for ever. A bot held below `blockedFraction` of the speed
 * it asked for for `patienceTicks` walks its own input unsteered for
 * `assertTicks`, and on past that until nobody is inside its capsule, while
 * everyone else still steers round it. Whoever has waited longest goes;
 * nothing can wait for ever, and the cost is that the one it meets head-on
 * in a one-wide gap is walked through — soldiers do not collide — for about
 * a capsule's width of travel. On open ground nobody is held that long.
 *
 * HUMANS ARE OBSTACLES. A human's slot is in the crowd so bots see it, with
 * no move request and no avoidance of its own: its velocity is what the
 * human actually walked, and its output is never read.
 *
 * VAULTS ARE LEFT ALONE. A bot mid-vault ignores its input anyway, and one
 * walking a vault leg is lined up on the link; nudging it sideways there
 * would turn a vault into a hop, so its input passes through unchanged. It is
 * still in the crowd, so everyone else steers round it.
 *
 * Server-only and never predicted (§7.9 rule 2): `Math.sin`/`cos` are fine
 * here, and the crowd's arithmetic may differ between engines.
 */
import { DEFAULT_MOVE_CONFIG, type MoveConfig, type MoveInput, type MoveState, TICK_SECONDS, WIRE_ANGLE_UNITS } from '@sandline/shared';
import { Raw, type Crowd } from '@recast-navigation/core';
import type { NavMesh } from '../nav/NavMesh.ts';
import { DEFAULT_HITBOX } from '../../net/lagComp.ts';
import RAW_AVOIDANCE from './avoidance.json' with { type: 'json' };

/** Local avoidance tuning (`avoidance.json`). */
export interface AvoidanceConfig {
  radiusMarginM: number;
  collisionQueryRangeM: number;
  separationWeight: number;
  horizonS: number;
  velBias: number;
  weightDesVel: number;
  weightCurVel: number;
  weightSide: number;
  weightToi: number;
  adaptiveDivs: number;
  adaptiveRings: number;
  adaptiveDepth: number;
  /** Ticks a bot may be held below `blockedFraction` of the speed it asked for before it goes ahead. */
  patienceTicks: number;
  /** How long a bot that ran out of patience walks its own input, unsteered. */
  assertTicks: number;
  /** Steered speed, as a fraction of the speed asked for, below which a bot is held. */
  blockedFraction: number;
}

/** One soldier this tick. */
export interface AvoidanceEntry {
  /** Stable across ticks: the soldier's netId. */
  id: number;
  state: Readonly<MoveState>;
  /** A bot's input from path following; null for a human, who is an obstacle. */
  input: Readonly<MoveInput> | null;
  /** Pass this bot's input through unchanged (a vault leg); still an obstacle. */
  hold?: boolean;
}

// ---------------------------------------------------------------------------
// Tuning data — hand-validated, as follow.json is
// ---------------------------------------------------------------------------

class AvoidanceDataError extends Error {}

const LIMITS: Record<keyof AvoidanceConfig, [min: number, max: number, integer?: true]> = {
  radiusMarginM: [0, 1],
  collisionQueryRangeM: [0.5, 20],
  separationWeight: [0, 20],
  horizonS: [0.1, 10],
  velBias: [0, 1],
  weightDesVel: [0, 10],
  weightCurVel: [0, 10],
  weightSide: [0, 10],
  weightToi: [0, 10],
  adaptiveDivs: [1, 32, true],
  adaptiveRings: [1, 4, true],
  adaptiveDepth: [1, 10, true],
  patienceTicks: [1, 300, true],
  assertTicks: [1, 300, true],
  blockedFraction: [0, 1],
};

/** Validate local avoidance tuning. Throws naming the offending key. */
export function parseAvoidanceConfig(raw: unknown): AvoidanceConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AvoidanceDataError('avoidance tuning: expected an object');
  }
  const row = raw as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== '$comment' && !(key in LIMITS)) throw new AvoidanceDataError(`avoidance tuning: unknown key "${key}"`);
  }
  const out = {} as AvoidanceConfig;
  for (const [key, [min, max, integer]] of Object.entries(LIMITS) as [keyof AvoidanceConfig, (typeof LIMITS)[keyof AvoidanceConfig]][]) {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new AvoidanceDataError(`avoidance tuning: ${key} must be a finite number, got ${String(v)}`);
    }
    if (v < min || v > max) throw new AvoidanceDataError(`avoidance tuning: ${key} must be in [${min}, ${max}], got ${v}`);
    if (integer && !Number.isInteger(v)) throw new AvoidanceDataError(`avoidance tuning: ${key} must be an integer, got ${v}`);
    out[key] = v;
  }
  return out;
}

export const DEFAULT_AVOIDANCE_CONFIG: Readonly<AvoidanceConfig> = Object.freeze(parseAvoidanceConfig(RAW_AVOIDANCE));

// ---------------------------------------------------------------------------
// The crowd
// ---------------------------------------------------------------------------

/** Detour's crowd update flags. */
const DT_CROWD_OBSTACLE_AVOIDANCE = 2;
const DT_CROWD_SEPARATION = 4;
/** Detour's agent state for an agent placed on the mesh. */
const DT_CROWDAGENT_STATE_WALKING = 1;
/** A displacement faster than this in one tick is a teleport, not a velocity. */
const TELEPORT_SPEED = 20;

interface Member {
  index: number;
  human: boolean;
  /** Where the soldier stood last tick, for its actual velocity. */
  x: number;
  z: number;
  seen: boolean;
  /** Consecutive ticks steered below `blockedFraction`. */
  held: number;
  /** Ticks left walking its own input. */
  asserting: number;
}

/**
 * Local avoidance for every soldier in a session: one per navmesh, stepped at
 * 30 Hz after path following and before `stepCharacter`.
 */
export class Avoidance {
  private readonly crowd: Crowd;
  private readonly members = new Map<number, Member>();
  private readonly radius: number;
  private readonly halfExtents: [number, number, number] = [0.5, 2, 0.5];

  constructor(
    mesh: NavMesh,
    maxAgents: number,
    private readonly tuning: Readonly<AvoidanceConfig> = DEFAULT_AVOIDANCE_CONFIG,
    private readonly move: MoveConfig = DEFAULT_MOVE_CONFIG,
  ) {
    // The capsule the overlap is judged by, the same radius the bake eroded for.
    this.radius = Math.max(move.radius, DEFAULT_HITBOX.radius) + tuning.radiusMarginM;
    this.crowd = mesh.crowd({ maxAgents, maxAgentRadius: this.radius });
    const p = new Raw.Module.dtObstacleAvoidanceParams();
    p.velBias = tuning.velBias;
    p.weightDesVel = tuning.weightDesVel;
    p.weightCurVel = tuning.weightCurVel;
    p.weightSide = tuning.weightSide;
    p.weightToi = tuning.weightToi;
    p.horizTime = tuning.horizonS;
    p.gridSize = 33;
    p.adaptiveDivs = tuning.adaptiveDivs;
    p.adaptiveRings = tuning.adaptiveRings;
    p.adaptiveDepth = tuning.adaptiveDepth;
    this.crowd.raw.setObstacleAvoidanceParams(0, p);
    Raw.Module.destroy(p);
  }

  /** Times a bot ran out of patience and walked on unsteered. */
  assertions = 0;

  /** Soldiers in the crowd. */
  get size(): number {
    return this.members.size;
  }

  /**
   * One tick: the input each entry should send. A human's entry answers
   * null; a bot's is its path-following input with the move axes steered
   * round everyone else. Soldiers missing from `entries` leave the crowd.
   */
  step(entries: readonly AvoidanceEntry[]): (MoveInput | null)[] {
    const present = new Set<number>();
    const members: Member[] = [];
    for (const e of entries) {
      present.add(e.id);
      members.push(this.place(e));
    }
    for (const [id, m] of this.members) {
      if (!present.has(id)) {
        this.crowd.removeAgent(m.index);
        this.members.delete(id);
      }
    }

    // Everyone's position and velocity first, then the bots' requests:
    // teleporting clears an agent's request.
    const wanted: ({ vx: number; vz: number; s: number; c: number; speed: number } | null)[] = [];
    const placed: [number, number][] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const m = members[i]!;
      const agent = this.crowd.raw.getEditableAgent(m.index);
      Raw.CrowdUtils.agentTeleport(this.crowd.raw, m.index, [e.state.x, e.state.y, e.state.z], this.halfExtents, this.crowd.navMeshQuery.defaultFilter.raw);
      let vx = m.seen ? (e.state.x - m.x) / TICK_SECONDS : 0;
      let vz = m.seen ? (e.state.z - m.z) / TICK_SECONDS : 0;
      if (Math.hypot(vx, vz) > TELEPORT_SPEED) vx = vz = 0;
      placed.push([agent.get_npos(0), agent.get_npos(2)]);
      agent.set_vel(0, vx);
      agent.set_vel(1, 0);
      agent.set_vel(2, vz);
      m.x = e.state.x;
      m.z = e.state.z;
      m.seen = true;
      wanted.push(null);
      if (!e.input || e.hold || e.state.vault || agent.get_state() !== DT_CROWDAGENT_STATE_WALKING) continue;
      const w = this.desired(e.state, e.input);
      if (w.vx === 0 && w.vz === 0) continue;
      this.crowd.raw.requestMoveVelocity(m.index, [w.vx, 0, w.vz]);
      wanted[i] = w;
    }

    this.crowd.update(TICK_SECONDS);

    const out: (MoveInput | null)[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const w = wanted[i];
      if (!e.input) {
        out.push(null);
        continue;
      }
      const m = members[i]!;
      if (!w) {
        m.held = 0;
        out.push({ ...e.input });
        continue;
      }
      const agent = this.crowd.raw.getAgent(m.index);
      if (m.asserting > 0) {
        // Walking on: until the time is up and nobody is inside the capsule.
        if (m.asserting > 1 || !this.overlapping(agent)) m.asserting--;
        out.push({ ...e.input });
        continue;
      }
      const nx = (agent.get_npos(0) - placed[i]![0]) / TICK_SECONDS;
      const nz = (agent.get_npos(2) - placed[i]![1]) / TICK_SECONDS;
      // Patience: held back for long enough, walk on regardless.
      m.held = Math.hypot(nx, nz) < this.tuning.blockedFraction * Math.hypot(w.vx, w.vz) ? m.held + 1 : 0;
      if (m.held >= this.tuning.patienceTicks) {
        m.held = 0;
        m.asserting = this.tuning.assertTicks;
        this.assertions++;
        out.push({ ...e.input });
        continue;
      }
      // The inverse of stepCharacter's axes: forward (s, c), right (−c, s).
      out.push({
        ...e.input,
        moveX: clampAxis((-nx * w.c + nz * w.s) / w.speed),
        moveY: clampAxis((nx * w.s + nz * w.c) / w.speed),
      });
    }
    return out;
  }

  destroy(): void {
    this.crowd.destroy();
    this.members.clear();
  }

  /** Another soldier's centre within two crowd radii of this one's. */
  private overlapping(agent: ReturnType<Crowd['raw']['getAgent']>): boolean {
    const near = (2 * this.radius) ** 2;
    for (let k = 0; k < agent.get_nneis(); k++) {
      // Detour keeps a neighbour's squared distance.
      if (agent.get_neis(k).dist < near) return true;
    }
    return false;
  }

  private place(e: AvoidanceEntry): Member {
    const human = e.input === null;
    let m = this.members.get(e.id);
    if (m && m.human !== human) {
      this.crowd.removeAgent(m.index);
      this.members.delete(e.id);
      m = undefined;
    }
    if (m) return m;
    const agent = this.crowd.addAgent(
      { x: e.state.x, y: e.state.y, z: e.state.z },
      {
        radius: this.radius,
        height: this.move.height,
        maxSpeed: this.move.sprintSpeed,
        // The crowd's own integration is never read: velocities are written.
        maxAcceleration: 1000,
        collisionQueryRange: this.tuning.collisionQueryRangeM,
        separationWeight: this.tuning.separationWeight,
        updateFlags: human ? 0 : DT_CROWD_OBSTACLE_AVOIDANCE | (this.tuning.separationWeight > 0 ? DT_CROWD_SEPARATION : 0),
        obstacleAvoidanceType: 0,
      },
    );
    m = { index: agent.agentIndex, human, x: e.state.x, z: e.state.z, seen: false, held: 0, asserting: 0 };
    this.members.set(e.id, m);
    return m;
  }

  /** The velocity `stepCharacter` would walk this input at, and the facing it is measured against. */
  private desired(state: Readonly<MoveState>, input: Readonly<MoveInput>) {
    const mv = this.move;
    const speed = state.prone || input.prone
      ? mv.proneSpeed
      : state.crouched || input.crouch
        ? mv.crouchSpeed
        : input.sprint
          ? mv.sprintSpeed
          : mv.walkSpeed;
    const a = (input.yaw / WIRE_ANGLE_UNITS) * 2 * Math.PI;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const mx = clampAxis(input.moveX);
    const my = clampAxis(input.moveY);
    const len = Math.hypot(mx, my);
    const scale = len > 1 ? 1 / len : 1;
    return { vx: (my * s - mx * c) * speed * scale, vz: (my * c + mx * s) * speed * scale, s, c, speed };
  }
}

function clampAxis(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
