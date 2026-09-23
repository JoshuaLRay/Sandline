/**
 * The grenade search and its inputs (T-3.22): the tuning parses and refuses
 * nonsense, the still-watch starts again when its target moves, and no throw
 * the search returns goes off within blast reach of the thrower or a friend.
 */
import { describe, expect, it } from 'vitest';
import { type TargetMemory, createTargetMemory, getProjectile, projectileArc, rememberSeen, requireWorld } from '@sandline/shared';
import {
  THROW,
  chooseThrow,
  createStillWatch,
  isGrenadeTarget,
  parseThrowConfig,
  stillFor,
  throwEye,
  throwLaunch,
  watchStill,
} from './throw.ts';
import RAW_THROW from './throw.json' with { type: 'json' };

const FRAG = getProjectile('frag');
const boxes = requireWorld('range').boxes;
const world = { boxes, groundY: 0 };
/** Crouched just south of the low wall (x −12..−6, z −1.15..−0.85, 1.0 m tall). */
const BEHIND_WALL = { x: -9, y: 0, z: -1.6 };

describe('throw.json (T-3.22)', () => {
  it('parses the committed tuning', () => {
    expect(THROW.projectile).toBe('frag');
    expect(THROW.staticSeconds).toBeGreaterThan(0);
  });

  it('refuses unknown keys, out-of-range numbers and inverted ranges', () => {
    expect(() => parseThrowConfig({ ...RAW_THROW, extra: 1 })).toThrow(/unknown key/);
    expect(() => parseThrowConfig({ ...RAW_THROW, reachFraction: 1.5 })).toThrow(/reachFraction/);
    expect(() => parseThrowConfig({ ...RAW_THROW, minRangeM: 40, maxRangeM: 30 })).toThrow(/maxRangeM/);
    expect(() => parseThrowConfig({ ...RAW_THROW, pitchMinDeg: 50, pitchMaxDeg: 10 })).toThrow(/pitchMaxDeg/);
    expect(() => parseThrowConfig({ ...RAW_THROW, projectile: '' })).toThrow(/projectile/);
  });
});

describe('the still-watch (T-3.22)', () => {
  function seen(memory: TargetMemory, x: number, z: number, now: number) {
    rememberSeen(memory, 1, { x, y: 0, z }, now, false);
  }

  it('counts from when the target stopped, and starts again when it moves or changes', () => {
    const memory = createTargetMemory();
    const watch = createStillWatch();
    seen(memory, 0, 0, 0);
    watchStill(watch, 1, memory, 0, 0);
    seen(memory, THROW.staticRadiusM * 0.5, 0, 2);
    watchStill(watch, 1, memory, 0, 2);
    expect(stillFor(watch, 1, 4)).toBeCloseTo(4);
    seen(memory, THROW.staticRadiusM * 2, 0, 5);
    watchStill(watch, 1, memory, 0, 5);
    expect(stillFor(watch, 1, 6)).toBeCloseTo(1);
    expect(stillFor(watch, 2, 6)).toBe(0);
    watchStill(watch, null, memory, 0, 7);
    expect(stillFor(watch, 1, 8)).toBe(0);
  });
});

describe('whom to throw at (T-3.22)', () => {
  const from = { x: -9, y: 0, z: 20 };

  it('a crouched soldier still behind the low wall, in range', () => {
    expect(isGrenadeTarget(from, BEHIND_WALL, THROW.staticSeconds, boxes)).toBe(true);
  });

  it('not one still for less than the data says, out of range, or in the open', () => {
    expect(isGrenadeTarget(from, BEHIND_WALL, THROW.staticSeconds - 0.1, boxes)).toBe(false);
    expect(isGrenadeTarget({ x: -9, y: 0, z: 1 }, BEHIND_WALL, 10, boxes)).toBe(false);
    expect(isGrenadeTarget({ x: -9, y: 0, z: 60 }, BEHIND_WALL, 10, boxes)).toBe(false);
    expect(isGrenadeTarget(from, { x: 0, y: 0, z: 0 }, 10, boxes)).toBe(false);
  });
});

describe('the throw search (T-3.22)', () => {
  it('finds an arc from 20 m that goes off within blast reach of a crouched target behind the low wall', () => {
    const from = { x: -9, y: 0, z: 20 };
    const choice = chooseThrow(FRAG, throwEye(from), BEHIND_WALL, [from], world);
    expect(choice).not.toBeNull();
    console.log(`throw from 20 m: pitch ${choice!.pitch}, goes off ${choice!.missM.toFixed(2)} m from the target`);
    expect(choice!.missM).toBeLessThanOrEqual(FRAG.blastRadiusM * THROW.reachFraction);
    // And it is the arc the server will fly: the same launch, the same stepper.
    const { origin, velocity } = throwLaunch(FRAG, throwEye(from), choice!.yaw, choice!.pitch, world);
    const arc = projectileArc(FRAG, origin, velocity, { dt: 1 / 30, maxSeconds: FRAG.fuseSeconds + 1 / 30, world });
    expect(arc.detonation).toEqual(choice!.landing);
  });

  it('never returns a throw that goes off within blast reach of the thrower or a friend', () => {
    const clear = FRAG.blastRadiusM + THROW.safetyMarginM;
    let chosen = 0;
    let refused = 0;
    // A grid of throwers round the wall, each with a friend at a spread of places near the target.
    for (const tz of [10, 16, 22, 28]) {
      for (const tx of [-20, -9, 2]) {
        const from = { x: tx, y: 0, z: tz };
        for (const [fx, fz] of [[-9, -5], [-5, -2], [-14, 0], [-9, 6], [tx, tz - 3]] as const) {
          const friend = { x: fx, y: 0, z: fz };
          const choice = chooseThrow(FRAG, throwEye(from), BEHIND_WALL, [from, friend], world);
          if (choice === null) {
            refused++;
            continue;
          }
          chosen++;
          for (const f of [from, friend]) expect(Math.hypot(choice.landing.x - f.x, choice.landing.z - f.z)).toBeGreaterThan(clear);
        }
      }
    }
    console.log(`safety grid: ${chosen} throws chosen, ${refused} refused`);
    expect(chosen).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it('refuses a target too close to throw at without catching itself', () => {
    const from = { x: -9, y: 0, z: 2 };
    expect(chooseThrow(FRAG, throwEye(from), BEHIND_WALL, [from], world)).toBeNull();
  });
});
