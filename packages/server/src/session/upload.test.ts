/**
 * U-009: the upload objective on a real `Session` over loopback. The host
 * judges every press at the terminal — who, where, the line to the panel,
 * the phase — so a press out of reach, through a wall, while down, held
 * over from before, or after the upload is done starts nothing. Started, it
 * runs with nobody near it; an event script interrupts it; a fresh press
 * restarts it with its progress kept. A player who joins or comes back
 * mid-upload is told where it stands, and a retry, a restart and a durable
 * checkpoint put it back to waiting at the terminal.
 */
import { describe, expect, it } from 'vitest';
import {
  ClientConnection,
  type Message,
  type MissionDef,
  type ObjectiveDef,
  TICK_SECONDS,
  createLoopbackPair,
  decodeMessage,
  parseEncounter,
  parseEventScript,
  requireWorld,
} from '@sandline/shared';
import { lineOfSight } from '../ai/aim.ts';
import type { CampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';

const WORLD = requireWorld('greybox-01');
const TICK_MS = 1000 / 30;
const ticks = (seconds: number) => Math.round(seconds / TICK_SECONDS);
const E = 0b1000;

/** On the south face of `as-wall-1` (x 3..20, z 12.8..13.2, 2.4 m tall): a panel at chest height. */
const TERMINAL = { x: 10, y: 1.2, z: 12.5 };
/** Where the soldier stands: in front of the panel, behind the wall from it, and too far off. */
const FRONT = { x: 10, z: 11.6 };
const BEHIND = { x: 10, z: 13.8 };
const FAR = { x: 10, z: 8 };
const EYE = 1.6;

const upload = (seconds = 10, onInterrupt: 'keep-progress' | 'reset-progress' = 'keep-progress'): ObjectiveDef =>
  ({ type: 'upload', label: 'the relay', terminal: TERMINAL, reachM: 2, seconds, onInterrupt });

/** No enemies for the length of a test: the group waits for a script that never sends it. */
const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 4,
  probes: [0.3, 1, 1.7],
  areas: {},
  groups: [{ id: 'g', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } }],
});

function room(objectives: ObjectiveDef[], opts: { interruptAt?: number; campaign?: CampaignState; onSave?: (s: CampaignState) => void } = {}) {
  const mission: MissionDef = { id: 'upload-test', world: 'greybox-01', respawn: false, objectives };
  const events = parseEventScript(
    {
      world: 'greybox-01',
      blockers: [],
      events: opts.interruptAt === undefined ? [] : [{ id: 'cut', trigger: { kind: 'time', seconds: opts.interruptAt }, actions: [{ kind: 'interrupt-upload' }] }],
    },
    ENCOUNTER,
    WORLD,
    mission,
  );
  const session = new Session(undefined, '', WORLD, {
    encounter: ENCOUNTER,
    mission,
    events,
    ...(opts.campaign ? { campaign: opts.campaign } : {}),
    ...(opts.onSave ? { onCampaignSave: opts.onSave } : {}),
  });
  let now = 0;
  let tick = 0;
  const players: { client: ClientConnection; pair: ReturnType<typeof createLoopbackPair>; seen: Message[]; buttons: number; slot: number }[] = [];
  const join = (name: string) => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, now);
    const seen: Message[] = [];
    const p = { client: null as unknown as ClientConnection, pair, seen, buttons: 0, slot: -1 };
    p.client = new ClientConnection(pair.b, { onJoinAck: (_netId, slot) => (p.slot = slot) });
    // Every message the host sends this client, decoded as it arrives.
    pair.b.onMessage((bytes) => {
      try {
        seen.push(decodeMessage(bytes));
      } catch {
        // A delta this test does not read.
      }
    });
    p.client.join(name);
    pair.settle();
    players.push(p);
    return p;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tick += 1;
      now += TICK_MS;
      for (const p of players) if (p.pair.b.isOpen) p.client.send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: p.buttons });
      for (const p of players) p.pair.settle();
      session.step(now);
      for (const p of players) p.pair.settle();
    }
  };
  const place = (slot: number, at: { x: number; z: number }) => {
    const s = session.slots[slot]!;
    s.state = { ...s.state, x: at.x, y: 0, z: at.z, vy: 0 };
  };
  /** Press E for one tick and let go. */
  const press = (p: { buttons: number }) => {
    p.buttons = E;
    step(1);
    p.buttons = 0;
    step(1);
  };
  return { session, join, step, place, press, get mission() { return session.mission!; } };
}

