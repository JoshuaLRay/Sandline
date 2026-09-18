/**
 * Server-authoritative firing: T-1.17's cadence and T-1.18's rewind, wired into
 * the session and driven over the real wire.
 *
 * These go through encode/decode rather than calling `applyFire` directly, so
 * the Fire message layout and the PROTOCOL_VERSION bump are covered too — a
 * field written and read at different widths passes every unit test and
 * corrupts every shot.
 */
import { describe, expect, it } from 'vitest';
import {
  DAMAGE,
  type Message,
  PROTOCOL_VERSION,
  RANGE_TARGETS,
  SPAWN_POINTS,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  getWeapon,
  isRangeTarget,
} from '@sandline/shared';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
/**
 * Yaw that faces +X, i.e. straight down the line the six slots spawn on
 * (ADR-001: they exist from the start, spread along X at z = 0). Forward is
 * (sin yaw, cos yaw), so a quarter turn of the 1024-unit wire angle.
 */
const ALONG_THE_LINE = 256;

/** A client that handshakes, then sends raw messages and collects hit events. */
function connect(session: Session, now = 0) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, now);
  // The loopback queues rather than delivering inline, exactly as a real
  // transport does. Forgetting to pump it makes every message vanish silently.
  const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
  let netId = 0;
  /** What the player is currently holding, resent every tick. */
  let held = { moveX: 0, moveY: 0, yaw: 0, buttons: 0 };

  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'JoinAck') netId = msg.netId;
    if (msg.kind === 'HitEvent') hits.push(msg);
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'tester' }));
  pair.settle();

  return {
    hits,
    settle: () => pair.settle(),
    get netId() {
      return netId;
    },
    fire(overrides: Partial<Extract<Message, { kind: 'Fire' }>> = {}) {
      pair.b.send(
        encodeMessage({
          kind: 'Fire',
          tick: 0,
          yaw: 0,
          pitch: 0,
          renderTimeMs: 0,
          weapon: 0,
          ads: false,
          ...overrides,
        }),
      );
      pair.settle();
    },
    /**
     * Resend whatever is currently being held, once per tick.
     *
     * This is what a real client does — it samples input every tick, so holding
     * a key produces an identical input every tick rather than one and then
     * silence. Sending IDLE here instead would be worse than sending nothing:
     * it would arrive with a newer tick and supersede a deliberate input,
     * silently cancelling movement a test had just asked for.
     */
    keepAlive(tick: number) {
      pair.b.send(encodeMessage({ kind: 'Input', tick, ...held, pitch: 0 }));
      pair.settle();
    },
    /** Start holding an input. It keeps being sent until changed. */
    input(yaw: number, tick: number, moveX = 0, moveY = 0, buttons = 0) {
      held = { moveX, moveY, yaw, buttons };
      pair.b.send(encodeMessage({ kind: 'Input', tick, moveX, moveY, yaw, pitch: 0, buttons }));
      pair.settle();
    },
    /** Stop holding anything. */
    release() {
      held = { moveX: 0, moveY: 0, yaw: held.yaw, buttons: 0 };
    },
  };
}

/**
 * Run `ticks` ticks from `fromMs`, returning the time after the last one.
 *
 * Each client sends an input every tick, which a real client also does
 * unconditionally. It is not decoration: the server drops a connection that has
 * gone quiet (T-1.09 heartbeat timeout), so a test that idles for the length of
 * a respawn gets disconnected mid-test and every later assertion reads as a
 * mysterious absence of hit events rather than as a timeout.
 */
function run(
  session: Session,
  fromMs: number,
  ticks: number,
  ...clients: { settle: () => void; keepAlive: (tick: number) => void }[]
): number {
  let t = fromMs;
  for (let i = 0; i < ticks; i += 1) {
    t += TICK_MS;
    for (const c of clients) c.keepAlive(Math.round(t / TICK_MS));
    session.step(t);
    for (const c of clients) c.settle();
  }
  return t;
}

/**
 * Yaw/pitch aiming from the first slot's eye at a world point, in TABLE angle
 * units (1/4096) — the resolution a Fire message carries, which is finer than
 * the 1/1024 used for replicated facing.
 *
 * The shooter's eye is derived from the shared spawn table rather than written
 * in, so moving a spawn cannot silently leave every aim in this file pointing
 * at empty ground. Math.* is fine here: this is `packages/server`, and the
 * ADR-014 ban is scoped to shared.
 */
