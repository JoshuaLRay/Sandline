/**
 * T-1.18. The two cases the plan names are `compensated shots` below: a client
 * at 150 ms latency hits a moving target it could not have hit uncompensated,
 * and a client claiming five seconds of latency is clamped.
 *
 * Constants are declared here rather than read from movement or weapon data, so
 * that tuning either can never quietly change what this proves.
 */
import { describe, expect, it } from 'vitest';
import { type WorldBox, boxFrom } from '@sandline/shared';
import {
  DEFAULT_HITBOX,
  HitboxHistory,
  type Hitbox,
  MAX_REWIND_MS,
  type Ray,
  bodyParts,
  clampRewindMs,
  rayCapsule,
  raySegmentCapsule,
  resolveShot,
} from './lagComp.ts';

const TICK_MS = 1000 / 30;
/** Sprint speed at the time of writing; declared, not imported. */
const TARGET_SPEED = 6.8;
const BOX: Hitbox = { radius: 0.35, halfHeight: 0.55, centerOffsetY: 0.9 };
const SHOOTER = 1;
const TARGET = 2;
/** These tests are about rewinding; the scenery is tested on its own below. */
const NO_WORLD: WorldBox[] = [];

/**
 * A target running along +X, crossing in front of a shooter who stands at the
 * origin looking down +Z. Records from t = 0 to `untilMs` at the tick rate.
 */
function crossingTarget(untilMs: number, crossAtMs: number): HitboxHistory {
  const history = new HitboxHistory();
  for (let t = 0; t <= untilMs; t += TICK_MS) {
    history.record(TARGET, t, (t - crossAtMs) / 1000 * TARGET_SPEED, 0, 10);
    history.record(SHOOTER, t, 0, 0, 0);
  }
  return history;
}

/** Fired from the shooter's chest, straight down +Z. */
const STRAIGHT: Ray = {
  origin: { x: 0, y: BOX.centerOffsetY, z: 0 },
  direction: { x: 0, y: 0, z: 1 },
  maxDistance: 100,
};

describe('rewind clamping', () => {
  it('passes through a plausible latency', () => {
    expect(clampRewindMs(1000, 850)).toBeCloseTo(150, 10);
  });

  it('clamps a client claiming five seconds of latency', () => {
    expect(clampRewindMs(5000, 0)).toBe(MAX_REWIND_MS);
  });

  it('refuses to rewind into the future, or on nonsense', () => {
    expect(clampRewindMs(1000, 1200)).toBe(0);
    expect(clampRewindMs(1000, NaN)).toBe(0);
  });
});

describe('hitbox history', () => {
  it('interpolates between recorded samples', () => {
    const history = new HitboxHistory();
    history.record(TARGET, 0, 0, 0, 0);
    history.record(TARGET, 100, 10, 0, 0);
    expect(history.positionAt(TARGET, 50)?.x).toBeCloseTo(5, 10);
    expect(history.positionAt(TARGET, 25)?.x).toBeCloseTo(2.5, 10);
  });

  it('clamps to the newest sample rather than extrapolating forward', () => {
    const history = new HitboxHistory();
    history.record(TARGET, 0, 0, 0, 0);
    history.record(TARGET, 100, 10, 0, 0);
    expect(history.positionAt(TARGET, 5000)?.x).toBe(10);
  });

  it('forgets samples older than the window, and clamps to the oldest kept', () => {
    const history = new HitboxHistory(200);
    for (let t = 0; t <= 1000; t += TICK_MS) history.record(TARGET, t, t / 100, 0, 0);
    const ancient = history.positionAt(TARGET, 0);
    // The 0 ms sample is long gone; it clamps to the edge of the window, not to 0.
    expect(ancient?.x).toBeGreaterThan(7);
  });

  it('returns null for an entity it has never seen, and after forgetting', () => {
    const history = new HitboxHistory();
    expect(history.positionAt(99, 0)).toBeNull();
    history.record(TARGET, 0, 1, 2, 3);
    expect(history.positionAt(TARGET, 0)).not.toBeNull();
    history.forget(TARGET);
    expect(history.positionAt(TARGET, 0)).toBeNull();
  });

  it('survives many more samples than its capacity, keeping the newest', () => {
    const history = new HitboxHistory(500, 8);
    let last = 0;
    for (let t = 0; t <= 1000; t += TICK_MS) {
      history.record(TARGET, t, t, 0, 0);
      last = t;
    }
    // Ring wrapped roughly four times; the newest sample is still the newest.
    expect(history.currentPosition(TARGET)?.x).toBe(last);
    // ...and the samples the ring dropped are gone, so an old time clamps.
    expect(history.positionAt(TARGET, 0)?.x).toBeGreaterThan(last - 8 * TICK_MS);
  });
});

