import { describe, expect, it } from 'vitest';
import {
  type PerceptionObserver,
  type PerceptionTarget,
  type Stance,
  awarenessRate,
  coneHalfAngle,
  inViewCone,
  isDetected,
  sight,
  stanceHeight,
  stepAwareness,
} from './perception.ts';
import { ANGLE_UNITS, wrapAngle } from '../math/angles.ts';
import { rotateY } from '../math/trig.ts';
import { TICK_SECONDS } from '../sim/Clock.ts';
import { DEFAULT_MOVE_CONFIG } from '../sim/CharacterController.ts';
import { type EnemyPerception, getEnemy } from '../sim/enemies.ts';
import { type WorldBox, boxFrom } from '../sim/world.ts';

/** Our own numbers, so retuning enemies.json never changes what these prove. */
const P: EnemyPerception = {
  visionRangeM: 80,
  fovDeg: 120,
  detectAt: 0.7,
  nearRatePerSec: 3,
  farRatePerSec: 0.2,
  maxRatePerSec: 3,
  decayPerSec: 0.25,
  crouchFactor: 0.6,
  proneFactor: 0.25,
  movingSpeedMps: 0.5,
  movingFactor: 1.5,
  firingFactor: 3,
  edgeFactor: 0.3,
};

/** Eye at standing height at the origin, facing +Z. */
const OBSERVER: PerceptionObserver = { eye: { x: 0, y: 1.55, z: 0 }, yaw: 0 };

const target = (z: number, stance: Stance = 'standing', over: Partial<PerceptionTarget> = {}): PerceptionTarget => ({
  feet: { x: 0, y: 0, z },
  stance,
  speed: 0,
  firing: false,
  ...over,
});

const wall = (id: string, z: number, h: number): WorldBox => boxFrom({ id, x: 0, y: 0, z, w: 6, h, d: 0.4 }, 'cover');

/** Awareness from zero after `n` thinks of `dt`, every value along the way. */
function run(
  n: number,
  t: PerceptionTarget,
  world: readonly WorldBox[],
  p: EnemyPerception = P,
  dt = TICK_SECONDS,
  start = 0,
): number[] {
  const out: number[] = [];
  let a = start;
  for (let i = 0; i < n; i++) {
    a = stepAwareness(a, sight(OBSERVER, t, world, p), t, p, dt);
    out.push(a);
  }
  return out;
}

/** Thinks until detection, or Infinity if `limit` passes without it. */
function thinksToDetect(t: PerceptionTarget, world: readonly WorldBox[], p: EnemyPerception = P, dt = TICK_SECONDS, limit = 10_000): number {
  let a = 0;
  for (let i = 1; i <= limit; i++) {
    a = stepAwareness(a, sight(OBSERVER, t, world, p), t, p, dt);
    if (isDetected(a, p)) return i;
  }
  return Infinity;
}