function aimAt(tx: number, ty: number, tz: number): { yaw: number; pitch: number } {
  const eye = SPAWN_POINTS[0] as { x: number; y: number; z: number };
  const dx = tx - eye.x;
  const dy = ty - (eye.y + 1.55);
  const dz = tz - eye.z;
  const table = (rad: number): number =>
    ((Math.round((rad / (Math.PI * 2)) * 4096) % 4096) + 4096) % 4096;
  return {
    yaw: table(Math.atan2(dx, dz)),
    pitch: table(Math.asin(dy / Math.hypot(dx, dy, dz))),
  };
}

describe('shooting the range', () => {
  it('registers hits on the range targets, not only on player slots', () => {
    /**
     * The reported bug: hit markers appeared on the grey squad capsules and
     * never on the red range targets. The targets were client-side scenery the
     * server had never heard of, so every shot at one traced against the six
     * player slots, found nothing, and came back a miss.
     */
    const session = new Session();
    const client = connect(session);
    const now = run(session, 0, 5, client);

    const target = RANGE_TARGETS[0]!;
    // Aim at the capsule's centre, which is its feet plus the hitbox offset.
    const aim = aimAt(target.x, target.y + 0.9, target.z);
    // Aimed: the hip cone is wide enough at this range to miss by chance, and a
    // test that fails one run in ten is worse than no test.
    client.fire({ ...aim, ads: true, renderTimeMs: now });

    const hit = client.hits[0];
    expect(hit).toBeDefined();
    expect(hit?.targetNetId).toBe(target.netId);
    expect(isRangeTarget(hit?.targetNetId ?? 0)).toBe(true);
    expect(hit?.damage).toBeGreaterThan(0);
  });

  it('applies falloff across the range, so a distant target takes less', () => {
    const near = RANGE_TARGETS[0]!;
    const far = RANGE_TARGETS[4]!;

    const shootAt = (t: typeof near): number => {
      const session = new Session();
      const client = connect(session);
      const now = run(session, 0, 5, client);
      client.fire({ ...aimAt(t.x, t.y + 0.9, t.z), ads: true, renderTimeMs: now });
      return client.hits[0]?.damage ?? -1;
    };

    const nearDamage = shootAt(near);
    const farDamage = shootAt(far);
    expect(nearDamage).toBeGreaterThan(0);
    expect(farDamage).toBeGreaterThan(0);
    // 10 m is inside the carbine's 22 m falloff start; 80 m is past its 55 m end.
    expect(farDamage).toBeLessThan(nearDamage);
  });
});

describe('weapon bloom', () => {
  it('recovers between bursts, so accuracy comes back', () => {
    /**
     * The bug this guards: firing adds bloom and only `decayBloom` removes it,
     * and the session never called it. The server's cone pinned at the weapon's
     * maximum after a few shots and stayed there — while the client decayed its
     * own copy and went on displaying the small cone. Invisible from the HUD;
     * visible as every gun being much less accurate than it reads.
     *
     * Aimed shots at the nearest target are the probe. With bloom recovered the
     * cone is a fraction of a degree and every shot lands; pinned at the
     * carbine's 5.5 degree maximum, a 0.35 m capsule at 11.5 m is a coin flip
     * at best, so six in a row landing is about a one-in-a-million accident.
     */
    const session = new Session();
    const client = connect(session);
    let now = run(session, 0, 5, client);

    const target = RANGE_TARGETS[0]!;
    const aim = aimAt(target.x, target.y + 0.9, target.z);
    const carbine = getWeapon('carbine');
    const shotTicks = Math.ceil(((60 / carbine.rpm) * 1000) / TICK_MS);

    // Empty most of a magazine to drive the cone up.
    for (let i = 0; i < 20; i += 1) {
      client.fire({ ...aim, ads: true, renderTimeMs: now });
      now = run(session, now, shotTicks, client);
    }

    // Stand still long enough for the bloom to recover fully.
    now = run(session, now, 90, client);

    const before = client.hits.length;
    for (let i = 0; i < 6; i += 1) {
      client.fire({ ...aim, ads: true, renderTimeMs: now });
      now = run(session, now, shotTicks, client);
    }
    const fired = client.hits.slice(before);
    expect(fired.length).toBe(6);
    expect(fired.every((h) => h.targetNetId === target.netId)).toBe(true);
  });
});

