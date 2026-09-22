import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, type MoveInput, type MoveState, createMoveState, stepCharacter } from './CharacterController.ts';
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

    // Taller than a step but no taller than a vault is now vaulted (T-2.21);
    // what blocks is a box taller than the vault height.
    const tall = [wall('crate', 0, 13, 6, cfg.vaultMaxHeight + 0.2, 20)];
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
    const crouched = walk({ x: 0, z: 0 }, input({ moveY: 1, crouch: true }), 60, lowCeiling);
    const standing = walk({ x: 0, z: 0 }, input({ moveY: 1 }), 60, lowCeiling);
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
    // Releasing crouch under a 1.3 m ceiling must not switch the authoritative
    // stance or hit volume to the 1.8 m standing height.
    expect(standing.crouched).toBe(true);

    // Once clear of the ceiling, the same release is allowed to stand.
    let clear = standing;
    for (let i = 0; i < 120 && clear.crouched; i += 1) {
      clear = stepCharacter(clear, input({ moveY: 1 }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, lowCeiling);
    }
    expect(clear.crouched).toBe(false);
  });

  it('standing up while jumping under a ceiling clamps to the standing height, not the crouched one', () => {
    // Review 2026-09-20: the head-room clamp used the height the stance
    // entered the tick with, so releasing crouch and jumping under a ceiling
    // between 1.8 and 2.0 m lifted the feet 0.6 m for one tick.
    const ceiling = [wall('ceiling', 0, 0, 4, 0.3, 4, 1.9)];
    const crouched: MoveState = { ...createMoveState(0, 0, 0), crouched: true };
    const rose = stepCharacter(crouched, input({ crouch: false, jump: true }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, ceiling);
    const standing = stepCharacter(createMoveState(0, 0, 0), input({ jump: true }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, ceiling);
    expect(rose.crouched).toBe(false);
    expect(rose.y).toBe(standing.y);
    expect(rose.y).toBeCloseTo(1.9 - DEFAULT_MOVE_CONFIG.height, 9);
  });

  it('keeps downed geometry distinct from crouch', () => {
    const crouched = stepCharacter(createMoveState(0, 0, 0), input({ crouch: true, moveY: 1 }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, []);
    const downed = stepCharacter(createMoveState(0, 0, 0), input({ downed: true, moveY: 1 }), TICK_SECONDS, DEFAULT_MOVE_CONFIG, []);
    expect(crouched.y).toBe(0);
    expect(downed.y).toBe(0);
    expect(crouched.z).toBeGreaterThan(downed.z);
  });
});

describe('downed: immobile (T-2.13, B-05)', () => {
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

  it('cannot crawl: forward intent produces no movement, sprint included', () => {
    const ticks = 30;
    expect(travel(forward({ downed: true }), ticks).dz).toBe(0);
    expect(travel(forward({ downed: true, sprint: true }), ticks).dz).toBe(0);
    expect(travel(forward({ downed: true, moveX: 1 }), ticks).dz).toBe(0);
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


describe('vault (T-2.21)', () => {
  /** Own numbers, per the fixture rule: retuning the defaults cannot move these. */
  const CONFIG = {
    ...DEFAULT_MOVE_CONFIG,
    walkSpeed: 4.2,
    radius: 0.35,
    height: 1.8,
    stepHeight: 0.45,
    vaultMaxHeight: 1.25,
    vaultDistance: 1.5,
    vaultSeconds: 0.55,
    vaultProbe: 0.35,
    vaultLip: 0.15,
  };
  const hurdle = (h: number) => boxFrom({ id: 'hurdle', x: 0, y: 0, z: 3, w: 6, h, d: 0.4 }, 'cover');
  const forward = (over: Partial<MoveInput> = {}): MoveInput => input({ moveY: 1, ...over });

  /** Walk +Z from the origin for `ticks`; report when the vault began and where it ended. */
  function walk(world: WorldBox[], ticks: number, inp: (t: number) => MoveInput = () => forward(), dt = TICK_SECONDS) {
    let s = createMoveState(0, 0, 0);
    let startedAt = -1;
    let peakY = 0;
    let landedAt = -1;
    for (let t = 0; t < ticks; t += 1) {
      const wasVaulting = !!s.vault;
      s = stepCharacter(s, inp(t), dt, CONFIG, world);
      if (s.vault && startedAt < 0) startedAt = t;
      if (s.vault) peakY = Math.max(peakY, s.y);
      if (wasVaulting && !s.vault && landedAt < 0) landedAt = t;
    }
    return { s, startedAt, peakY, landedAt };
  }

  it('vaults a hurdle too tall to step, clearing its top and landing grounded beyond it', () => {
    const world = [hurdle(0.9)];
    const r = walk(world, 60);
    expect(r.startedAt).toBeGreaterThanOrEqual(0);
    expect(r.landedAt).toBeGreaterThan(r.startedAt);
    // Lands on the tick real time reaches vaultSeconds, not a tick sooner or later.
    expect(r.landedAt - r.startedAt).toBe(Math.ceil(CONFIG.vaultSeconds / TICK_SECONDS) - 1);
    // Over the top with the lip to spare, then down on the far side.
    expect(r.peakY).toBeGreaterThan(0.9);
    expect(r.s.vault).toBeNull();
    expect(r.s.grounded).toBe(true);
    expect(r.s.z).toBeGreaterThan(3.2); // past the hurdle's far face (z 3.2)
    expect(r.s.y).toBe(0);
  });

  it('steps through a hurdle no taller than a step without vaulting', () => {
    const r = walk([hurdle(0.4)], 60);
    expect(r.startedAt).toBe(-1);
    expect(r.s.z).toBeGreaterThan(3.2);
  });

  it('refuses a hurdle taller than the vault height, and stops at it like a wall', () => {
    const r = walk([hurdle(1.5)], 60);
    expect(r.startedAt).toBe(-1);
    expect(r.s.z).toBeCloseTo(2.8 - CONFIG.radius, 9);
  });

  it('refuses when the landing is blocked', () => {
    // A wall right behind the hurdle: the landing footprint would sit in it.
    const wall = boxFrom({ id: 'wall', x: 0, y: 0, z: 3.7, w: 6, h: 2.4, d: 0.4 }, 'cover');
    const r = walk([hurdle(0.9), wall], 60);
    expect(r.startedAt).toBe(-1);
    expect(r.s.z).toBeLessThan(2.8);
  });

  it('needs forward intent: strafing, backing off, or standing still never vaults', () => {
    const world = [hurdle(0.9)];
    // Walk up to it, then stop pushing: the last ticks have no intent.
    let s = createMoveState(0, 0, 2.2);
    for (let t = 0; t < 30; t += 1) s = stepCharacter(s, input({ moveX: 1 }), TICK_SECONDS, CONFIG, world);
    expect(s.vault ?? null).toBeNull();
    for (let t = 0; t < 30; t += 1) s = stepCharacter(s, input({ moveY: -1 }), TICK_SECONDS, CONFIG, world);
    expect(s.vault ?? null).toBeNull();
    for (let t = 0; t < 30; t += 1) s = stepCharacter(s, input(), TICK_SECONDS, CONFIG, world);
    expect(s.vault ?? null).toBeNull();
    // A diagonal with the strafe dominant is not forward intent either.
    for (let t = 0; t < 30; t += 1) s = stepCharacter(s, input({ moveX: 1, moveY: 0.4 }), TICK_SECONDS, CONFIG, world);
    expect(s.vault ?? null).toBeNull();
  });

  it('never starts while crouched, downed, firing, jumping or airborne', () => {
    const world = [hurdle(0.9)];
    for (const over of [{ crouch: true }, { downed: true }, { firing: true }, { jump: true }] as Partial<MoveInput>[]) {
      const r = walk(world, 60, () => forward(over));
      expect(r.startedAt, JSON.stringify(over)).toBe(-1);
    }
    // Airborne: jump just before the hurdle, then hold forward in the air.
    const r = walk(world, 60, (t) => forward({ jump: t === 8 }));
    let s = createMoveState(0, 0, 0);
    let vaultedWhileAirborne = false;
    for (let t = 0; t < 60; t += 1) {
      const airborne = !s.grounded;
      s = stepCharacter(s, forward({ jump: t === 8 }), TICK_SECONDS, CONFIG, world);
      if (airborne && s.vault && s.vault.elapsed <= TICK_SECONDS + 1e-9) vaultedWhileAirborne = true;
    }
    expect(vaultedWhileAirborne).toBe(false);
    expect(r.s.vault ?? null).toBeNull();
  });

  it('ignores every input once under way: strafing mid-vault does not bend the path', () => {
    const world = [hurdle(0.9)];
    const straight = walk(world, 60);
    // Everything a player could mash, from the tick after the vault begins.
    const mash = (t: number): MoveInput => (t > straight.startedAt ? forward({ moveX: 1, jump: true, crouch: true }) : forward());
    const bent = walk(world, 60, mash);
    expect(bent.startedAt).toBe(straight.startedAt);
    // Same landing tick, same X (no strafe took), same Z.
    expect(bent.landedAt).toBe(straight.landedAt);
    let a = createMoveState(0, 0, 0);
    let b = createMoveState(0, 0, 0);
    for (let t = 0; t <= straight.landedAt; t += 1) {
      a = stepCharacter(a, forward(), TICK_SECONDS, CONFIG, world);
      b = stepCharacter(b, mash(t), TICK_SECONDS, CONFIG, world);
    }
    expect(b.x).toBe(a.x);
    expect(b.z).toBe(a.z);
    expect(b.y).toBe(a.y);
  });

  it('traces the same traversal at 30 and 120 Hz, and lands at the same moment', () => {
    const world = [hurdle(0.9)];
    // Start from the same pre-vault state so only the vault is compared.
    let pre = createMoveState(0, 0, 0);
    while (!pre.vault) pre = stepCharacter(pre, forward(), TICK_SECONDS, CONFIG, world);
    const start: MoveState = { ...pre, vault: { ...(pre.vault as NonNullable<typeof pre.vault>), elapsed: 0 } };
    const at = (dt: number, seconds: number) => {
      let s = start;
      for (let t = 0; t < Math.round(seconds / dt); t += 1) s = stepCharacter(s, forward(), dt, CONFIG, world);
      return s;
    };
    const mid30 = at(1 / 30, 0.3);
    const mid120 = at(1 / 120, 0.3);
    expect(Math.abs(mid30.x - mid120.x)).toBeLessThan(1e-9);
    expect(Math.abs(mid30.y - mid120.y)).toBeLessThan(1e-9);
    expect(Math.abs(mid30.z - mid120.z)).toBeLessThan(1e-9);
    // Landing: the same place, at the same moment to within one 30 Hz tick.
    const land = (dt: number) => {
      let s = start;
      let steps = 0;
      while (s.vault) {
        s = stepCharacter(s, forward(), dt, CONFIG, world);
        steps += 1;
      }
      return { s, seconds: steps * dt };
    };
    const land30 = land(1 / 30);
    const land120 = land(1 / 120);
    expect(land30.s.x).toBe(land120.s.x);
    expect(land30.s.y).toBe(land120.s.y);
    expect(land30.s.z).toBe(land120.s.z);
    expect(land30.s.grounded && land120.s.grounded).toBe(true);
    expect(Math.abs(land30.seconds - land120.seconds)).toBeLessThan(1 / 30);
    expect(land120.seconds).toBeCloseTo(CONFIG.vaultSeconds, 9);
  });

  it('a vault handed to a fresh step mid-way continues exactly (what a reconcile relies on)', () => {
    const world = [hurdle(0.9)];
    let s = createMoveState(0, 0, 0);
    while (!s.vault || s.vault.elapsed < 0.2) s = stepCharacter(s, forward(), TICK_SECONDS, CONFIG, world);
    // Rebuild the state from its numbers only, as a snapshot would deliver it.
    const handed: MoveState = { x: s.x, y: s.y, z: s.z, vy: 0, grounded: false, crouched: false, vault: { ...(s.vault as NonNullable<typeof s.vault>) } };
    let a: MoveState = s;
    let b: MoveState = handed;
    // Through the rest of the vault (the handed copy is fed a different,
    // ignored input), and one ordinary tick beyond the landing.
    while (a.vault) {
      a = stepCharacter(a, forward(), TICK_SECONDS, CONFIG, world);
      b = stepCharacter(b, forward({ moveX: -1 }), TICK_SECONDS, CONFIG, world);
      expect(b).toEqual(a);
    }
    a = stepCharacter(a, forward(), TICK_SECONDS, CONFIG, world);
    b = stepCharacter(b, forward(), TICK_SECONDS, CONFIG, world);
    expect(b).toEqual(a);
  });
});
