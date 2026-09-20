/**
 * Revive (T-2.15), end to end over the wire: two clients, one downs the
 * other, then holds the interact button beside them.
 *
 * Positions: slot 0 spawns at x = -3.75 and slot 1 at x = -2.25, both on
 * z = -6 — exactly the revive range apart, so the reviver walks a few ticks
 * closer first and the tests do not sit on a boundary.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  DAMAGE,
  type Message,
  PROTOCOL_VERSION,
  SPAWN_POINTS,
  SnapshotStore,
  createLoopbackPair,
  decodeMessage,
  decodeVitals,
  encodeMessage,
  getWeapon,
} from '@sandline/shared';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const INTERACT = 0b1000;
const H = COMPONENT_IDS.Health;
/** Facing +X: forward is (sin yaw, cos yaw), so a quarter turn of 1024. */
const TOWARD_PLUS_X = 256;

function connect(session: Session, name: string, now = 0) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, now);
  const store = new SnapshotStore();
  const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
  let netId = 0;
  let slot = -1;
  let held = { moveX: 0, moveY: 0, yaw: 0, buttons: 0 };
  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'JoinAck') {
      netId = msg.netId;
      slot = msg.slot;
    }
    if (msg.kind === 'HitEvent') hits.push(msg);
    if (msg.kind === 'Delta') store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name, room: '' }));
  pair.settle();
  return {
    hits,
    get netId() {
      return netId;
    },
    get slot() {
      return slot;
    },
    settle: () => pair.settle(),
    keepAlive(tick: number) {
      pair.b.send(encodeMessage({ kind: 'Input', tick, ...held, pitch: 0 }));
      pair.settle();
    },
    hold(over: Partial<typeof held>) {
      held = { ...held, ...over };
    },
    fire(yaw: number, pitch: number, renderTimeMs: number) {
      pair.b.send(encodeMessage({ kind: 'Fire', tick: 0, yaw, pitch, renderTimeMs, weapon: 0, ads: true }));
      pair.settle();
    },
    /** What the newest snapshot says about a soldier. */
    vitals(of: number) {
      const e = store.current?.entities.find((x) => x.netId === of);
      return e ? decodeVitals(e.components[H] as number[]) : null;
    },
  };
}

type Client = ReturnType<typeof connect>;

/** `every` > 1 sends inputs only on every Nth tick: a bursty link's gaps. */
function run(session: Session, fromMs: number, ticks: number, clients: Client[], every = 1): number {
  let t = fromMs;
  for (let i = 0; i < ticks; i += 1) {
    t += TICK_MS;
    const tick = Math.round(t / TICK_MS);
    if (tick % every === 0) for (const c of clients) c.keepAlive(tick);
    session.step(t);
    for (const c of clients) c.settle();
  }
  return t;
}

const ticksFor = (seconds: number): number => Math.ceil((seconds * 1000) / TICK_MS);

/** Aim from slot 0's eye at slot 1's capsule centre, in table units. */
function aimAtNeighbour(): { yaw: number; pitch: number } {
  const eye = SPAWN_POINTS[0] as { x: number; y: number; z: number };
  const at = SPAWN_POINTS[1] as { x: number; y: number; z: number };
  const dx = at.x - eye.x;
  const dy = at.y + 0.9 - (eye.y + 1.55);
  const dz = at.z - eye.z;
  const table = (rad: number): number => ((Math.round((rad / (Math.PI * 2)) * 4096) % 4096) + 4096) % 4096;
  return { yaw: table(Math.atan2(dx, dz)), pitch: table(Math.asin(dy / Math.hypot(dx, dy, dz))) };
}

/** A session where `a` (slot 0) has just downed `b` (slot 1) and stepped within reach. */
function downedNeighbour() {
  const session = new Session();
  const a = connect(session, 'alpha');
  const b = connect(session, 'bravo', TICK_MS);
  const all = [a, b];
  let now = run(session, 0, 4, all);
  const carbine = getWeapon('carbine');
  const shotTicks = Math.ceil(((60 / carbine.rpm) * 1000) / TICK_MS);
  const aim = aimAtNeighbour();
  for (let i = 0; i < Math.ceil(DAMAGE.maxHealth / 22); i += 1) {
    a.fire(aim.yaw, aim.pitch, now);
    now = run(session, now, shotTicks, all);
  }
  expect(a.vitals(b.netId)?.vitality).toBe('downed');
  // Face the neighbour and take three ticks toward them: 1.5 m becomes ~1.08 m.
  a.hold({ yaw: TOWARD_PLUS_X, moveY: 1 });
  now = run(session, now, 3, all);
  a.hold({ moveY: 0 });
  now = run(session, now, 1, all);
  return {
    session,
    a,
    b,
    get now() {
      return now;
    },
    advance(ticks: number, every = 1) {
      now = run(session, now, ticks, all, every);
    },
    fireAtB() {
      a.fire(aim.yaw, aim.pitch, now);
      now = run(session, now, shotTicks, all);
    },
  };
}

