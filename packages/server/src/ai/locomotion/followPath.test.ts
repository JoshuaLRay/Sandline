/**
 * Path following as input (T-3.05).
 *
 * Two halves. The first steps `followPath` through `stepCharacter` by hand
 * over a one-wall fixture and a hand-built path, with no navmesh at all: the
 * follower is pure, so its corner, vault, arrival and stuck rules can be
 * pinned without WASM. The second drives a bot slot of a real `Session` over
 * the range with the committed bake, the way T-3.08's brains will: set the
 * slot's input, step the session, read the slot's state back.
 *
 * Numbers these rest on, measured on the range bake: slot 0 → (−33.75, 0,
 * 45.96) is 60 m as the crow flies and a 61.07 m path that vaults the low
 * wall at x = −8.12 and then takes the west doorway. From slots 2 and 5 the
 * same bearing does not vault, so this is slot 0's route.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG,
  type MoveInput,
  type MoveState,
  SPAWN_POINTS,
  TICK_SECONDS,
  createMoveState,
  loadWorld,
  stepCharacter,
} from '@sandline/shared';
import { type NavMesh, type NavPath, type NavPoint, initNav, pathLength } from '../nav/NavMesh.ts';
import { loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session, type Slot } from '../../session/Session.ts';
import {
  DEFAULT_FOLLOW_CONFIG,
  type FollowConfig,
  type FollowState,
  type FollowStatus,
  type LocomotionIntent,
  type LocomotionPace,
  PathFollower,
  followPath,
  parseFollowConfig,
  startFollow,
  yawToward,
} from './followPath.ts';
import RAW_FOLLOW from './follow.json' with { type: 'json' };

const TICK_MS = 1000 / 30;
const across = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(b.x - a.x, b.z - a.z);
const VAULT_TICKS = Math.ceil(DEFAULT_MOVE_CONFIG.vaultSeconds / TICK_SECONDS);

/** Every tick whose state began a vault: the tick before had none. */
function vaultStarts(start: MoveState, states: readonly MoveState[]): number {
  let n = 0;
  let prev = start;
  for (const s of states) {
    if (s.vault && !prev.vault) n++;
    prev = s;
  }
  return n;
}

/** Ordinary jumps: rising with no vault in progress. Path following never jumps except to vault. */
function hops(states: readonly MoveState[]): number {
  return states.filter((s) => !s.vault && s.vy > 0).length;
}

describe('follow tuning (follow.json)', () => {
  it('is the file, validated', () => {
    const { $comment: _, ...values } = RAW_FOLLOW as Record<string, unknown>;
    expect(DEFAULT_FOLLOW_CONFIG).toEqual(values);
  });

  it('refuses a bad value, a misspelt key and a missing one, by name', () => {
    expect(() => parseFollowConfig({ ...RAW_FOLLOW, stuckTicks: 7.5 })).toThrow(/stuckTicks must be an integer/);
    expect(() => parseFollowConfig({ ...RAW_FOLLOW, arrivalRadiusM: -1 })).toThrow(/arrivalRadiusM must be in/);
    expect(() => parseFollowConfig({ ...RAW_FOLLOW, cornerRadius: 0.3 })).toThrow(/unknown key "cornerRadius"/);
    const { goalSearchMaxM: _, ...missing } = RAW_FOLLOW;
    expect(() => parseFollowConfig(missing)).toThrow(/goalSearchMaxM must be a finite number/);
  });
});

