import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, type MoveInput, createMoveState, stepCharacter } from './CharacterController.ts';
import { TICK_SECONDS } from './Clock.ts';
import { ANGLE_QUARTER, WIRE_ANGLE_UNITS } from '../math/angles.ts';
import { cos, sin } from '../math/trig.ts';
import { wireToTable } from '../math/angles.ts';

const input = (over: Partial<MoveInput> = {}): MoveInput => ({
  moveX: 0,
  moveY: 0,
  yaw: 0,
  jump: false,
  sprint: false,
  crouch: false,
  ...over,
});

/** Displacement produced by one tick of the given input. */
function move(inp: MoveInput) {
  const a = createMoveState(0, 0, 0);
  const b = stepCharacter(a, inp, TICK_SECONDS, DEFAULT_MOVE_CONFIG);
  return { x: b.x - a.x, z: b.z - a.z };
}

describe('movement directions (T-1.12)', () => {
  it('moves forward along +Z at yaw 0', () => {
    const d = move(input({ moveY: 1 }));
    expect(d.z).toBeGreaterThan(0);
    expect(Math.abs(d.x)).toBeLessThan(1e-9);
  });

  it('moves backward along -Z at yaw 0', () => {
    expect(move(input({ moveY: -1 })).z).toBeLessThan(0);
  });

  /**
   * The regression that shipped: strafe must be cross(forward, up).
   *
   * In a right-handed Y-up system a viewer looking along +Z has +X on their
   * LEFT, so using cross(up, forward) makes D move the player leftward on
   * screen. Asserting against the cross product rather than a hardcoded axis
   * keeps this correct if the forward convention ever changes.
   */
  it('strafes right along cross(forward, up), not the reverse', () => {
    for (const yaw of [0, 128, 256, 512, 768, 1000]) {
      const a = wireToTable(yaw);
      const fx = sin(a);
      const fz = cos(a);
      // cross((fx,0,fz), (0,1,0)) = (-fz, 0, fx)
      const rightX = -fz;
      const rightZ = fx;

      const d = move(input({ moveX: 1, yaw }));
      const len = Math.sqrt(d.x * d.x + d.z * d.z);
      expect(len).toBeGreaterThan(0);
      // Normalised displacement must point along the right vector.
      expect(d.x / len).toBeCloseTo(rightX, 6);
      expect(d.z / len).toBeCloseTo(rightZ, 6);
    }
  });

  it('strafes left opposite to right', () => {
    const r = move(input({ moveX: 1 }));
    const l = move(input({ moveX: -1 }));
    expect(l.x).toBeCloseTo(-r.x, 9);
    expect(l.z).toBeCloseTo(-r.z, 9);
  });

  it('keeps forward and right perpendicular', () => {
    for (const yaw of [0, 200, 450, 900]) {
      const f = move(input({ moveY: 1, yaw }));
      const r = move(input({ moveX: 1, yaw }));
      expect(f.x * r.x + f.z * r.z).toBeCloseTo(0, 9);
    }
  });

  it('turns the movement frame with yaw', () => {
    const atZero = move(input({ moveY: 1, yaw: 0 }));
    const atQuarter = move(input({ moveY: 1, yaw: WIRE_ANGLE_UNITS / 4 }));
    expect(atZero.z).toBeGreaterThan(0);
    expect(atQuarter.x).toBeGreaterThan(0);
    expect(Math.abs(atQuarter.z)).toBeLessThan(1e-9);
    void ANGLE_QUARTER;
  });

  it('does not let diagonal movement outrun straight movement', () => {
    const straight = move(input({ moveY: 1 }));
    const diagonal = move(input({ moveX: 1, moveY: 1 }));
    const speedOf = (d: { x: number; z: number }) => Math.sqrt(d.x * d.x + d.z * d.z);
    expect(speedOf(diagonal)).toBeCloseTo(speedOf(straight), 9);
  });

  it('applies sprint and crouch speeds', () => {
    const speedOf = (i: MoveInput) => {
      const d = move(i);
      return Math.sqrt(d.x * d.x + d.z * d.z) / TICK_SECONDS;
    };
    expect(speedOf(input({ moveY: 1 }))).toBeCloseTo(DEFAULT_MOVE_CONFIG.walkSpeed, 6);
    expect(speedOf(input({ moveY: 1, sprint: true }))).toBeCloseTo(DEFAULT_MOVE_CONFIG.sprintSpeed, 6);
    expect(speedOf(input({ moveY: 1, crouch: true }))).toBeCloseTo(DEFAULT_MOVE_CONFIG.crouchSpeed, 6);
  });

  it('ignores absurd input magnitudes from a hostile client', () => {
    const sane = move(input({ moveY: 1 }));
    const absurd = move(input({ moveY: 1e9 }));
    expect(absurd.z).toBeCloseTo(sane.z, 9);
  });
});