describe('revive over the wire (T-2.15)', () => {
  it('a held interact within reach stands the downed teammate up with the configured health', () => {
    const r = downedNeighbour();
    r.a.hold({ buttons: INTERACT });
    // Halfway: still downed, and both sides can see who is reviving whom.
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds / 2));
    const mid = r.a.vitals(r.b.netId);
    expect(mid?.vitality).toBe('downed');
    expect(mid?.reviverSlot).toBe(r.a.slot);
    expect(mid?.reviveProgress).toBeGreaterThan(0.3);
    expect(mid?.reviveProgress).toBeLessThan(0.7);
    expect(r.b.vitals(r.b.netId)?.reviverSlot).toBe(r.a.slot);

    r.advance(ticksFor(DAMAGE.downed.reviveSeconds / 2) + 2);
    const up = r.a.vitals(r.b.netId);
    expect(up?.vitality).toBe('alive');
    expect(up?.current).toBe(Math.round(DAMAGE.maxHealth * DAMAGE.downed.reviveHealthFraction));
    expect(up?.reviverSlot).toBeNull();
    expect(up?.reviveProgress).toBe(0);
  });

  it('letting go resets the progress; the next hold starts from nothing', () => {
    const r = downedNeighbour();
    r.a.hold({ buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds * 0.7));
    expect(r.a.vitals(r.b.netId)?.reviveProgress).toBeGreaterThan(0.5);
    r.a.hold({ buttons: 0 });
    r.advance(2);
    expect(r.a.vitals(r.b.netId)?.reviveProgress).toBe(0);
    expect(r.a.vitals(r.b.netId)?.reviverSlot).toBeNull();
    // Another 0.7 of the time: would have finished had progress carried over.
    r.a.hold({ buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds * 0.7));
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('downed');
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds * 0.35));
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('alive');
  });

  it('out of reach, holding does nothing', () => {
    const r = downedNeighbour();
    // Walk back the way we came, well past the range.
    r.a.hold({ moveY: -1 });
    r.advance(12);
    r.a.hold({ moveY: 0, buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds * 2));
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('downed');
    expect(r.a.vitals(r.b.netId)?.reviverSlot).toBeNull();
  });

  it('a dead soldier cannot be revived', () => {
    const r = downedNeighbour();
    // A health bar of shots on the body finishes them.
    for (let i = 0; i < Math.ceil(DAMAGE.maxHealth / 22); i += 1) r.fireAtB();
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('dead');
    r.a.hold({ buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds + 0.5));
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('dead');
    expect(r.a.vitals(r.b.netId)?.reviverSlot).toBeNull();
  });

  it('the bleed-out keeps running: a revive started too late fails honestly', () => {
    const r = downedNeighbour();
    // Wait until one second of bleed-out remains, then start the hold.
    r.advance(ticksFor(DAMAGE.downed.bleedOutSeconds - 1) - ticksFor(0.5));
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('downed');
    r.a.hold({ buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds + 0.5));
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('dead');
    expect(r.a.vitals(r.b.netId)?.reviverSlot).toBeNull();
  });

  it('survives a bursty link: inputs every third tick still complete the hold on time', () => {
    /**
     * A tick with nothing buffered runs an idle input (hold-immediately). If
     * the hold were read off that input, every gap would reset the revive
     * and a client on a jittery link could never finish one. The button is
     * latched from the newest real input instead, so the gaps merely pass.
     */
    const r = downedNeighbour();
    r.a.hold({ buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds) - 3, 3);
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('downed');
    expect(r.a.vitals(r.b.netId)?.reviverSlot).toBe(r.a.slot);
    r.advance(6, 3);
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('alive');
  });

  it('a client that goes silent past the repeat window is no longer holding', () => {
    const r = downedNeighbour();
    r.a.hold({ buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds / 2));
    expect(r.a.vitals(r.b.netId)?.reviverSlot).toBe(r.a.slot);
    // Silence for twice the window: b keeps talking so the session stays alive.
    r.advance(12, 1000000);
    r.b.keepAlive(0);
    expect(r.a.vitals(r.b.netId)?.reviverSlot).toBeNull();
  });

  it('a downed soldier cannot revive anyone, and the reviver is named by seat', () => {
    const r = downedNeighbour();
    // The downed one holds interact too: nothing, since they are not alive.
    r.b.hold({ buttons: INTERACT });
    r.advance(ticksFor(DAMAGE.downed.reviveSeconds + 0.5));
    expect(r.a.vitals(r.a.netId)?.reviverSlot).toBeNull();
    expect(r.a.vitals(r.b.netId)?.vitality).toBe('downed');
    // And the seat index on the wire matches the roster's row for the reviver.
    r.a.hold({ buttons: INTERACT });
    r.advance(3);
    expect(r.b.vitals(r.b.netId)?.reviverSlot).toBe(0);
    expect(r.session.roster[0]?.name).toBe('alpha');
  });
});
