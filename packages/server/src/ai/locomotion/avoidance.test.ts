/**
 * Local avoidance (T-3.06).
 *
 * Bot slots of a real `Session` on the range, driven the way T-3.08's brains
 * will: each tick a `PathFollower` makes an input, `Avoidance` steers it
 * round everyone else, the slot takes it, and `Session.step` moves everyone
 * through `stepCharacter`. The crowd never moves anyone.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, type MoveInput, type MoveState, TICK_SECONDS, createMoveState, stepCharacter } from '@sandline/shared';
import { type NavMesh, type NavPoint, initNav, pathLength } from '../nav/NavMesh.ts';
import { loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session } from '../../session/Session.ts';
import { DEFAULT_HITBOX } from '../../net/lagComp.ts';
import { Avoidance, type AvoidanceConfig, type AvoidanceEntry, DEFAULT_AVOIDANCE_CONFIG, parseAvoidanceConfig } from './avoidance.ts';
import { type LocomotionIntent, type LocomotionPace, PathFollower } from './followPath.ts';
import RAW_AVOIDANCE from './avoidance.json' with { type: 'json' };

const TICK_MS = 1000 / 30;
const CAPSULE = DEFAULT_HITBOX.radius;
/** Capsules closer than two radii by more than this overlap. */
const OVERLAP_EPSILON_M = 0.05;
/**
 * How far a bot may travel while overlapping another past the epsilon, as N
 * consecutive ticks at its pace: fifteen ticks at walk. Walking through a
 * standing soldier takes 1.3 m, so this is a little over one pass-through.
 */
const OVERLAP_BUDGET_M = 15 * DEFAULT_MOVE_CONFIG.walkSpeed * TICK_SECONDS;

const paceSpeed = (pace: LocomotionPace): number =>
  pace === 'sprint' ? DEFAULT_MOVE_CONFIG.sprintSpeed : pace === 'crouch' ? DEFAULT_MOVE_CONFIG.crouchSpeed : DEFAULT_MOVE_CONFIG.walkSpeed;
const ticksAt = (speed: number, metres: number): number => Math.ceil(metres / (speed * TICK_SECONDS) - 1e-9);

const across = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(b.x - a.x, b.z - a.z);

interface Soldier {
  slot: number;
  /** Null for a human: an obstacle, never steered. */
  intent: LocomotionIntent | null;
  start: NavPoint;
}

interface Run {
  arrivedAt: (number | null)[];
  ticks: number;
  /** Deepest overlap past two radii, metres. */
  deepest: number;
  /** Longest run of consecutive ticks any one pair overlapped past the epsilon. */
  longestOverlap: number;
  /** The closest any bot came to each human, metres. */
  nearestHuman: number;
  usPerAvoidanceTick: number;
  assertions: number;
  inputs: MoveInput[][];
  states: MoveState[][];
  starts: MoveState[];
}

function run(mesh: NavMesh, soldiers: readonly Soldier[], maxTicks: number, avoid = true, tuning: AvoidanceConfig = DEFAULT_AVOIDANCE_CONFIG): Run {
  const session = new Session();
  const followers = soldiers.map(() => new PathFollower(mesh, session.world.boxes));
  const avoidance = new Avoidance(mesh, soldiers.length, tuning);
  for (const s of soldiers) {
    const slot = session.slots[s.slot]!;
    slot.state = createMoveState(s.start.x, 0, s.start.z);
  }
  const starts = soldiers.map((s) => structuredClone(session.slots[s.slot]!.state));
  const arrivedAt: (number | null)[] = soldiers.map(() => null);
  const inputs: MoveInput[][] = soldiers.map(() => []);
  const states: MoveState[][] = soldiers.map(() => []);
  const streak = new Map<string, number>();
  let deepest = 0;
  let longestOverlap = 0;
  let nearestHuman = Infinity;
  let spentMs = 0;
  let now = 0;
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    const entries: AvoidanceEntry[] = soldiers.map((s, i) => {
      const slot = session.slots[s.slot]!;
      if (!s.intent) return { id: slot.netId, state: slot.state, input: null };
      const { input, status } = followers[i]!.step(slot.state, s.intent, slot.yaw);
      if (status === 'arrived' && arrivedAt[i] === null) arrivedAt[i] = tick;
      return { id: slot.netId, state: slot.state, input, hold: followers[i]!.onVault };
    });
    if (arrivedAt.every((a, i) => a !== null || !soldiers[i]!.intent)) break;
    const t0 = performance.now();
    const steered = avoid ? avoidance.step(entries) : entries.map((e) => (e.input ? { ...e.input } : null));
    spentMs += performance.now() - t0;
    soldiers.forEach((s, i) => {
      const input = steered[i];
      if (!input) return;
      session.slots[s.slot]!.input = input;
      inputs[i]!.push({ ...input });
    });
    now += TICK_MS;
    session.step(now);
    soldiers.forEach((s, i) => {
      if (s.intent) states[i]!.push(structuredClone(session.slots[s.slot]!.state));
    });

    for (let a = 0; a < soldiers.length; a++) {
      for (let b = a + 1; b < soldiers.length; b++) {
        const pa = session.slots[soldiers[a]!.slot]!.state;
        const pb = session.slots[soldiers[b]!.slot]!.state;
        const d = across(pa, pb);
        if (!soldiers[a]!.intent !== !soldiers[b]!.intent) nearestHuman = Math.min(nearestHuman, d);
        const depth = 2 * CAPSULE - d;
        deepest = Math.max(deepest, depth);
        const key = `${a}:${b}`;
        const n = depth > OVERLAP_EPSILON_M ? (streak.get(key) ?? 0) + 1 : 0;
        streak.set(key, n);
        longestOverlap = Math.max(longestOverlap, n);
      }
    }
  }
  const assertions = avoidance.assertions;
  avoidance.destroy();
  return { assertions, arrivedAt, ticks: tick, deepest, longestOverlap, nearestHuman, usPerAvoidanceTick: (spentMs * 1000) / Math.max(1, tick), inputs, states, starts };
}