describe('ray against a capsule', () => {
  const center = { x: 0, y: 1, z: 10 };

  it('hits through the body', () => {
    const d = rayCapsule({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, center, 0.35, 0.55);
    expect(d).toBeCloseTo(10 - 0.35, 6);
  });

  it('misses beside it', () => {
    const d = rayCapsule({ origin: { x: 1.2, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, center, 0.35, 0.55);
    expect(d).toBeNull();
  });

  it('hits the rounded cap above the cylinder', () => {
    const d = rayCapsule({ origin: { x: 0, y: 1.72, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, center, 0.35, 0.55);
    expect(d).not.toBeNull();
    // Above the cap centre, so it must be short of the cylinder's front face.
    expect(d as number).toBeGreaterThan(10 - 0.35);
  });

  it('misses above the cap entirely', () => {
    const d = rayCapsule({ origin: { x: 0, y: 2.1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, center, 0.35, 0.55);
    expect(d).toBeNull();
  });

  it('ignores a capsule behind the ray, and one past max distance', () => {
    expect(rayCapsule({ origin: { x: 0, y: 1, z: 20 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, center, 0.35, 0.55)).toBeNull();
    expect(rayCapsule({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 5 }, center, 0.35, 0.55)).toBeNull();
  });
});


describe('crouched hit volume (T-2.20)', () => {
  const CROUCH_BOX: Hitbox = {
    ...BOX,
    crouchHalfHeight: 0.25,
    crouchCenterOffsetY: 0.6,
  };

  it('rewinds the crouched state and uses the shorter capsule', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 0);
    history.record(TARGET, 0, 0, 0, 10, true);

    const low = resolveShot(
      history,
      {
        shooterNetId: SHOOTER,
        ray: { origin: { x: 0, y: 0.9, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 },
        nowMs: 0,
        clientRenderTimeMs: 0,
      },
      CROUCH_BOX,
      NO_WORLD,
    );
    expect(low?.netId).toBe(TARGET);

    const high = resolveShot(
      history,
      {
        shooterNetId: SHOOTER,
        ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 },
        nowMs: 0,
        clientRenderTimeMs: 0,
      },
      CROUCH_BOX,
      NO_WORLD,
    );
    expect(high).toBeNull();
  });

  it('keeps standing geometry when the history says standing', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 0);
    history.record(TARGET, 0, 0, 0, 10, false);
    const hit = resolveShot(
      history,
      {
        shooterNetId: SHOOTER,
        ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 },
        nowMs: 0,
        clientRenderTimeMs: 0,
      },
      CROUCH_BOX,
      NO_WORLD,
    );
    expect(hit?.netId).toBe(TARGET);
  });

  it('changes crouch state at the authoritative history sample', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 0, false);
    history.record(TARGET, 0, 0, 0, 10, false);
    history.record(TARGET, 100, 0, 0, 10, true);

    expect(history.stateAt(TARGET, 99)?.crouched).toBe(false);
    expect(history.stateAt(TARGET, 100)?.crouched).toBe(true);
  });
});

describe('prone hit volume (T-2.40, ADR-016)', () => {
  const STANCE_BOX: Hitbox = {
    ...BOX,
    crouchHalfHeight: 0.25,
    crouchCenterOffsetY: 0.6,
    proneHalfHeight: 0.05,
    proneCenterOffsetY: 0.4,
  };

  it('is lower again than crouch: a shot that clears crouch also clears prone', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 0);
    history.record(TARGET, 0, 0, 0, 10, false, true);

    const atCrouchHeight = resolveShot(
      history,
      {
        shooterNetId: SHOOTER,
        ray: { origin: { x: 0, y: 0.85, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 },
        nowMs: 0,
        clientRenderTimeMs: 0,
      },
      STANCE_BOX,
      NO_WORLD,
    );
    // A shot at the top of the crouch capsule (0.6 + 0.25 = 0.85) sails clean
    // over the shorter prone one (0.4 + 0.05 = 0.45).
    expect(atCrouchHeight).toBeNull();

    const atProneHeight = resolveShot(
      history,
      {
        shooterNetId: SHOOTER,
        ray: { origin: { x: 0, y: 0.42, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 },
        nowMs: 0,
        clientRenderTimeMs: 0,
      },
      STANCE_BOX,
      NO_WORLD,
    );
    expect(atProneHeight?.netId).toBe(TARGET);
  });

  it('prone beats crouch when a sample somehow carries both', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 0);
    history.record(TARGET, 0, 0, 0, 10, true, true);

    const atCrouchHeight = resolveShot(
      history,
      {
        shooterNetId: SHOOTER,
        ray: { origin: { x: 0, y: 0.85, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 },
        nowMs: 0,
        clientRenderTimeMs: 0,
      },
      STANCE_BOX,
      NO_WORLD,
    );
    expect(atCrouchHeight).toBeNull();
  });

  it('replicates prone at the authoritative history sample, distinct from crouched', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 0, false, false);
    history.record(TARGET, 0, 0, 0, 10, false, false);
    history.record(TARGET, 100, 0, 0, 10, false, true);

    expect(history.stateAt(TARGET, 99)?.prone).toBe(false);
    expect(history.stateAt(TARGET, 99)?.crouched).toBe(false);
    expect(history.stateAt(TARGET, 100)?.prone).toBe(true);
    expect(history.stateAt(TARGET, 100)?.crouched).toBe(false);
  });
});