/* -- World collision (T-1.12) ---------------------------------------------- */

import { type WorldBox, boxFrom } from './world.ts';

const wall = (id: string, x: number, z: number, w: number, h: number, d: number, y = 0): WorldBox =>
  boxFrom({ id, x, y, z, w, h, d }, 'cover');

/** Walk `ticks` ticks of `inp` from `start` through `world`. */
function walk(start: { x: number; y?: number; z: number }, inp: MoveInput, ticks: number, world: WorldBox[]) {
  let s = createMoveState(start.x, start.y ?? 0, start.z);
  for (let i = 0; i < ticks; i++) s = stepCharacter(s, inp, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world);
  return s;
}

describe('world collision (T-1.12)', () => {
  const cfg = DEFAULT_MOVE_CONFIG;

  it('stops at a wall instead of walking through it', () => {
    const w = [wall('wall', 0, 5, 6, 2.4, 0.3)];
    const s = walk({ x: 0, z: 0 }, input({ moveY: 1, sprint: true }), 90, w);
    // Sprinting 3 s would reach z = 20; the wall's near face is at 4.85.
    expect(s.z).toBeCloseTo(4.85 - cfg.radius, 9);
    expect(s.x).toBeCloseTo(0, 9);
  });

  it('slides along a wall when walking into it at an angle', () => {
    const w = [wall('wall', 0, 5, 40, 2.4, 0.3)];
    // Yaw a 45-degree turn: forward is (sin, cos) = (0.707, 0.707).
    const s = walk({ x: 0, z: 0 }, input({ moveY: 1, yaw: 128 }), 90, w);
    expect(s.z).toBeCloseTo(4.85 - cfg.radius, 9);
    // The X component kept going for the whole walk: 4.2 m/s * 3 s * 0.707.
    expect(s.x).toBeGreaterThan(8);
  });

  it('steps onto a ledge no higher than stepHeight and is blocked by a taller one', () => {
    // A kerb 20 m deep: 60 ticks of walking (8.4 m) ends well inside it.
    const low = [wall('kerb', 0, 13, 6, cfg.stepHeight - 0.05, 20)];
    const onKerb = walk({ x: 0, z: 0 }, input({ moveY: 1 }), 60, low);
    expect(onKerb.y).toBeCloseTo(cfg.stepHeight - 0.05, 9);
    expect(onKerb.grounded).toBe(true);
    expect(onKerb.z).toBeGreaterThan(4);

    const tall = [wall('crate', 0, 13, 6, cfg.stepHeight + 0.2, 20)];
    const blocked = walk({ x: 0, z: 0 }, input({ moveY: 1 }), 60, tall);
    expect(blocked.y).toBe(0);
    expect(blocked.z).toBeCloseTo(3 - cfg.radius, 9);
  });

  it('walks off a crate and falls to the ground', () => {
    const w = [wall('crate', 0, 0, 2, 1.2, 2)];
    const start = { x: 0, y: 1.2, z: 0 };
    let s = createMoveState(start.x, start.y, start.z);
    expect(stepCharacter(s, input(), TICK_SECONDS, cfg, w).grounded).toBe(true);
    s = walk(start, input({ moveY: 1 }), 60, w);
    expect(s.y).toBe(0);
    expect(s.grounded).toBe(true);
    expect(s.z).toBeGreaterThan(1);
  });

  it('lands a jump on top of cover', () => {
    const w = [wall('crate', 0, 1.6, 2, 1.0, 2)];
    let s = createMoveState(0, 0, 0);
    s = stepCharacter(s, input({ moveY: 1, jump: true, sprint: true }), TICK_SECONDS, cfg, w);
    let landed = s;
    for (let i = 0; i < 60 && !landed.grounded; i++) {
      landed = stepCharacter(landed, input({ moveY: 1, sprint: true }), TICK_SECONDS, cfg, w);
    }
    expect(landed.grounded).toBe(true);
    expect(landed.y).toBeCloseTo(1.0, 9);
  });

  it('cannot jump up into a ceiling', () => {
    const w = [wall('ceiling', 0, 0, 4, 1, 4, cfg.height + 0.3)];
    let s = createMoveState(0, 0, 0);
    let peak = 0;
    s = stepCharacter(s, input({ jump: true }), TICK_SECONDS, cfg, w);
    for (let i = 0; i < 40; i++) {
      s = stepCharacter(s, input(), TICK_SECONDS, cfg, w);
      if (s.y > peak) peak = s.y;
    }
    expect(peak).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(s.grounded).toBe(true);
  });

  it('does not tunnel through a post at sprint speed, from any side', () => {
    const post = [wall('post', 0, 5, 0.18, 1.4, 0.18)];
    for (const yaw of [0, 512]) {
      const from = yaw === 0 ? { x: 0, z: 0 } : { x: 0, z: 10 };
      const s = walk(from, input({ moveY: 1, sprint: true, yaw }), 60, post);
      // Held on the near side of the post, never across it.
      if (yaw === 0) expect(s.z).toBeLessThan(5);
      else expect(s.z).toBeGreaterThan(5);
    }
  });

  it('ignores the world entirely when given none, exactly as before T-1.12', () => {
    const s = walk({ x: 0, z: 0 }, input({ moveY: 1 }), 30, []);
    expect(s.z).toBeCloseTo(cfg.walkSpeed, 6);
  });
});