describe('firing over the wire', () => {
  it('broadcasts a hit event for a shot, to every connection', () => {
    const session = new Session();
    const shooter = connect(session);
    const bystander = connect(session);
    const now = run(session, 0, 5, shooter, bystander);

    shooter.fire({ renderTimeMs: now, yaw: ALONG_THE_LINE });
    expect(shooter.hits.length).toBe(1);

    // Everyone draws the same tracer, so everyone is told about it. The
    // bystander's transport is a separate queue and has to be pumped before
    // its inbox means anything — firing does not deliver another client's mail.
    bystander.settle();
    expect(bystander.hits.length).toBe(1);
    expect(shooter.hits[0]?.shooterNetId).toBe(shooter.netId);
  });

  it('enforces the weapon cadence, so spamming Fire does not fire faster', () => {
    const session = new Session();
    const client = connect(session);
    const now = run(session, 0, 5, client);

    // The carbine is 720 rpm: one shot per 83 ms, so within a single 33 ms
    // tick exactly one of these may be honoured however many arrive.
    for (let i = 0; i < 10; i += 1) client.fire({ renderTimeMs: now, yaw: ALONG_THE_LINE });
    expect(client.hits.length).toBe(1);
  });

  it('honours the cadence across ticks', () => {
    const session = new Session();
    const client = connect(session);
    let now = run(session, 0, 5, client);

    const carbine = getWeapon('carbine');
    const shotMs = (60 / carbine.rpm) * 1000;
    client.fire({ renderTimeMs: now, yaw: ALONG_THE_LINE });
    const first = client.hits.length;

    // Step past one full cadence interval, then fire again.
    now = run(session, now, Math.ceil(shotMs / TICK_MS) + 1, client);
    client.fire({ renderTimeMs: now, yaw: ALONG_THE_LINE });
    expect(client.hits.length).toBeGreaterThan(first);
  });

  it('empties the magazine and stops, rather than firing forever', () => {
    const session = new Session();
    const client = connect(session);
    let now = run(session, 0, 2, client);
    const carbine = getWeapon('carbine');
    const shotTicks = Math.ceil(((60 / carbine.rpm) * 1000) / TICK_MS);

    for (let i = 0; i < carbine.magSize + 12; i += 1) {
      client.fire({ renderTimeMs: now, yaw: ALONG_THE_LINE });
      now = run(session, now, shotTicks, client);
    }
    // Never more than a magazine before the reload has to run.
    expect(client.hits.length).toBeLessThanOrEqual(carbine.magSize);
    expect(client.hits.length).toBeGreaterThan(0);
  });

  it('ignores a weapon index that is not a weapon', () => {
    const session = new Session();
    const client = connect(session);
    const now = run(session, 0, 5, client);
    expect(() => client.fire({ weapon: 7, renderTimeMs: now })).not.toThrow();
    expect(client.hits.length).toBe(0);
  });

  it('never reports the shooter as its own target', () => {
    const session = new Session();
    const client = connect(session);
    const now = run(session, 0, 5, client);
    client.fire({ renderTimeMs: now, yaw: ALONG_THE_LINE });
    expect(client.hits[0]?.targetNetId).not.toBe(client.netId);
  });

  it('clamps a client claiming an absurd render time', () => {
    const session = new Session();
    const client = connect(session);
    const now = run(session, 0, 20, client);
    // Five seconds of claimed latency. It must resolve rather than throw, and
    // it must not reach back further than the cap allows.
    expect(() => client.fire({ renderTimeMs: now - 5000 })).not.toThrow();
    expect(client.hits.length).toBe(1);
  });

  it('records hitbox history for every slot, including bots', () => {
    // Six slots exist from the start (ADR-001), so a shot down the spawn line
    // finds a bot without anyone else connecting — history is recorded for
    // every slot, not only for connected players.
    const session = new Session();
    const client = connect(session);
    const now = run(session, 0, 5, client);
    client.fire({ renderTimeMs: now, yaw: ALONG_THE_LINE });
    expect(client.hits[0]?.targetNetId).toBeGreaterThan(0);
  });
});

