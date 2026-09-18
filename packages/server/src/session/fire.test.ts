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
  type Message,
  PROTOCOL_VERSION,
  RANGE_TARGETS,
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
    input(yaw: number, tick: number) {
      pair.b.send(
        encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw, pitch: 0, buttons: 0 }),
      );
      pair.settle();
    },
  };
}

/** Run `ticks` ticks from `fromMs`, returning the time after the last one. */
function run(session: Session, fromMs: number, ticks: number, ...clients: { settle: () => void }[]): number {
  let t = fromMs;
  for (let i = 0; i < ticks; i += 1) {
    t += TICK_MS;
    session.step(t);
    for (const c of clients) c.settle();
  }
  return t;
}

/**
 * Wire yaw/pitch aiming from the first slot's eye at a world point. Slot 0
 * spawns at x = -3.75, z = 0 (six slots spread along X), and the eye is
 * 1.55 m up. Math.* is fine here: this is `packages/server`, and the ADR-014
 * ban is scoped to shared.
 */
function aimAt(tx: number, ty: number, tz: number): { yaw: number; pitch: number } {
  const dx = tx - -3.75;
  const dy = ty - 1.55;
  const dz = tz - 0;
  const wire = (rad: number): number =>
    ((Math.round((rad / (Math.PI * 2)) * 1024) % 1024) + 1024) % 1024;
  return {
    yaw: wire(Math.atan2(dx, dz)),
    pitch: wire(Math.asin(dy / Math.hypot(dx, dy, dz))),
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
