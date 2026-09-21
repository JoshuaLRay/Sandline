/**
 * T-2.30: the arcs, the bounces, the fuse and the blast.
 *
 * Fixture worlds, never `DEFAULT_WORLD`, and fixture definitions rather than
 * `projectiles.json` wherever a number is being asserted on — R10 and §2.3:
 * tuning a grenade must never be able to break a test about how grenades work.
 * The shipped table gets exactly one test, that it parses.
 */
import { describe, expect, it } from 'vitest';
import { ANGLE_QUARTER } from '../math/angles.ts';
import {
  BLAST_PROBE_FRACTIONS,
  PROJECTILES,
  PROJECTILE_IDS,
  type ProjectileDef,
  type ProjectileState,
  type ProjectileWorld,
  blastDamageAt,
  blastDamageOn,
  blastExposure,
  createProjectileState,
  getProjectile,
  launchOrigin,
  launchVelocity,
  parseProjectileTable,
  projectileArc,
  projectileByIndex,
  stepProjectile,
} from './ballistics.ts';
import { boxFrom, rayWorld } from './world.ts';

const TICK = 1 / 30;

/** A grenade with round numbers, so an assertion can be read off the data. */
const GRENADE: ProjectileDef = {
  id: 'test-grenade',
  name: 'Test Grenade',
  kind: 'thrown',
  speedMPerSec: 16,
  loftDeg: 0,
  gravity: 10,
  dragPerSec: 0,
  radiusM: 0.1,
  restitution: 0.5,
  friction: 0.4,
  rollDragPerSec: 0.5,
  fuseSeconds: 2,
  detonateOnImpact: false,
  maxLifeSeconds: 8,
  blastRadiusM: 6,
  blastDamage: 100,
  blastMinFraction: 0.2,
  blastCoverFraction: 0.25,
  carried: 3,
  cooldownSeconds: 1,
};

const ROCKET: ProjectileDef = {
  ...GRENADE,
  id: 'test-rocket',
  name: 'Test Rocket',
  kind: 'rocket',
  speedMPerSec: 45,
  gravity: 0,
  restitution: 0,
  friction: 0,
  fuseSeconds: 0,
  detonateOnImpact: true,
  maxLifeSeconds: 2,
};

/** The same grenade with a fuse too long to end a test about bouncing. */
const INERT: ProjectileDef = { ...GRENADE, fuseSeconds: 20, maxLifeSeconds: 30 };

/** Flat ground at y = 0 and nothing else. */
const OPEN: ProjectileWorld = { boxes: [], groundY: 0 };

/** Ground far below, so a test about air is only about air. */
const SKY: ProjectileWorld = { boxes: [], groundY: -1000 };

const wall = (id: string, x: number, width = 0.05) =>
  boxFrom({ id, x, y: 0, z: 0, w: width, h: 4, d: 8 }, 'cover');

const crate = (id: string, x: number, z: number, h = 1) =>
  boxFrom({ id, x, y: 0, z, w: 1.2, h, d: 1.2 }, 'cover');

function run(
  def: ProjectileDef,
  state: ProjectileState,
  world: ProjectileWorld,
  seconds: number,
): { state: ProjectileState; detonation: { point: { x: number; y: number; z: number }; reason: string } | null; steps: number } {
  let current = state;
  const total = Math.round(seconds / TICK);
  for (let i = 0; i < total; i += 1) {
    const step = stepProjectile(def, current, TICK, world);
    current = step.state;
    if (step.detonation) return { state: current, detonation: step.detonation, steps: i + 1 };
  }
  return { state: current, detonation: null, steps: total };
}

describe('projectile data (T-2.30)', () => {
  it('ships a table that parses, with every wire id present', () => {
    expect(() => parseProjectileTable(PROJECTILES)).not.toThrow();
    for (const id of PROJECTILE_IDS) expect(getProjectile(id).id).toBe(id);
    expect(projectileByIndex(0)?.id).toBe(PROJECTILE_IDS[0]);
    expect(projectileByIndex(PROJECTILE_IDS.length)).toBeNull();
  });

  it('names the offending row when the data is wrong', () => {
    expect(() => parseProjectileTable({ frag: { ...PROJECTILES['frag'], restitution: 4 } })).toThrow(/frag.*restitution/);
    expect(() =>
      parseProjectileTable({ frag: { ...PROJECTILES['frag'], fuseSeconds: 0, detonateOnImpact: false } }),
    ).toThrow(/old age/);
  });
});