describe('yawToward', () => {
  it('is the controller facing, in integer wire units', () => {
    // stepCharacter's forward is (sin, cos) of the yaw: +Z at 0, +X at 256.
    expect(yawToward(0, 1)).toBe(0);
    expect(yawToward(1, 0)).toBe(256);
    expect(yawToward(0, -1)).toBe(512);
    expect(yawToward(-1, 0)).toBe(768);
    expect(yawToward(-1e-9, 1)).toBe(0);
    for (let i = 0; i < 64; i++) {
      const y = yawToward(Math.cos(i), Math.sin(i * 1.7));
      expect(Number.isInteger(y) && y >= 0 && y < 1024).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The pure step, over a fixture: no navmesh
// ---------------------------------------------------------------------------

/** A 1 m wall (vaultable) across z = 0, x −2..2, on open ground. */
const LOW = loadWorld({ id: 'follow-low', floor: { halfExtent: 10 }, cover: [{ id: 'wall', x: 0, y: 0, z: 0, w: 4, h: 1, d: 0.3 }] }).boxes;
/** The same wall at 2.4 m: nothing vaults it. */
const TALL = loadWorld({ id: 'follow-tall', floor: { halfExtent: 10 }, cover: [{ id: 'wall', x: 0, y: 0, z: 0, w: 4, h: 2.4, d: 0.3 }] }).boxes;

const at = (x: number, z: number): NavPoint => ({ x, y: 0.05, z });
/**
 * What the bake would give for the low wall: an approach, a vault link from
 * a radius and a voxel off the near face to 1.5 m on (T-3.04), then a corner.
 */
const OVER: NavPath = { corridor: [], points: [at(0, -4), at(0, -0.6), at(0, 0.9), at(2, 4)], vaults: [1] };

interface Walk {
  arrived: boolean;
  ticks: number;
  start: MoveState;
  states: MoveState[];
  inputs: MoveInput[];
  statuses: FollowStatus[];
  follow: FollowState;
}

function walk(
  follow: FollowState,
  start: MoveState,
  pace: LocomotionPace,
  world: typeof LOW,
  maxTicks = 600,
  tuning: FollowConfig = DEFAULT_FOLLOW_CONFIG,
): Walk {
  const intent: LocomotionIntent = { goal: follow.path.points.at(-1)!, pace };
  const states: MoveState[] = [];
  const inputs: MoveInput[] = [];
  const statuses: FollowStatus[] = [];
  let state = start;
  for (let tick = 0; tick < maxTicks; tick++) {
    const r = followPath(follow, state, intent, world, tuning);
    follow = r.follow;
    statuses.push(r.status);
    if (r.status === 'arrived') return { arrived: true, ticks: tick, start, states, inputs, statuses, follow };
    inputs.push(r.input);
    state = stepCharacter(state, r.input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world);
    states.push(state);
  }
  return { arrived: false, ticks: maxTicks, start, states, inputs, statuses, follow };
}

describe('followPath over a fixture (T-3.05)', () => {
  it('walks a path through stepCharacter, vaulting its vault leg once and never hopping', () => {
    for (const pace of ['walk', 'sprint'] as const) {
      const w = walk(startFollow(OVER, 0), createMoveState(0, 0, -4), pace, LOW);
      expect(w.arrived, pace).toBe(true);
      expect(across(w.states.at(-1)!, OVER.points.at(-1)!)).toBeLessThanOrEqual(DEFAULT_FOLLOW_CONFIG.arrivalRadiusM);
      expect(vaultStarts(w.start, w.states), pace).toBe(1);
      expect(hops(w.states), pace).toBe(0);
      for (const input of w.inputs) {
        expect(Number.isInteger(input.yaw) && input.yaw >= 0 && input.yaw < 1024).toBe(true);
        expect(input.firing).toBe(false);
      }
      // The ideal is the path's length at speed, plus the vault's own time.
      const speed = pace === 'sprint' ? DEFAULT_MOVE_CONFIG.sprintSpeed : DEFAULT_MOVE_CONFIG.walkSpeed;
      const ideal = pathLength(OVER.points) / (speed * TICK_SECONDS);
      expect(w.ticks).toBeLessThanOrEqual(Math.ceil(1.1 * ideal) + VAULT_TICKS);
    }
  });

  it('crouch-walks the ordinary legs, stands for the vault, and still never hops', () => {
    const w = walk(startFollow(OVER, 0), createMoveState(0, 0, -4), 'crouch', LOW, 1200);
    expect(w.arrived).toBe(true);
    expect(vaultStarts(w.start, w.states)).toBe(1);
    expect(hops(w.states)).toBe(0);
    const first = w.states.findIndex((s) => s.vault);
    expect(w.states.slice(0, first - 2).some((s) => s.crouched)).toBe(true);
    // Released at least one tick before the jump: the controller refuses a
    // vault on the tick crouch is let go, and a held jump then hops.
    expect(w.states[first - 1]!.crouched).toBe(false);
    expect(w.states.at(-1)!.crouched).toBe(true);
  });

  it('leaves the vault leg when the vault lands, wherever it lands', () => {
    // Already on the vault leg, 0.8 m to one side of the link: the vault
    // lands 0.8 m to the side of the link's end, too far to count as reaching
    // it, and the leg must still end there.
    const onLeg: FollowState = { ...startFollow(OVER, 0), leg: 2 };
    const w = walk(onLeg, createMoveState(0.8, 0, -0.6), 'walk', LOW);
    expect(w.arrived).toBe(true);
    expect(vaultStarts(w.start, w.states)).toBe(1);
    const landed = w.states.findIndex((s, i) => i > 0 && !s.vault && w.states[i - 1]!.vault);
    expect(across(w.states[landed]!, OVER.points[2]!)).toBeGreaterThan(DEFAULT_FOLLOW_CONFIG.cornerRadiusM);
    expect(w.follow.leg).toBe(3);
  });

  it('arrives by landing on the point, not by overshooting it', () => {
    // A sprint tick is 0.23 m. With an arrival radius a tenth of that, a
    // full-stick step would overshoot and turn back forever; the scaled last
    // step lands on it.
    const tight = { ...DEFAULT_FOLLOW_CONFIG, arrivalRadiusM: 0.02 };
    const straight: NavPath = { corridor: [], points: [at(0, -8), at(0, -3.1)], vaults: [] };
    const w = walk(startFollow(straight, 0), createMoveState(0, 0, -8), 'sprint', LOW, 200, tight);
    expect(w.arrived).toBe(true);
    expect(across(w.states.at(-1)!, straight.points[1]!)).toBeLessThanOrEqual(0.02);
    expect(w.states.every((s) => s.z <= -3.1 + 1e-9)).toBe(true);
    // Arrived means standing still.
    const r = followPath(w.follow, w.states.at(-1)!, { goal: straight.points[1]!, pace: 'sprint' }, LOW, tight);
    expect(r.status).toBe('arrived');
    expect(r.input.moveX).toBe(0);
    expect(r.input.moveY).toBe(0);
    expect(r.input.jump).toBe(false);
  });

  it('reports stuck after stuckTicks without progress, and not before', () => {
    // A path straight through a wall nobody can vault: the soldier walks into
    // it square-on, which the controller cannot slide off.
    const through: NavPath = { corridor: [], points: [at(0, -3), at(0, 3)], vaults: [] };
    const w = walk(startFollow(through, 0), createMoveState(0, 0, -3), 'walk', TALL, 120);
    expect(w.arrived).toBe(false);
    const contact = w.states.findIndex((s) => s.z >= -0.15 - DEFAULT_MOVE_CONFIG.radius - 1e-9);
    const stuck = w.statuses.indexOf('stuck');
    expect(contact).toBeGreaterThan(0);
    expect(w.statuses.slice(0, contact + 1).every((s) => s === 'following')).toBe(true);
    const n = DEFAULT_FOLLOW_CONFIG.stuckTicks;
    expect(stuck).toBeGreaterThanOrEqual(contact + n - 1);
    expect(stuck).toBeLessThanOrEqual(contact + n + 2);
  });

  it('is pure: the same arguments give the same step and are left as they were', () => {
    const follow = startFollow(OVER, 0);
    const state = createMoveState(0.3, 0, -2);
    const intent: LocomotionIntent = { goal: at(2, 4), pace: 'walk' };
    const before = structuredClone({ follow, state, intent });
    const a = followPath(follow, state, intent, LOW);
    const b = followPath(follow, state, intent, LOW);
    expect(a).toEqual(b);
    expect({ follow, state, intent }).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// A bot slot on the range, through a real Session
// ---------------------------------------------------------------------------

interface Drive {
  arrived: boolean;
  ticks: number;
  start: MoveState;
  inputs: MoveInput[];
  states: MoveState[];
  usPerStep: number;
}

/**
 * Drive one bot slot with a follower, as a brain will (T-3.08): the
 * follower's input goes into the slot, and `Session.step` moves it through
 * `stepCharacter` with everyone else. `before` runs ahead of each tick's
 * input — the place to push a soldier about.
 */
function drive(
  session: Session,
  slotIndex: number,
  follower: PathFollower,
  intent: LocomotionIntent,
  maxTicks: number,
  before?: (tick: number, slot: Slot) => void,
): Drive {
  const slot = session.slots[slotIndex]!;
  expect(slot.isBot).toBe(true);
  const start = structuredClone(slot.state);
  const inputs: MoveInput[] = [];
  const states: MoveState[] = [];
  let now = 0;
  let spentMs = 0;
  for (let tick = 0; tick < maxTicks; tick++) {
    before?.(tick, slot);
    const t0 = performance.now();
    const { input, status } = follower.step(slot.state, intent, slot.yaw);
    spentMs += performance.now() - t0;
    if (status === 'arrived') return { arrived: true, ticks: tick, start, inputs, states, usPerStep: (spentMs * 1000) / (tick + 1) };
    slot.input = input;
    // A copy: the session writes `downed` into the object it is handed.
    inputs.push({ ...input });
    now += TICK_MS;
    session.step(now);
    states.push(structuredClone(slot.state));
  }
  return { arrived: false, ticks: maxTicks, start, inputs, states, usPerStep: (spentMs * 1000) / maxTicks };
}

describe('a bot slot follows a path on the range (T-3.05)', () => {
  let mesh: NavMesh;
  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh('range');
  });

  describe('spawn to a goal 60 m away, over the low wall', () => {
    const GOAL = { x: -33.75, y: 0, z: 45.96 };
    let session: Session;
    let follower: PathFollower;
    let run: Drive;
    let length: number;
    beforeAll(() => {
      session = new Session();
      follower = new PathFollower(mesh, session.world.boxes);
      run = drive(session, 0, follower, { goal: GOAL, pace: 'walk' }, 1200);
      length = pathLength(follower.path!.points);
    });

    it('is 60 m from slot 0', () => {
      expect(across(SPAWN_POINTS[0]!, GOAL)).toBeGreaterThanOrEqual(59.99);
    });

    it('arrives inside the arrival radius within a bound set by the path', () => {
      const ideal = length / (DEFAULT_MOVE_CONFIG.walkSpeed * TICK_SECONDS);
      const bound = Math.ceil(1.1 * ideal) + VAULT_TICKS;
      console.log(
        `[follow] slot 0 → 60 m goal: ${length.toFixed(2)} m path, arrived in ${run.ticks} ticks ` +
          `(ideal ${ideal.toFixed(0)}, bound ${bound}), ${run.usPerStep.toFixed(1)} µs per follower step`,
      );
      expect(run.arrived).toBe(true);
      expect(run.ticks).toBeLessThanOrEqual(bound);
      expect(across(session.slots[0]!.state, follower.path!.points.at(-1)!)).toBeLessThanOrEqual(DEFAULT_FOLLOW_CONFIG.arrivalRadiusM);
      expect(follower.repaths).toBe(0);
    });

    it('crosses the low wall by vaulting it, and never hops', () => {
      const vaulting = run.states.filter((s) => s.vault);
      expect(vaulting.length).toBeGreaterThan(0);
      // The low wall: x −12..−6, z −1.15..−0.85.
      for (const s of vaulting) {
        expect(s.x).toBeGreaterThan(-12);
        expect(s.x).toBeLessThan(-6);
      }
      expect(vaulting.some((s) => s.z > -1.15 && s.z < -0.85)).toBe(true);
      expect(vaultStarts(run.start, run.states)).toBe(1);
      expect(hops(run.states)).toBe(0);
    });

    it("equals a replay of its inputs through stepCharacter, tick for tick", () => {
      let s = run.start;
      for (let i = 0; i < run.inputs.length; i++) {
        s = stepCharacter(s, run.inputs[i]!, TICK_SECONDS, DEFAULT_MOVE_CONFIG, session.world.boxes);
        expect(s).toEqual(run.states[i]);
      }
      expect(s).toEqual(session.slots[0]!.state);
    });
  });

  describe('pushed off its corridor', () => {
    // North of west-wall-a's middle (x −14..−9, z 3.85..4.15). Once the bot is
    // through the doorway and heading there, it is put back south of the
    // wall's middle: the goal is then square through the wall, and walking
    // square into a wall is the one push the controller cannot slide out of
    // — most teleports on the range walk round a wall end without a repath.
    const GOAL = { x: -11.5, y: 0, z: 20 };
    const PUSH_AT = 150;
    const push = (tick: number, slot: Slot): void => {
      if (tick !== PUSH_AT) return;
      expect(slot.state.z).toBeGreaterThan(4.15);
      slot.state = createMoveState(-11.5, 0, 2);
    };

    it('repaths and still arrives', () => {
      const session = new Session();
      const follower = new PathFollower(mesh, session.world.boxes);
      const run = drive(session, 0, follower, { goal: GOAL, pace: 'walk' }, 900, push);
      console.log(`[follow] teleported at tick ${PUSH_AT}: ${follower.repaths} repath(s), arrived at tick ${run.ticks}`);
      expect(follower.repaths).toBeGreaterThanOrEqual(1);
      expect(run.arrived).toBe(true);
      expect(across(session.slots[0]!.state, GOAL)).toBeLessThanOrEqual(DEFAULT_FOLLOW_CONFIG.arrivalRadiusM);
    });

    it('would not have arrived without the repath', () => {
      const session = new Session();
      const never = { ...DEFAULT_FOLLOW_CONFIG, stuckTicks: 300 };
      const follower = new PathFollower(mesh, session.world.boxes, never);
      const run = drive(session, 0, follower, { goal: GOAL, pace: 'walk' }, PUSH_AT + 250, push);
      expect(run.arrived).toBe(false);
      expect(follower.repaths).toBe(0);
      // Pinned against the wall's south face, square-on.
      expect(session.slots[0]!.state.z).toBeCloseTo(3.85 - DEFAULT_MOVE_CONFIG.radius, 6);
    });
  });

  describe('a goal off the mesh', () => {
    it('resolves to the nearest point on it, and the bot walks there', () => {
      // Crate-c's centre: 0.6 m to each face, plus the 0.4 m the bake erodes
      // for the soldier's radius — the nearest walkable ground is 1.0 m away.
      const inCrate = { x: 7, y: 0, z: -3 };
      const session = new Session();
      const follower = new PathFollower(mesh, session.world.boxes);
      const run = drive(session, 5, follower, { goal: inCrate, pace: 'walk' }, 600);
      const resolved = follower.path!.points.at(-1)!;
      const near = mesh.nearestPoint(inCrate)!;
      console.log(
        `[follow] goal in crate-c resolved ${across(resolved, inCrate).toFixed(3)} m away ` +
          `(default query box: ${across(near.point, inCrate).toFixed(3)} m)`,
      );
      expect(across(resolved, inCrate)).toBeGreaterThan(0.95);
      expect(across(resolved, inCrate)).toBeLessThan(1.05);
      expect(run.arrived).toBe(true);
      expect(across(session.slots[5]!.state, resolved)).toBeLessThanOrEqual(DEFAULT_FOLLOW_CONFIG.arrivalRadiusM);
    });

    it('finds the mesh from a goal past the floor’s edge', () => {
      // The range's floor ends at z = 100; nothing is within the default box.
      const beyond = { x: -3.75, y: 0, z: 150 };
      expect(mesh.nearestPoint(beyond)).toBeNull();
      const follower = new PathFollower(mesh, new Session().world.boxes);
      const first = follower.step(createMoveState(SPAWN_POINTS[0]!.x, 0, SPAWN_POINTS[0]!.z), { goal: beyond, pace: 'walk' }, 0);
      expect(first.status).toBe('following');
      const end = follower.path!.points.at(-1)!;
      expect(end.z).toBeGreaterThan(99);
      expect(end.z).toBeLessThan(100);
      expect(Math.abs(end.x - beyond.x)).toBeLessThan(0.1);
    });
  });
});