describe('crouch height and clearance (T-2.20)', () => {
  const lowCeiling = [wall('low ceiling', 0, 2, 4, 0.3, 4, 1.3)];

  it('fits under a ceiling while crouched but not while standing', () => {
    const crouched = walk({ x: 0, z: 0 }, input({ moveY: 1, crouch: true }), 30, lowCeiling);
    const standing = walk({ x: 0, z: 0 }, input({ moveY: 1 }), 30, lowCeiling);
    expect(crouched.z).toBeGreaterThan(2);
    expect(standing.z).toBeLessThan(2);
    expect(DEFAULT_MOVE_CONFIG.crouchHeight).toBeLessThan(DEFAULT_MOVE_CONFIG.height);
  });

  it('uses crouched height for headroom and standing height when rising', () => {
    let s = createMoveState(0, 0, 0);
    for (let i = 0; i < 20; i += 1) {
      s = stepCharacter(s, input({ moveY: 1, crouch: true }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, lowCeiling);
    }
    const underCeiling = s;
    const standing = stepCharacter(underCeiling, input({ crouch: false }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, lowCeiling);
    expect(underCeiling.z).toBeGreaterThan(1);
    expect(standing.z).toBe(underCeiling.z);
    expect(standing.y).toBe(0);
  });

  it('keeps downed geometry distinct from crouch', () => {
    const crouched = stepCharacter(createMoveState(0, 0, 0), input({ crouch: true, moveY: 1 }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, []);
    const downed = stepCharacter(createMoveState(0, 0, 0), input({ downed: true, moveY: 1 }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, []);
    expect(crouched.y).toBe(0);
    expect(downed.y).toBe(0);
    expect(crouched.z).toBeGreaterThan(downed.z);
  });
});

describe('downed: crawling (T-2.13)', () => {
  const forward = (extra: Partial<MoveInput> = {}): MoveInput => ({
    moveX: 0,
    moveY: 1,
    yaw: 0,
    jump: false,
    sprint: false,
    crouch: false,
    ...extra,
  });
  const travel = (input: MoveInput, ticks: number): { dz: number; y: number } => {
    let s = createMoveState(0, 0, 0);
    for (let i = 0; i < ticks; i += 1) s = stepCharacter(s, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, []);
    return { dz: s.z, y: s.y };
  };

  it('moves at the crawl speed, and sprint does not lift it', () => {
    const ticks = 30;
    const crawl = travel(forward({ downed: true }), ticks);
    expect(crawl.dz).toBeCloseTo(DEFAULT_MOVE_CONFIG.crawlSpeed * TICK_SECONDS * ticks, 9);
    expect(travel(forward({ downed: true, sprint: true }), ticks).dz).toBeCloseTo(crawl.dz, 12);
    expect(crawl.dz).toBeLessThan(travel(forward({ crouch: true }), ticks).dz);
  });

  it('cannot jump', () => {
    const up = travel(forward({ jump: true }), 3);
    expect(up.y).toBeGreaterThan(0);
    expect(travel(forward({ downed: true, jump: true }), 3).y).toBe(0);
  });

  it('is the same input with the flag absent as with it false', () => {
    expect(travel(forward(), 10)).toEqual(travel(forward({ downed: false }), 10));
  });
});