describe('line of sight (T-3.13)', () => {
  it('never sees a target behind a full wall, in any stance, however long it looks', () => {
    const world = [wall('full', 10, 4)];
    for (const stance of ['standing', 'crouched', 'prone'] as const) {
      const t = target(20, stance, { speed: 3, firing: true });
      const s = sight(OBSERVER, t, world, P);
      expect(s.inRange && s.inCone).toBe(true);
      expect(s.exposure).toBe(0);
      expect(s.visible).toBe(false);
      expect(run(30 * 60, t, world).every((a) => a === 0)).toBe(true);
      expect(thinksToDetect(t, world, P, TICK_SECONDS, 30 * 60)).toBe(Infinity);
    }
  });

  it('sees a head over a low wall standing, and nothing of it crouched or prone', () => {
    // 1.2 m wall a metre in front of a target 20 m out.
    const world = [wall('low', 19, 1.2)];
    const standing = sight(OBSERVER, target(20, 'standing'), world, P);
    expect(standing.visible).toBe(true);
    // Head clear; chest and shin behind the wall.
    expect(standing.exposure).toBeCloseTo(1 / 3, 12);
    expect(sight(OBSERVER, target(20, 'crouched'), world, P).visible).toBe(false);
    expect(sight(OBSERVER, target(20, 'prone'), world, P).visible).toBe(false);

    expect(thinksToDetect(target(20, 'standing'), world)).toBeLessThan(Infinity);
    expect(thinksToDetect(target(20, 'crouched'), world, P, TICK_SECONDS, 30 * 60)).toBe(Infinity);
    // Half hidden is slower than in the open.
    expect(thinksToDetect(target(20, 'standing'), world)).toBeGreaterThan(thinksToDetect(target(20, 'standing'), []));
  });

  it('samples shin, chest and head up the stance height', () => {
    expect(stanceHeight('standing')).toBe(DEFAULT_MOVE_CONFIG.height);
    expect(stanceHeight('crouched')).toBe(DEFAULT_MOVE_CONFIG.crouchHeight);
    expect(stanceHeight('prone')).toBe(DEFAULT_MOVE_CONFIG.proneHeight);
    // A bar from 0.5 to 1.3 m just in front of the target hides the chest
    // alone: the shin shows under it and the head over it.
    const bar = boxFrom({ id: 'bar', x: 0, y: 0.5, z: 19.8, w: 6, h: 0.8, d: 0.2 }, 'cover');
    const s = sight(OBSERVER, target(20, 'standing'), [bar], P);
    expect(s.exposure).toBeCloseTo(2 / 3, 12);
  });

  it('is not hidden by the wall the target stands flat against', () => {
    // The wall's near face is exactly where the target's probes end.
    const world = [wall('behind', 20.4, 4)];
    const s = sight(OBSERVER, { ...target(20), feet: { x: 0, y: 0, z: 20.2 } }, world, P);
    expect(s.exposure).toBe(1);
  });
});

describe('the view cone (T-3.13)', () => {
  it('never sees a target outside the cone, at any range', () => {
    // Behind, beside and just past the cone's edge; near and far, well inside range and out.
    const half = coneHalfAngle(P);
    for (const bearing of [ANGLE_UNITS / 2, ANGLE_UNITS / 4 + 50, half + 2, -(half + 2), ANGLE_UNITS - half - 2]) {
      for (const r of [0.5, 1, 5, 20, 40, 79, 200]) {
        const d = rotateY(0, r, wrapAngle(bearing));
        const t = { ...target(0, 'standing', { speed: 5, firing: true }), feet: { x: d.x, y: 0, z: d.z } };
        const s = sight(OBSERVER, t, [], P);
        expect(s.inCone).toBe(false);
        expect(s.visible).toBe(false);
        expect(awarenessRate(s, t, P)).toBe(0);
        expect(run(90, t, []).every((a) => a === 0)).toBe(true);
      }
    }
  });

  it('puts the edge at the table half angle, and turns with the observer', () => {
    const half = coneHalfAngle(P);
    expect(half).toBe(Math.round((120 / 720) * ANGLE_UNITS));
    const at = (bearing: number, yaw = 0) => {
      const d = rotateY(0, 10, wrapAngle(bearing + yaw));
      return inViewCone(yaw, d.x, d.z, P).inCone;
    };
    for (const yaw of [0, 700, 2048, 3900]) {
      expect(at(0, yaw)).toBe(true);
      expect(at(half - 1, yaw)).toBe(true);
      expect(at(-(half - 1), yaw)).toBe(true);
      expect(at(half + 1, yaw)).toBe(false);
      expect(at(-(half + 1), yaw)).toBe(false);
    }
    // Dead ahead is the centre; the edge is ~0.
    expect(inViewCone(0, 0, 10, P).centrality).toBe(1);
    const edge = rotateY(0, 10, half - 1);
    expect(inViewCone(0, edge.x, edge.z, P).centrality).toBeLessThan(0.01);
  });

  it('sees nothing past its range, and a 360° cone sees behind', () => {
    const past = sight(OBSERVER, target(P.visionRangeM + 1), [], P);
    expect(past.inCone).toBe(true);
    expect(past.inRange).toBe(false);
    expect(past.visible).toBe(false);
    const all = { ...P, fovDeg: 360 };
    expect(sight(OBSERVER, target(-10), [], all).visible).toBe(true);
  });
});