describe('compensated shots', () => {
  /**
   * The case T-1.18 exists for. The client is 150 ms behind: it renders the
   * target crossing the centre line and fires. By the time the server resolves
   * the shot the target has run 6.8 * 0.15 = 1.02 m, three capsule radii clear
   * of the ray.
   */
  const NOW = 1000;
  const LATENCY_MS = 150;

  it('registers a hit that would have missed without compensation', () => {
    const history = crossingTarget(NOW, NOW - LATENCY_MS);

    const uncompensated = resolveShot(
      history,
      { shooterNetId: SHOOTER, ray: STRAIGHT, nowMs: NOW, clientRenderTimeMs: NOW },
      BOX,
      NO_WORLD,
    );
    expect(uncompensated).toBeNull();

    const compensated = resolveShot(
      history,
      { shooterNetId: SHOOTER, ray: STRAIGHT, nowMs: NOW, clientRenderTimeMs: NOW - LATENCY_MS },
      BOX,
      NO_WORLD,
    );
    expect(compensated).not.toBeNull();
    expect(compensated?.netId).toBe(TARGET);
    expect(compensated?.rewindMs).toBeCloseTo(LATENCY_MS, 6);
    expect(compensated?.distance).toBeCloseTo(10 - BOX.radius, 2);
  });

  it('clamps a client claiming five seconds of latency', () => {
    // The target crossed 3 s ago. Honouring the claim would hit; the cap means
    // the rewind stops 200 ms back, where the target is long gone.
    const history = crossingTarget(NOW, NOW - 3000);
    const shot = resolveShot(
      history,
      { shooterNetId: SHOOTER, ray: STRAIGHT, nowMs: NOW, clientRenderTimeMs: NOW - 5000 },
      BOX,
      NO_WORLD,
    );
    expect(shot).toBeNull();
  });

  it('caps the rewind it reports at MAX_REWIND_MS', () => {
    const history = crossingTarget(NOW, NOW - MAX_REWIND_MS);
    const shot = resolveShot(
      history,
      { shooterNetId: SHOOTER, ray: STRAIGHT, nowMs: NOW, clientRenderTimeMs: NOW - 5000 },
      BOX,
      NO_WORLD,
    );
    expect(shot?.rewindMs).toBe(MAX_REWIND_MS);
    expect(shot?.rewoundTo).toBe(NOW - MAX_REWIND_MS);
  });

  it('never shoots the shooter', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 10);
    const shot = resolveShot(
      history,
      { shooterNetId: SHOOTER, ray: STRAIGHT, nowMs: 0, clientRenderTimeMs: 0 },
      BOX,
      NO_WORLD,
    );
    expect(shot).toBeNull();
  });

  it('returns the nearest of several targets', () => {
    const history = new HitboxHistory();
    history.record(SHOOTER, 0, 0, 0, 0);
    history.record(TARGET, 0, 0, 0, 20);
    history.record(3, 0, 0, 0, 8);
    const shot = resolveShot(
      history,
      { shooterNetId: SHOOTER, ray: STRAIGHT, nowMs: 0, clientRenderTimeMs: 0 },
      BOX,
      NO_WORLD,
    );
    expect(shot?.netId).toBe(3);
  });

  it('reports an impact point on the ray at the reported distance', () => {
    const history = crossingTarget(NOW, NOW);
    const shot = resolveShot(
      history,
      { shooterNetId: SHOOTER, ray: STRAIGHT, nowMs: NOW, clientRenderTimeMs: NOW },
      BOX,
      NO_WORLD,
    );
    expect(shot).not.toBeNull();
    expect(shot?.point.z).toBeCloseTo(shot?.distance as number, 10);
    expect(shot?.point.x).toBeCloseTo(0, 10);
  });
});