/** The Mission messages a client has been sent, in order. */
const missions = (p: { seen: Message[] }) => p.seen.filter((m): m is Extract<Message, { kind: 'Mission' }> => m.kind === 'Mission');

describe('the geometry these tests stand on', () => {
  it('the panel is in reach and in sight from the front, hidden from behind the wall, and out of reach from afar', () => {
    const d = (at: { x: number; z: number }) => Math.hypot(at.x - TERMINAL.x, EYE - TERMINAL.y, at.z - TERMINAL.z);
    expect(d(FRONT)).toBeLessThan(2);
    expect(d(BEHIND)).toBeLessThan(2);
    expect(d(FAR)).toBeGreaterThan(2);
    expect(lineOfSight({ x: FRONT.x, y: EYE, z: FRONT.z }, TERMINAL, WORLD.boxes)).toBe(true);
    expect(lineOfSight({ x: BEHIND.x, y: EYE, z: BEHIND.z }, TERMINAL, WORLD.boxes)).toBe(false);
  });
});

describe('the upload objective on a session (U-009)', () => {
  it('the host refuses a press out of reach, through a wall, while down or held over; accepts one at the panel', () => {
    const r = room([upload()]);
    const me = r.join('me');
    r.step(3);
    expect(missions(me)[0]).toMatchObject({ type: 'upload', phase: 'idle', progress: 0 });
    // Out of reach.
    r.place(me.slot, FAR);
    r.press(me);
    expect(r.mission.phase).toBe('idle');
    // In reach, but the wall is between the eye and the panel.
    r.place(me.slot, BEHIND);
    r.press(me);
    expect(r.mission.phase).toBe('idle');
    // At the panel, but down.
    r.place(me.slot, FRONT);
    const slot = r.session.slots[me.slot]!;
    slot.health.current = 0;
    slot.health.downedAt = r.session.tick * TICK_SECONDS;
    r.press(me);
    expect(r.mission.phase).toBe('idle');
    slot.health.current = slot.health.max;
    slot.health.downedAt = null;
    // E held down from before reaching the panel is not a press here.
    r.place(me.slot, FAR);
    me.buttons = E;
    r.step(3);
    r.place(me.slot, FRONT);
    r.step(5);
    expect(r.mission.phase).toBe('idle');
    me.buttons = 0;
    r.step(1);
    // A press at the panel: running.
    r.press(me);
    expect(r.mission).toMatchObject({ phase: 'active', satisfied: true });
    expect(missions(me).at(-1)).toMatchObject({ phase: 'active' });
  });

  it('runs with nobody near it, is interrupted by the script, keeps its progress, and restarts only on a fresh press', () => {
    const r = room([upload(10), { type: 'survive', label: 'the exfil', seconds: 30 }], { interruptAt: 4 });
    const me = r.join('me');
    r.step(3);
    r.place(me.slot, FRONT);
    r.press(me);
    expect(r.mission.phase).toBe('active');
    // Walk away: it runs on its own.
    r.place(me.slot, FAR);
    r.step(ticks(2));
    const before = r.mission.progress;
    expect(before).toBeGreaterThan(ticks(1.5));
    // The script's interruption, four seconds in.
    r.step(ticks(2.5));
    expect(r.mission.phase).toBe('interrupted');
    const kept = r.mission.progress;
    expect(kept).toBeGreaterThan(before);
    expect(missions(me).at(-1)).toMatchObject({ phase: 'interrupted', satisfied: false, progress: kept });
    r.step(ticks(2));
    expect(r.mission.progress).toBe(kept);
    // Back at the panel with E already held: no restart until a fresh press.
    me.buttons = E;
    r.step(1);
    r.place(me.slot, FRONT);
    r.step(5);
    expect(r.mission.phase).toBe('interrupted');
    me.buttons = 0;
    r.step(1);
    r.press(me);
    expect(r.mission.phase).toBe('active');
    expect(r.mission.progress).toBeGreaterThanOrEqual(kept);
    r.step(ticks(10) - kept + 2);
    // Done once: the next objective, and the late presses cannot touch it.
    expect(r.mission).toMatchObject({ objective: 1, type: 'survive', progress: expect.any(Number) as number });
    const progress = r.mission.progress;
    r.press(me);
    r.press(me);
    expect(r.mission.objective).toBe(1);
    expect(r.mission.progress).toBeGreaterThan(progress);
  });

  it('says the upload is complete to everyone, and a player who joins mid-upload is told where it stands', () => {
    const r = room([upload(6), { type: 'survive', label: 'the exfil', seconds: 30 }]);
    const me = r.join('me');
    r.step(3);
    r.place(me.slot, FRONT);
    r.press(me);
    r.step(ticks(2));
    const late = r.join('late');
    r.step(1);
    const first = missions(late)[0]!;
    expect(first).toMatchObject({ type: 'upload', phase: 'active' });
    expect(first.progress).toBeGreaterThan(ticks(1.5));
    // A player who drops and comes back is told again.
    me.pair.b.close('network lost');
    me.pair.settle();
    r.step(3);
    const back = r.join('me');
    r.step(1);
    expect(missions(back)[0]).toMatchObject({ type: 'upload', phase: 'active' });
    // The completion, as a message to every client.
    r.step(ticks(5));
    expect(r.mission).toMatchObject({ objective: 1, type: 'survive' });
    for (const p of [late, back]) expect(p.seen).toContainEqual({ kind: 'ScriptMessage', text: 'Upload complete: the relay' });
  });

  it('a retry after a wipe, and a durable checkpoint in a new host, put the upload back to waiting at its terminal', () => {
    let saved: CampaignState | null = null;
    const objectives = [{ type: 'survive', label: 'the wait', seconds: 1 } as ObjectiveDef, upload(10)];
    const r = room(objectives, { onSave: (s) => (saved = s) });
    const me = r.join('me');
    r.step(ticks(1) + 3);
    expect(r.mission).toMatchObject({ objective: 1, type: 'upload', phase: 'idle' });
    expect(saved).not.toBeNull();
    r.place(me.slot, FRONT);
    r.press(me);
    r.step(ticks(2));
    expect(r.mission.phase).toBe('active');
    // A wipe fails it; the retry comes back to the checkpoint, the upload waiting, from nothing.
    for (const s of r.session.slots) Object.assign(s.health, { current: 0, diedAt: r.session.tick * TICK_SECONDS });
    r.step(1);
    expect(r.mission.state).toBe('failed');
    me.client.send({ kind: 'MissionRestart' });
    me.pair.settle();
    r.step(2);
    expect(r.mission).toMatchObject({ state: 'progress', objective: 1, phase: 'idle', progress: 0 });
    expect(missions(me).at(-1)).toMatchObject({ objective: 1, phase: 'idle', progress: 0 });
    // And the terminal takes a press again.
    r.place(me.slot, FRONT);
    r.press(me);
    expect(r.mission.phase).toBe('active');

    // A new host from the saved checkpoint: the upload, waiting at its terminal, for everyone who joins.
    const again = room(objectives, { campaign: saved! });
    const next = again.join('me');
    again.step(2);
    expect(missions(next)[0]).toMatchObject({ objective: 1, type: 'upload', phase: 'idle', progress: 0 });
    again.place(next.slot, FRONT);
    again.press(next);
    expect(again.mission.phase).toBe('active');
  });
});