describe('the shooter is rewound too', () => {
  it('traces from where the shooter was when they fired, not where they are now', () => {
    /**
     * Reported as guns feeling inaccurate, and worse with ping. The fire
     * command takes half a round trip to arrive and the server keeps
     * simulating, so by the time it resolves the shooter has moved — 0.54 m at
     * sprint on an 80 ms link. Tracing the client's aim DIRECTION from a
     * position half a metre away from the one it was computed at shifts the
     * whole ray sideways, which misses a 0.35 m target completely.
     *
     * This drives the shooter sideways, then fires with the aim and the render
     * time from BEFORE the movement. Rewinding the origin lands it; using the
     * current position does not.
     */
    const session = new Session();
    const client = connect(session);
    let now = run(session, 0, 4, client);

    const target = RANGE_TARGETS[0]!;
    const aimThen = aimAt(target.x, target.y + 0.9, target.z);
    const firedAt = now;

    // Strafe hard for ~200 ms: enough to carry the origin clear of a 0.35 m
    // capsule at this range.
    for (let tick = 1; tick <= 7; tick += 1) {
      client.input(aimThen.yaw, tick, 1, 0, 0b010);
      now = run(session, now, 1, client);
    }

    client.fire({ ...aimThen, ads: true, renderTimeMs: firedAt });
    const rewound = client.hits.at(-1);
    expect(rewound?.targetNetId).toBe(target.netId);

    /**
     * Now the same aim, claiming to have been fired right now, so the origin is
     * the shooter's present position. It must miss.
     *
     * The wait is not optional: the carbine is 720 rpm, so two fires inside one
     * 33 ms tick are one shot and a rejection, and the second assertion would
     * be reading the first shot's result.
     */
    for (let tick = 8; tick <= 12; tick += 1) {
      client.input(aimThen.yaw, tick, 1, 0, 0b010);
      now = run(session, now, 1, client);
    }
    const before = client.hits.length;
    client.fire({ ...aimThen, ads: true, renderTimeMs: now });
    expect(client.hits.length).toBe(before + 1);
    expect(client.hits.at(-1)?.targetNetId).toBe(0);
  });
});

describe('damage, death and respawn (T-1.19)', () => {
  /**
   * End to end over the wire: shoot a teammate down, confirm the total damage
   * dealt is exactly their health, confirm a corpse takes nothing further, and
   * confirm they come back at full health at their own spawn.
   *
   * Slot 0 shoots slot 1, which spawns 1.5 m to its right at z = 0. At that
   * range the carbine is inside its falloff start, and a shot at capsule centre
   * height lands in the torso, so each hit is the weapon's full listed damage.
   */
  const CARBINE_TORSO = 22;

  function killTheNeighbour() {
    const session = new Session();
    const client = connect(session);
    let now = run(session, 0, 4, client);
    const carbine = getWeapon('carbine');
    const shotTicks = Math.ceil(((60 / carbine.rpm) * 1000) / TICK_MS);
    // Slot 1's spawn, aimed at capsule centre.
    const neighbour = SPAWN_POINTS[1] as { x: number; y: number; z: number };
    const aim = aimAt(neighbour.x, neighbour.y + 0.9, neighbour.z);

    const fire = (): number | undefined => {
      const before = client.hits.length;
      client.fire({ ...aim, ads: true, renderTimeMs: now });
      now = run(session, now, shotTicks, client);
      return client.hits.length > before ? client.hits.at(-1)?.damage : undefined;
    };
    return { session, client, fire, aim, get now() { return now; }, advance: (ticks: number) => { now = run(session, now, ticks, client); } };
  }

  it('kills at the correct cumulative threshold and not before', () => {
    const range = killTheNeighbour();
    const shotsNeeded = Math.ceil(DAMAGE.maxHealth / CARBINE_TORSO);

    let total = 0;
    for (let i = 1; i < shotsNeeded; i += 1) {
      const dealt = range.fire();
      expect(dealt).toBeCloseTo(CARBINE_TORSO, 6);
      total += dealt ?? 0;
    }
    expect(total).toBeLessThan(DAMAGE.maxHealth);

    // The last shot deals only what was left, never the full listed damage.
    const fatal = range.fire();
    expect(fatal).toBeLessThan(CARBINE_TORSO);
    total += fatal ?? 0;
    expect(total).toBeCloseTo(DAMAGE.maxHealth, 6);
  });

  it('a corpse takes no further damage', () => {
    // Under lag compensation two shooters can each land a fatal shot on a
    // target that was alive in their own rewound world. Damage past zero is how
    // one death becomes two kills.
    const range = killTheNeighbour();
    for (let i = 0; i < Math.ceil(DAMAGE.maxHealth / CARBINE_TORSO); i += 1) range.fire();
    expect(range.fire()).toBe(0);
    expect(range.fire()).toBe(0);
  });

  it('respawns at full health once the delay has elapsed, and not before', () => {
    const range = killTheNeighbour();
    for (let i = 0; i < Math.ceil(DAMAGE.maxHealth / CARBINE_TORSO); i += 1) range.fire();
    const diedAt = range.now;
    expect(range.fire()).toBe(0);

    /**
     * Measured rather than counted. Keep firing and watch for the first shot
     * that lands damage again; the elapsed time is then the respawn delay as
     * the session actually implements it, not as a tick-arithmetic guess. The
     * earlier version of this test counted ticks and was wrong by the handful
     * the polling shots themselves consumed.
     */
    let revivedAfter = -1;
    while (range.now - diedAt < (DAMAGE.respawnSeconds + 3) * 1000) {
      const dealt = range.fire();
      if (dealt !== undefined && dealt > 0) {
        revivedAfter = range.now - diedAt;
        break;
      }
    }

    expect(revivedAfter, 'they came back at all').toBeGreaterThan(0);
    expect(revivedAfter / 1000, 'not before the delay').toBeGreaterThanOrEqual(DAMAGE.respawnSeconds);
    // Within one polling interval of the delay, so it is the timer firing and
    // not simply the loop eventually noticing.
    expect(revivedAfter / 1000, 'and not much after it').toBeLessThan(DAMAGE.respawnSeconds + 0.5);
  });

  it('puts them back at their own spawn point, taking full damage again', () => {
    const range = killTheNeighbour();
    for (let i = 0; i < Math.ceil(DAMAGE.maxHealth / CARBINE_TORSO); i += 1) range.fire();
    range.advance(Math.ceil(((DAMAGE.respawnSeconds + 0.5) * 1000) / TICK_MS));

    // The aim was never adjusted: it still points at slot 1's spawn. A full
    // damage hit means they are standing there again with full health.
    expect(range.fire()).toBeCloseTo(CARBINE_TORSO, 6);
  });
});