describe('scenery stops a shot (T-1.12)', () => {
  const NOW = 1000;
  /** A target standing still at z = 10, the shooter at the origin. */
  function standing(): HitboxHistory {
    const history = new HitboxHistory();
    for (let t = 0; t <= NOW; t += TICK_MS) {
      history.record(TARGET, t, 0, 0, 10);
      history.record(SHOOTER, t, 0, 0, 0);
    }
    return history;
  }
  const ray: Ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 };
  const query = { shooterNetId: SHOOTER, ray, nowMs: NOW, clientRenderTimeMs: NOW };

  it('a wall between shooter and target takes the shot, reported as netId 0 at the wall', () => {
    const wall = [boxFrom({ id: 'wall', x: 0, y: 0, z: 5, w: 4, h: 2.4, d: 0.3 }, 'cover')];
    const hit = resolveShot(standing(), query, BOX, wall);
    expect(hit?.netId).toBe(0);
    expect(hit?.distance).toBeCloseTo(4.85, 9);
    expect(hit?.point.z).toBeCloseTo(4.85, 9);
  });

  it('a wall behind the target changes nothing', () => {
    const wall = [boxFrom({ id: 'wall', x: 0, y: 0, z: 15, w: 4, h: 2.4, d: 0.3 }, 'cover')];
    const hit = resolveShot(standing(), query, BOX, wall);
    expect(hit?.netId).toBe(TARGET);
  });

  it('a low wall the ray passes over changes nothing', () => {
    const low = [boxFrom({ id: 'low', x: 0, y: 0, z: 5, w: 4, h: 0.9, d: 0.3 }, 'cover')];
    const hit = resolveShot(standing(), query, BOX, low);
    expect(hit?.netId).toBe(TARGET);
  });

  it('a shot into empty scenery is still a scenery hit, not a miss to max range', () => {
    const wall = [boxFrom({ id: 'wall', x: 0, y: 0, z: 30, w: 4, h: 2.4, d: 0.3 }, 'cover')];
    const hit = resolveShot(new HitboxHistory(), query, BOX, wall);
    expect(hit?.netId).toBe(0);
    expect(hit?.distance).toBeCloseTo(29.85, 9);
  });
});