describe('avoidance tuning (avoidance.json)', () => {
  it('is the file, validated', () => {
    const { $comment: _, ...values } = RAW_AVOIDANCE as Record<string, unknown>;
    expect(DEFAULT_AVOIDANCE_CONFIG).toEqual(values);
  });

  it('refuses a bad value, a misspelt key and a missing one, by name', () => {
    expect(() => parseAvoidanceConfig({ ...RAW_AVOIDANCE, adaptiveDivs: 2.5 })).toThrow(/adaptiveDivs must be an integer/);
    expect(() => parseAvoidanceConfig({ ...RAW_AVOIDANCE, horizonS: -1 })).toThrow(/horizonS must be in/);
    expect(() => parseAvoidanceConfig({ ...RAW_AVOIDANCE, horizon: 1 })).toThrow(/unknown key "horizon"/);
    const { weightToi: _, ...missing } = RAW_AVOIDANCE;
    expect(() => parseAvoidanceConfig(missing)).toThrow(/weightToi must be a finite number/);
  });
});

describe('local avoidance on the range (T-3.06)', () => {
  let mesh: NavMesh;
  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh('range');
  });

  describe('six bots through the west doorway from opposite sides', () => {
    // The doorway is x −9..−7.8 in the wall at z = 4 (3.85..4.15): 1.2 m,
    // room for one soldier at a time. Three start south of it between the
    // wall and the low wall, three north; each walks to the place of one
    // opposite, so all six want the doorway at once, from both sides.
    const XS = [-10.2, -8.4, -6.6];
    const SOUTH = XS.map((x) => ({ x, y: 0, z: 2 }));
    const NORTH = XS.map((x) => ({ x, y: 0, z: 6.5 }));
    const soldiers = (pace: LocomotionPace): Soldier[] => [
      ...SOUTH.map((start, i) => ({ slot: i, start, intent: { goal: NORTH[2 - i]!, pace } })),
      ...NORTH.map((start, i) => ({ slot: 3 + i, start, intent: { goal: SOUTH[2 - i]!, pace } })),
    ];

    for (const pace of ['walk', 'sprint', 'crouch'] as const) {
      describe(`at ${pace}`, () => {
        let r: Run;
        let bound: number;
        let overlapTicks: number;
        beforeAll(() => {
          const speed = paceSpeed(pace);
          // Bounded time: four times the longest trip walked alone at this pace.
          const longest = Math.max(...soldiers(pace).map((s) => pathLength(mesh.path(s.start, s.intent!.goal)!.points)));
          bound = Math.ceil((4 * longest) / (speed * TICK_SECONDS));
          overlapTicks = ticksAt(speed, OVERLAP_BUDGET_M);
          r = run(mesh, soldiers(pace), 3 * bound);
          console.log(
            `[avoid] doorway at ${pace}: arrived at ${r.arrivedAt.join(', ')} (bound ${bound}); deepest overlap ${r.deepest.toFixed(3)} m, ` +
              `longest ${r.longestOverlap} ticks past ${OVERLAP_EPSILON_M} m (N ${overlapTicks}); ${r.assertions} bot(s) ran out of patience; ` +
              `${r.usPerAvoidanceTick.toFixed(1)} µs per avoidance tick`,
          );
        });

        it('all get through within a bounded time, with no deadlock', () => {
          for (const a of r.arrivedAt) {
            expect(a).not.toBeNull();
            expect(a!).toBeLessThanOrEqual(bound);
          }
        });

        it(`no two capsules overlap past ${OVERLAP_EPSILON_M} m for more than N consecutive ticks`, () => {
          expect(r.longestOverlap).toBeLessThanOrEqual(overlapTicks);
        });

        it('moves nobody itself: every bot equals a replay of its inputs through stepCharacter', () => {
          const boxes = new Session().world.boxes;
          r.inputs.forEach((inputs, i) => {
            let s = r.starts[i]!;
            inputs.forEach((input, k) => {
              s = stepCharacter(s, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
              expect(s).toEqual(r.states[i]![k]);
            });
          });
        });
      });
    }

    it('deadlocks without the patience rule — the reason it exists', () => {
      const never = { ...DEFAULT_AVOIDANCE_CONFIG, patienceTicks: 300 };
      const r = run(mesh, soldiers('walk'), 299, true, never);
      const stuck = r.arrivedAt.filter((a) => a === null).length;
      console.log(`[avoid] doorway at walk, no patience: ${stuck} of 6 still short of their goals after 299 ticks`);
      expect(stuck).toBeGreaterThan(0);
    });
  });

  describe('a standing human', () => {
    // Open ground west of everything, with the human square on the bot's line.
    const FROM = { x: -60, y: 0, z: -10 };
    const TO = { x: -60, y: 0, z: -30 };
    const HUMAN = { x: -60, y: 0, z: -20 };
    const soldiers: Soldier[] = [
      { slot: 0, start: FROM, intent: { goal: TO, pace: 'walk' } },
      { slot: 1, start: HUMAN, intent: null },
    ];

    it('is square on a straight path', () => {
      expect(mesh.path(FROM, TO)!.points).toHaveLength(2);
    });

    it('is walked through without avoidance', () => {
      const r = run(mesh, soldiers, 600, false);
      expect(r.arrivedAt[0]).not.toBeNull();
      // Within a tick's travel of dead centre.
      expect(r.nearestHuman).toBeLessThan(DEFAULT_MOVE_CONFIG.walkSpeed * TICK_SECONDS);
    });

    it('is routed round with it, and the bot still arrives', () => {
      const r = run(mesh, soldiers, 600);
      console.log(`[avoid] standing human: nearest pass ${r.nearestHuman.toFixed(3)} m (two radii ${(2 * CAPSULE).toFixed(2)} m), arrived at ${r.arrivedAt[0]}`);
      expect(r.arrivedAt[0]).not.toBeNull();
      expect(r.nearestHuman).toBeGreaterThanOrEqual(2 * CAPSULE - OVERLAP_EPSILON_M);
      expect(r.assertions).toBe(0);
    });
  });

  describe('45 agents', () => {
    // Two ranks crossing head-on through each other on open ground, stepped
    // through stepCharacter without a session (a session has six slots).
    const N = 45;
    const starts: NavPoint[] = [];
    const goals: NavPoint[] = [];
    for (let i = 0; i < N; i++) {
      const north = i % 2 === 0;
      const x = -50 + i * 0.9;
      starts.push({ x, y: 0, z: north ? -15 : -35 });
      goals.push({ x: x + (north ? 3 : -3), y: 0, z: north ? -35 : -15 });
    }

    it('costs a logged amount per tick, and everyone arrives', () => {
      const boxes = new Session().world.boxes;
      const followers = starts.map(() => new PathFollower(mesh, boxes));
      const avoidance = new Avoidance(mesh, N);
      let states: MoveState[] = starts.map((p) => createMoveState(p.x, 0, p.z));
      const yaws = starts.map(() => 0);
      const arrived = starts.map(() => false);
      let spentMs = 0;
      let ticks = 0;
      let worst = 0;
      let deepest = 0;
      const MAX = 900;
      for (; ticks < MAX && !arrived.every(Boolean); ticks++) {
        const entries: AvoidanceEntry[] = states.map((state, i) => {
          const { input, status } = followers[i]!.step(state, { goal: goals[i]!, pace: 'walk' }, yaws[i]!);
          if (status === 'arrived') arrived[i] = true;
          return { id: 100 + i, state, input, hold: followers[i]!.onVault };
        });
        const t0 = performance.now();
        const inputs = avoidance.step(entries);
        const ms = performance.now() - t0;
        spentMs += ms;
        if (ticks > 0) worst = Math.max(worst, ms);
        states = states.map((s, i) => {
          yaws[i] = inputs[i]!.yaw;
          return stepCharacter(s, inputs[i]!, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        });
        for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) deepest = Math.max(deepest, 2 * CAPSULE - across(states[a]!, states[b]!));
      }
      const mean = (spentMs * 1000) / ticks;
      console.log(
        `[avoid] 45 agents: ${mean.toFixed(0)} µs per crowd tick mean, ${(worst * 1000).toFixed(0)} µs worst ` +
          `(${((mean / 1000 / (1000 / 30)) * 100).toFixed(1)} % of the tick); all arrived by tick ${ticks}; ${avoidance.assertions} ran out of patience; deepest overlap ${deepest.toFixed(3)} m`,
      );
      avoidance.destroy();
      expect(arrived.every(Boolean)).toBe(true);
      // Open ground has room: the crowd keeps everyone apart on its own.
      expect(deepest).toBeLessThanOrEqual(OVERLAP_EPSILON_M);
      // Not a gate — T-3.35 owns the AI budget — only a tripwire far above today's cost.
      expect(mean).toBeLessThan(8333);
    });
  });
});