describe('aim is accurate at every range', () => {
  it('hits all six range targets from 10 m to 95 m', () => {
    /**
     * Reported as third-person shots landing left of the reticle up close and
     * drifting further right the further out the target was. Two causes, both
     * about precision rather than about lag:
     *
     * The aim used to be quantized to the 1/1024 turn the wire uses for
     * replicated facing, and converted by a SHIFT, which truncates. So the
     * error was a consistent bias to one side of up to a quarter of a degree —
     * nothing at 10 m, most of a metre at 95 m. Aim now rides at 1/4096 and is
     * rounded once.
     *
     * A single tolerance across a 10:1 range of distances is what makes this
     * test worth having: an angular error is invisible near and glaring far, so
     * only the far targets can catch it.
     */
    for (const target of RANGE_TARGETS) {
      const session = new Session();
      const client = connect(session);
      const now = run(session, 0, 5, client);
      client.fire({
        ...aimAt(target.x, target.y + 0.9, target.z),
        ads: true,
        renderTimeMs: now,
      });
      const hit = client.hits[0];
      expect(hit, `a shot was resolved at ${target.label}`).toBeDefined();
      expect(hit?.targetNetId, `hit the target at ${target.label}`).toBe(target.netId);
    }
  });

  it('lands the impact on the aim line, not beside it', () => {
    // The impact must sit on the ray, so its lateral offset from the aim line
    // is what "goes where I am pointing" actually means.
    const far = RANGE_TARGETS[RANGE_TARGETS.length - 1] as (typeof RANGE_TARGETS)[number];
    const session = new Session();
    const client = connect(session);
    const now = run(session, 0, 5, client);
    client.fire({ ...aimAt(far.x, far.y + 0.9, far.z), ads: true, renderTimeMs: now });

    const hit = client.hits[0];
    expect(hit).toBeDefined();
    // Within the capsule's own radius of the point aimed at, at 95 m out.
    expect(Math.hypot((hit?.x ?? 0) - far.x, (hit?.z ?? 0) - far.z)).toBeLessThan(0.4);
  });
});