describe('launch (T-2.30)', () => {
  it('leaves at the definition\'s speed along the aim', () => {
    const v = launchVelocity(GRENADE, 0, 0);
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    expect(speed).toBeCloseTo(GRENADE.speedMPerSec, 6);
    // Yaw 0 is +Z forward, as every other direction in this package is.
    expect(v.z).toBeCloseTo(GRENADE.speedMPerSec, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it('lofts a level aim upward, and aims where it is pointed', () => {
    const lofted = launchVelocity({ ...GRENADE, loftDeg: 15 }, 0, 0);
    expect(lofted.y).toBeGreaterThan(0);
    // A quarter turn of yaw faces +X.
    const sideways = launchVelocity(GRENADE, ANGLE_QUARTER, 0);
    expect(sideways.x).toBeCloseTo(GRENADE.speedMPerSec, 6);
    expect(sideways.z).toBeCloseTo(0, 6);
  });
});

describe('where it leaves the hand (T-2.30)', () => {
  it('is ahead of the eye along the aim', () => {
    const origin = launchOrigin(GRENADE, { x: 0, y: 1.55, z: 0 }, { x: 0, y: 0, z: 1 }, 0.5, OPEN);
    expect(origin).toEqual({ x: 0, y: 1.55, z: 0.5 });
  });

  it('stops at a wall the thrower is standing against, rather than inside it', () => {
    const world: ProjectileWorld = { boxes: [wall('wall', 0.3, 0.2)], groundY: 0 };
    const origin = launchOrigin(GRENADE, { x: 0, y: 1.55, z: 0 }, { x: 1, y: 0, z: 0 }, 0.5, world);
    // The wall's near face is at 0.2; the sphere stops a radius short of it.
    expect(origin.x).toBeCloseTo(0.2 - GRENADE.radiusM, 6);
  });

  it('never starts below the floor', () => {
    const origin = launchOrigin(GRENADE, { x: 0, y: 0.05, z: 0 }, { x: 0, y: -1, z: 0 }, 0.5, OPEN);
    expect(origin.y).toBeCloseTo(GRENADE.radiusM, 6);
  });
});

describe('flight (T-2.30)', () => {
  it('follows the closed-form parabola in clear air', () => {
    const origin = { x: 0, y: 1.5, z: 0 };
    const velocity = { x: 0, y: 6, z: 12 };
    const { state } = run(GRENADE, createProjectileState(origin, velocity), SKY, 1);
    const t = Math.round(1 / TICK) * TICK;
    expect(state.z).toBeCloseTo(origin.z + velocity.z * t, 6);
    expect(state.y).toBeCloseTo(origin.y + velocity.y * t - 0.5 * GRENADE.gravity * t * t, 6);
    expect(state.bounces).toBe(0);
  });

  it('is bit-identical on a re-run — nothing in here reads a clock or a random', () => {
    const start = () => createProjectileState({ x: 0.3, y: 1.6, z: -0.2 }, { x: 1.1, y: 4.2, z: 9.3 });
    const world: ProjectileWorld = { boxes: [crate('crate', 0.8, 4), wall('wall', 6)], groundY: 0 };
    const a = run(GRENADE, start(), world, 2.5).state;
    const b = run(GRENADE, start(), world, 2.5).state;
    for (const key of Object.keys(a) as (keyof ProjectileState)[]) {
      expect(Object.is(a[key], b[key])).toBe(true);
    }
  });

  it('sweeps rather than samples: a rocket cannot pass through a thin wall', () => {
    const thin: ProjectileWorld = { boxes: [wall('sheet', 12, 0.02)], groundY: -1000 };
    // 45 m/s covers 1.5 m per tick; the wall is 2 cm thick and 12 m away.
    const { detonation } = run(ROCKET, createProjectileState({ x: 0, y: 1.5, z: 0 }, launchVelocity(ROCKET, ANGLE_QUARTER, 0)), thin, 1);
    expect(detonation?.reason).toBe('impact');
    expect(detonation?.point.x).toBeCloseTo(12 - 0.01, 2);
  });
});

describe('bounces (T-2.30)', () => {
  it('gives back the restitution\'s share of the approach speed', () => {
    const state = createProjectileState({ x: 0, y: GRENADE.radiusM + 0.001, z: 0 }, { x: 0, y: -8, z: 0 });
    const step = stepProjectile(GRENADE, state, TICK, OPEN);
    expect(step.impact?.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(step.impact?.box).toBeNull();
    // Approach is 8 m/s plus the gravity of the sliver of tick before contact.
    expect(step.state.vy).toBeGreaterThan(8 * GRENADE.restitution * 0.9);
    expect(step.state.vy).toBeLessThan(8 * GRENADE.restitution * 1.1);
    expect(step.state.bounces).toBe(1);
  });

  it('bounces off a wall by reversing the axis it struck', () => {
    const world: ProjectileWorld = { boxes: [wall('wall', 4)], groundY: -1000 };
    const state = createProjectileState({ x: 0, y: 1.5, z: 0 }, { x: 12, y: 0, z: 0 });
    const { state: after } = run(GRENADE, state, world, 0.6);
    expect(after.vx).toBeLessThan(0);
    expect(after.x).toBeLessThan(4);
  });

  it('comes to rest on the ground, and stays exactly there', () => {
    const dropped = createProjectileState({ x: 2, y: 3, z: -1 }, { x: 0, y: 0, z: 0 });
    const { state } = run(INERT, dropped, OPEN, 3);
    expect(state.resting).toBe(true);
    expect(state.y).toBeCloseTo(INERT.radiusM, 2);
    const still = stepProjectile(INERT, state, TICK, OPEN);
    expect(still.state.x).toBe(state.x);
    expect(still.state.y).toBe(state.y);
    expect(still.state.z).toBe(state.z);
    expect(still.outcome).toBe('resting');
  });

  it('skids after landing instead of sticking where it touched down', () => {
    // Thrown hard and flat: the landing is a dead bounce, and the rest of the
    // throw has to carry it forward. This is the loop's worst case (see the
    // settle branch) — it used to stop dead the moment it touched.
    const state = createProjectileState({ x: 0, y: 0.5, z: 0 }, { x: 0, y: -1, z: 14 });
    let current = state;
    let landedAt: number | null = null;
    for (let i = 0; i < 45; i += 1) {
      const step = stepProjectile(INERT, current, TICK, OPEN);
      current = step.state;
      if (landedAt === null && step.impact !== null) landedAt = current.z;
    }
    expect(landedAt).not.toBeNull();
    expect(current.z - (landedAt as number)).toBeGreaterThan(1);
  });
});

describe('detonation (T-2.30)', () => {
  it('goes off on the fuse wherever it happens to be', () => {
    const { detonation, steps } = run(GRENADE, createProjectileState({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 3, z: 8 }), OPEN, 4);
    expect(detonation?.reason).toBe('fuse');
    expect(steps * TICK).toBeGreaterThanOrEqual(GRENADE.fuseSeconds);
    expect((steps - 1) * TICK).toBeLessThan(GRENADE.fuseSeconds);
  });

  it('goes off on the first surface when it is an impact fuse, at that surface', () => {
    const world: ProjectileWorld = { boxes: [wall('wall', 10)], groundY: -1000 };
    const { detonation } = run(ROCKET, createProjectileState({ x: 0, y: 1.5, z: 0 }, { x: 45, y: 0, z: 0 }), world, 1);
    expect(detonation?.reason).toBe('impact');
    // The surface point, not the sphere's centre: a decal goes on the wall.
    expect(detonation?.point.x).toBeCloseTo(10 - 0.025, 2);
  });

  it('dies of old age rather than flying forever', () => {
    const { detonation, steps } = run(ROCKET, createProjectileState({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 45 }), SKY, 4);
    expect(detonation?.reason).toBe('life');
    expect(steps * TICK).toBeGreaterThanOrEqual(ROCKET.maxLifeSeconds);
  });
});

describe('the arc a thrower is shown (T-2.30)', () => {
  it('is the same path the stepper walks, and ends where it goes off', () => {
    const origin = { x: 0, y: 1.55, z: 0 };
    const velocity = launchVelocity(GRENADE, 0, ANGLE_QUARTER / 8);
    const arc = projectileArc(GRENADE, origin, velocity, { dt: TICK, maxSeconds: 4, world: OPEN });
    expect(arc.detonation).not.toBeNull();
    const stepped = run(GRENADE, createProjectileState(origin, velocity), OPEN, 4);
    expect(arc.points[0]).toEqual(origin);
    const last = arc.points[arc.points.length - 1] as { x: number; y: number; z: number };
    expect(last.x).toBe(stepped.state.x);
    expect(last.y).toBe(stepped.state.y);
    expect(last.z).toBe(stepped.state.z);
  });

  it('stops at its horizon when nothing ends the flight', () => {
    const arc = projectileArc(ROCKET, { x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 45 }, { dt: TICK, maxSeconds: 0.5, world: SKY });
    expect(arc.detonation).toBeNull();
    expect(arc.seconds).toBeCloseTo(0.5, 6);
    expect(arc.points.length).toBe(Math.round(0.5 / TICK) + 1);
  });
});

describe('blast (T-2.30)', () => {
  it('falls off linearly from a flat core to the edge, and stops there', () => {
    expect(blastDamageAt(GRENADE, 0)).toBe(GRENADE.blastDamage);
    expect(blastDamageAt(GRENADE, GRENADE.blastRadiusM * 0.05)).toBe(GRENADE.blastDamage);
    expect(blastDamageAt(GRENADE, GRENADE.blastRadiusM)).toBe(0);
    expect(blastDamageAt(GRENADE, GRENADE.blastRadiusM + 1)).toBe(0);
    expect(blastDamageAt(GRENADE, GRENADE.blastRadiusM - 0.001)).toBeCloseTo(
      GRENADE.blastDamage * GRENADE.blastMinFraction,
      1,
    );
    let previous = Infinity;
    for (let d = 0; d < GRENADE.blastRadiusM; d += 0.25) {
      const here = blastDamageAt(GRENADE, d);
      expect(here).toBeLessThanOrEqual(previous);
      previous = here;
    }
  });

  it('sees all of a soldier in the open and none of one behind a wall', () => {
    const open = blastExposure({ x: 0, y: 1, z: 0 }, { x: 4, y: 0, z: 0 }, 1.8, []);
    expect(open).toBe(1);
    const blocked = blastExposure({ x: 0, y: 1, z: 0 }, { x: 4, y: 0, z: 0 }, 1.8, [wall('wall', 2, 0.4)]);
    expect(blocked).toBe(0);
  });

  it('sees the head of a soldier hugging a low crate and not the legs', () => {
    const exposure = blastExposure(
      { x: 0, y: 0.2, z: 0 },
      { x: 4, y: 0, z: 0 },
      1.8,
      [boxFrom({ id: 'low', x: 3.5, y: 0, z: 0, w: 0.4, h: 0.9, d: 4 }, 'cover')],
    );
    expect(exposure).toBeGreaterThan(0);
    expect(exposure).toBeLessThan(1);
    expect(exposure).toBeCloseTo(1 / BLAST_PROBE_FRACTIONS.length, 6);
  });

  it('gives cover its floor, and the open its full number', () => {
    const centre = { x: 0, y: 0.1, z: 0 };
    const feet = { x: 2, y: 0, z: 0 };
    const exposed = blastDamageOn(GRENADE, centre, feet, 1.8, []);
    const behind = blastDamageOn(GRENADE, centre, feet, 1.8, [wall('wall', 1, 0.4)]);
    expect(behind).toBeCloseTo(exposed * GRENADE.blastCoverFraction, 6);
    expect(blastDamageOn(GRENADE, centre, { x: 50, y: 0, z: 0 }, 1.8, [])).toBe(0);
  });
});

describe('rayWorld with a radius (T-2.30)', () => {
  it('reports the face it entered through', () => {
    const box = boxFrom({ id: 'box', x: 0, y: 0, z: 5, w: 2, h: 2, d: 2 }, 'cover');
    const front = rayWorld({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 10 }, [box]);
    expect(front?.normal).toEqual({ x: 0, y: 0, z: -1 });
    const above = rayWorld({ origin: { x: 0, y: 5, z: 5 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 10 }, [box]);
    expect(above?.normal).toEqual({ x: 0, y: 1, z: 0 });
    const side = rayWorld({ origin: { x: 5, y: 1, z: 5 }, direction: { x: -1, y: 0, z: 0 }, maxDistance: 10 }, [box]);
    expect(side?.normal).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('stops a sphere one radius short of the face', () => {
    const box = boxFrom({ id: 'box', x: 0, y: 0, z: 5, w: 2, h: 2, d: 2 }, 'cover');
    const ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 10 };
    const point = rayWorld(ray, [box]) as { distance: number };
    const sphere = rayWorld(ray, [box], 0.25) as { distance: number };
    expect(point.distance - sphere.distance).toBeCloseTo(0.25, 6);
  });

  it('a ray that starts inside has no entry face', () => {
    const box = boxFrom({ id: 'box', x: 0, y: 0, z: 0, w: 2, h: 2, d: 2 }, 'cover');
    const inside = rayWorld({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 10 }, [box]);
    expect(inside?.distance).toBe(0);
    expect(inside?.normal).toEqual({ x: 0, y: 0, z: 0 });
  });
});