describe('the body is where the model is, in every stance', () => {
  const NOW = 1000;
  /** Wire yaw: a quarter turn faces +X. */
  const QUARTER = 256;
  const lying = (lie: 'downed' | 'dead' | null, prone: boolean, yaw: number) => {
    const history = new HitboxHistory();
    history.record(TARGET, NOW, 0, 0, 10, false, prone, { yaw, lying: lie });
    return history;
  };
  const shotAt = (history: HitboxHistory, y: number, x = 0) =>
    resolveShot(history, { shooterNetId: SHOOTER, ray: { origin: { x, y, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, nowMs: NOW, clientRenderTimeMs: NOW }, DEFAULT_HITBOX, NO_WORLD);

  it('traces a capsule along any segment, not only an upright one', () => {
    // Lying along X at 0.3 m up, 1 m long, radius 0.2, 5 m out.
    const a = { x: -0.5, y: 0.3, z: 5 };
    const b = { x: 0.5, y: 0.3, z: 5 };
    const ray = (x: number, y: number): Ray => ({ origin: { x, y, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 });
    expect(raySegmentCapsule(ray(0, 0.3), a, b, 0.2)).toBeCloseTo(4.8, 9);
    expect(raySegmentCapsule(ray(0.6, 0.3), a, b, 0.2)).toBeCloseTo(5 - Math.sqrt(0.04 - 0.01), 9); // the cap
    expect(raySegmentCapsule(ray(0, 0.6), a, b, 0.2)).toBeNull(); // over it
    expect(raySegmentCapsule(ray(0.8, 0.3), a, b, 0.2)).toBeNull(); // past the end
    // A zero-length segment is a sphere.
    const centre = { x: 0, y: 0.3, z: 5 };
    expect(raySegmentCapsule(ray(0, 0.3), centre, centre, 0.2)).toBeCloseTo(4.8, 9);
    // And the upright case agrees with the old vertical capsule.
    const up = rayCapsule(ray(0, 1), { x: 0, y: 0.9, z: 5 }, 0.35, 0.55);
    expect(up).toBeCloseTo(4.65, 9);
  });

  for (const [name, lie, prone] of [['prone', null, true], ['downed', 'downed', false], ['dead', 'dead', false]] as const) {
    it(`a ${name} body lies on the ground: a chest-high shot goes over it, a low one hits`, () => {
      const history = lying(lie, prone, 0);
      expect(shotAt(history, 1.2)).toBeNull();
      const low = shotAt(history, 0.25);
      expect(low?.netId).toBe(TARGET);
      // Facing +Z, toward the shooter: the head is nearest, so it is what a low shot meets.
      expect(low?.distance).toBeLessThan(10);
    });

    it(`a ${name} body lies along its facing: long one way, narrow the other`, () => {
      // Facing +X, the body lies across the shot: hit well off its feet position.
      const across = lying(lie, prone, QUARTER);
      expect(shotAt(across, 0.25, 0.6)?.netId).toBe(TARGET);
      expect(shotAt(across, 0.25, -0.6)?.netId).toBe(TARGET);
      // Facing +Z, the same offsets are beside it.
      const along = lying(lie, prone, 0);
      expect(shotAt(along, 0.25, 0.75)).toBeNull();
    });
  }

  it('scores a lying head as a head, and the legs as limbs', () => {
    // Facing +X across the shot: feet toward -X, head toward +X.
    const across = lying('downed', false, QUARTER);
    const parts = bodyParts(DEFAULT_HITBOX, 'downed', { x: 0, y: 0, z: 10 }, QUARTER);
    const head = parts.find((p) => p.zone === 'head')!;
    expect(head.b.x).toBeGreaterThan(0.5);
    // The crown, past where the torso's capsule reaches.
    expect(shotAt(across, head.b.y, head.b.x)?.zone).toBe('head');
    expect(shotAt(across, 0.3, -0.6)?.zone).toBe('limb');
    expect(shotAt(across, 0.35, 0.2)?.zone).toBe('torso');
  });

  it('keeps the standing zones by height, and a crouch forward over its knees', () => {
    const history = new HitboxHistory();
    history.record(TARGET, NOW, 0, 0, 10, false, false, { yaw: 0 });
    expect(shotAt(history, 1.7)?.zone).toBe('head');
    expect(shotAt(history, 1.1)?.zone).toBe('torso');
    expect(shotAt(history, 0.4)?.zone).toBe('limb');
    const crouched = new HitboxHistory();
    crouched.record(TARGET, NOW, 0, 0, 10, true, false, { yaw: 0 });
    // The crouched head is under 1.5 m, and nothing of the body is at 1.6.
    expect(shotAt(crouched, 1.3)?.zone).toBe('head');
    expect(shotAt(crouched, 1.6)).toBeNull();
  });

  it('rewinds the facing and the fall with the position: a body is shot as it lay then', () => {
    const history = new HitboxHistory();
    history.record(TARGET, NOW - 100, 0, 0, 10, false, false, { yaw: 0 });
    history.record(TARGET, NOW, 0, 0, 10, false, false, { yaw: 0, lying: 'downed' });
    expect(history.stateAt(TARGET, NOW - 50)?.stance).toBe('standing');
    expect(history.stateAt(TARGET, NOW)?.stance).toBe('downed');
    expect(history.stateAt(TARGET, NOW)?.lying).toBe('downed');
  });
});