describe('awareness (T-3.13)', () => {
  it('rises monotonically in view, falls monotonically out of it, and stays in 0..1', () => {
    const t = target(30);
    const rising = run(300, t, []);
    for (let i = 1; i < rising.length; i++) expect(rising[i]!).toBeGreaterThanOrEqual(rising[i - 1]!);
    expect(rising[0]!).toBeGreaterThan(0);
    expect(rising[1]!).toBeGreaterThan(rising[0]!);
    expect(rising.at(-1)).toBe(1);

    // Same target, now behind a wall: from full awareness down to nothing.
    const falling = run(300, t, [wall('full', 10, 4)], P, TICK_SECONDS, 1);
    for (let i = 1; i < falling.length; i++) expect(falling[i]!).toBeLessThanOrEqual(falling[i - 1]!);
    expect(falling[0]!).toBeLessThan(1);
    expect(falling.at(-1)).toBe(0);
    // At the data's rate: 1 / 0.25 per second = 4 s = 120 ticks to forget.
    expect(falling[118]!).toBeGreaterThan(0);
    expect(falling[120]!).toBe(0);
  });

  it('detects on crossing the threshold, never on the first visible think', () => {
    const t = target(20);
    const seq = run(300, t, []);
    const first = seq.findIndex((a) => isDetected(a, P));
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < first; i++) expect(seq[i]!).toBeLessThan(P.detectAt);
    expect(seq[first]!).toBeGreaterThanOrEqual(P.detectAt);

    // The worst case the committed rifleman allows — point blank, dead ahead,
    // moving and firing — still takes more than one think at 30 Hz or at the
    // brains' 10 Hz.
    const rifleman = getEnemy('rifleman').perception;
    const loud = target(1, 'standing', { speed: 6, firing: true });
    expect(thinksToDetect(loud, [], rifleman, TICK_SECONDS)).toBeGreaterThan(1);
    expect(thinksToDetect(loud, [], rifleman, 3 * TICK_SECONDS)).toBeGreaterThan(1);
  });

  it('takes longer to detect a prone target at 40 m than a standing one', () => {
    for (const p of [P, getEnemy('rifleman').perception]) {
      const standing = thinksToDetect(target(40, 'standing'), [], p);
      const crouched = thinksToDetect(target(40, 'crouched'), [], p);
      const prone = thinksToDetect(target(40, 'prone'), [], p);
      expect(standing).toBeLessThan(crouched);
      expect(crouched).toBeLessThan(prone);
      expect(prone).toBeLessThan(Infinity);
    }
  });

  it('rises faster close, moving, firing and dead ahead', () => {
    const rate = (t: PerceptionTarget, obs: PerceptionObserver = OBSERVER) => awarenessRate(sight(obs, t, [], P), t, P);
    expect(rate(target(10))).toBeGreaterThan(rate(target(40)));
    expect(rate(target(40))).toBeGreaterThan(rate(target(70)));
    expect(rate(target(40, 'standing', { speed: 2 }))).toBeGreaterThan(rate(target(40)));
    // Under the moving threshold is standing still.
    expect(rate(target(40, 'standing', { speed: 0.2 }))).toBe(rate(target(40)));
    expect(rate(target(40, 'standing', { firing: true }))).toBeGreaterThan(rate(target(40)));
    const turned = { ...OBSERVER, yaw: coneHalfAngle(P) - 40 };
    expect(rate(target(40), turned)).toBeLessThan(rate(target(40)));
    expect(rate(target(40), turned)).toBeGreaterThan(0);
    // Never past the cap.
    expect(rate(target(1, 'standing', { speed: 6, firing: true }))).toBe(P.maxRatePerSec);
  });

  it('is a pure function: no clock, the same answer every call, the inputs untouched', () => {
    const world = [wall('low', 19, 1.2)];
    const t = target(20);
    const snapshot = JSON.stringify([OBSERVER, t, world, P]);
    const a = sight(OBSERVER, t, world, P);
    const b = sight(OBSERVER, t, world, P);
    expect(b).toEqual(a);
    expect(stepAwareness(0.3, a, t, P, 0.1)).toBe(stepAwareness(0.3, b, t, P, 0.1));
    // Time is the dt passed in: no time, no change.
    expect(stepAwareness(0.3, a, t, P, 0)).toBe(0.3);
    expect(JSON.stringify([OBSERVER, t, world, P])).toBe(snapshot);
  });
});
