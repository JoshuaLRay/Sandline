/**
 * Callouts (T-2.49): each event plays its line once within its cooldown and
 * never twice at once; the radio or positional choice follows distance; one
 * voice at a time on the radio, the rest waiting their turn or dropped; a
 * missing recording falls back to the chirp without an error. And the
 * watcher finds each event in what the client already has.
 */
import { describe, expect, it } from 'vitest';
import { CALLOUTS, type MissionView, VOICES, boxFrom } from '@sandline/shared';
import { type CalloutSpeaker, CalloutDirector, NO_VOICES, voiceIndex } from './callouts.ts';
import { type CalloutView, CalloutWatcher, type SquadSoldier, canSee } from './calloutEvents.ts';
import { AudioEngine } from './engine.ts';
import { fakeContext } from './fakeAudio.ts';

const EAR = { x: 0, y: 1.6, z: 0 };
const near = (slot: number, m = 10): CalloutSpeaker => ({ slot, at: { x: m, y: 0, z: 0 }, self: false });
const far = (slot: number, m = 60): CalloutSpeaker => ({ slot, at: { x: 0, y: 0, z: m }, self: false });
const me: CalloutSpeaker = { slot: 0, at: null, self: true };
const CHIRP = 0.5;

describe('the callout director (T-2.49)', () => {
  it('plays an event once within its cooldown — the squad’s, or each soldier’s own', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    const cd = CALLOUTS.events.contact.cooldown;
    expect(d.say('contact', near(1), EAR, 0)).not.toBeNull();
    expect(d.say('contact', near(2), EAR, 1)).toBeNull();
    expect(d.say('contact', near(2), EAR, cd - 0.01)).toBeNull();
    expect(d.say('contact', near(2), EAR, cd)).not.toBeNull();
    // Reloading is each soldier's: two can say it together, neither twice within it.
    expect(d.say('reloading', near(3), EAR, 100)).not.toBeNull();
    expect(d.say('reloading', near(4), EAR, 100)).not.toBeNull();
    expect(d.say('reloading', near(3), EAR, 100 + CALLOUTS.events.reloading.cooldown - 0.1)).toBeNull();
  });

  it('never has a soldier say two things at once', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    const first = d.say('hit', near(1), EAR, 0)!;
    expect(first.seconds).toBe(CHIRP);
    expect(d.speaking(1, 0.1)).toBe(true);
    expect(d.say('frag-out', near(1), EAR, 0.1)).toBeNull();
    expect(d.say('frag-out', near(2), EAR, 0.1)).not.toBeNull();
    expect(d.say('frag-out', near(1), EAR, CHIRP + CALLOUTS.speakerGapSeconds + 0.01)).not.toBeNull();
  });

  it('hears a near squadmate where they stand and a far one over the radio; you as yourself', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    const close = d.say('reloading', near(1, CALLOUTS.radioBeyondM - 1), EAR, 0)!;
    expect(close).toMatchObject({ radio: false, own: false, at: { x: CALLOUTS.radioBeyondM - 1, y: 0, z: 0 } });
    const distant = d.say('reloading', far(2, CALLOUTS.radioBeyondM + 1), EAR, 0)!;
    expect(distant).toMatchObject({ radio: true, at: null });
    expect(d.say('reloading', me, EAR, 0)).toMatchObject({ radio: false, own: true });
    // Your own soldier does not call contacts: you see them.
    expect(d.say('contact', me, EAR, 50)).toBeNull();
  });

  it('keeps one voice on the radio: the next waits its turn, the most urgent first, or is dropped when stale', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    expect(d.say('reloading', far(1), EAR, 0)!.radio).toBe(true);
    expect(d.onAir(0.1)).toBe(true);
    expect(d.say('enemy-down', far(2), EAR, 0.1)).toBeNull();
    expect(d.say('man-down', far(3), EAR, 0.2)).toBeNull();
    expect(d.update(0.3)).toEqual([]);
    const freeAt = CHIRP + CALLOUTS.radioGapSeconds;
    const next = d.update(freeAt);
    expect(next.map((p) => [p.event, p.slot])).toEqual([['man-down', 3]]);
    // Enemy-down has waited too long by the time the radio is free again.
    const later = Math.max(freeAt * 2, 0.1 + CALLOUTS.radioQueueSeconds) + 0.01;
    expect(d.update(later).map((p) => p.event)).toEqual([]);
    // A near line is not on the radio, so it plays while the radio is busy.
    expect(d.say('reloading', far(5), EAR, freeAt + 0.1)).toBeNull();
    expect(d.say('frag-out', near(4), EAR, freeAt + 0.1)).not.toBeNull();
  });

  it('plays a recorded line when there is one, cycling its variants, and the chirp — no error — when there is not', () => {
    const profile = VOICES.profiles[1]!.id;
    const key = `${profile}/frag-out.shout.dry`;
    const index = voiceIndex({ inputsHash: '', sampleRate: 24000, speakers: [], missing: [], lines: { [key]: [0, 1].map((v) => ({ file: `${profile}/frag-out.shout.dry.${v}.wav`, bytes: 1, lufs: -16, peakDb: -3, seconds: 0.7 })) } });
    const d = new CalloutDirector({ index, chirpSeconds: CHIRP });
    const a = d.say('frag-out', near(1), EAR, 0)!;
    expect(a).toMatchObject({ file: `voice/${profile}/frag-out.shout.dry.0.wav`, seconds: 0.7 });
    const b = d.say('frag-out', near(1), EAR, 10)!;
    expect(b.file).toBe(`voice/${profile}/frag-out.shout.dry.1.wav`);
    // The radio version was not recorded: the chirp, over the radio.
    expect(d.say('frag-out', far(1), EAR, 20)).toMatchObject({ file: null, radio: true, seconds: CHIRP });
    expect(new CalloutDirector({ index: NO_VOICES }).say('grenade', near(2), EAR, 0)!.file).toBeNull();
  });

  it('the engine plays a voice file on the voice bus, and a missing one resolves false without throwing', async () => {
    const fake = fakeContext();
    const e = new AudioEngine({
      createContext: () => fake.ctx,
      fetchBytes: (file) => (file.startsWith('voice/') && !file.includes('missing') ? Promise.resolve(new ArrayBuffer(8)) : file.startsWith('voice/') ? Promise.reject(new Error('404')) : Promise.resolve(new ArrayBuffer(8))),
    });
    await e.unlock();
    await expect(e.playFile('voice/s1/missing.wav', 'voice')).resolves.toBe(false);
    await expect(e.playFile('voice/s1/copy.normal.dry.0.wav', 'voice', { at: { x: 5, y: 0, z: 0 } })).resolves.toBe(true);
    expect(fake.made.filter((n) => n.kind === 'panner')).toHaveLength(1);
  });
});

const soldier = (slot: number, x: number, z: number, extra: Partial<SquadSoldier> = {}): SquadSoldier => ({ netId: slot + 1, slot, at: { x, y: 0, z }, vitality: 'alive', reloading: false, reviverSlot: -1, self: slot === 0, ...extra });
const view = (patch: Partial<CalloutView> = {}): CalloutView => ({ soldiers: [soldier(0, 0, 0), soldier(1, 3, 0), soldier(2, -3, 0)], enemies: [], projectiles: [], orders: [], mission: null, boxes: [], ...patch });
const mission = (patch: Partial<MissionView> = {}): MissionView => ({ state: 'progress', attempt: 1, objective: 0, objectives: 1, type: 'clear-and-hold', label: 'Clear the compound', progress: 0, goal: 900, satisfied: false, ...patch });

describe('the callout watcher (T-2.49)', () => {
  it('calls a new contact by a squadmate who can see it — not a wall between, not twice while it stays seen, the MG by name', () => {
    const w = new CalloutWatcher();
    const wall = boxFrom({ id: 'wall', x: 0, y: 0, z: 20, w: 40, h: 4, d: 1 }, 'cover');
    w.update(view({ boxes: [wall] }), 0);
    const hidden = view({ boxes: [wall], enemies: [{ netId: 50, at: { x: 0, y: 0, z: 40 }, vitality: 'alive', mg: false }] });
    expect(w.update(hidden, 1)).toEqual([]);
    const open = { ...hidden, boxes: [] };
    expect(w.update(open, 2)).toEqual([{ event: 'contact', slot: 1 }]);
    expect(w.update(open, 3)).toEqual([]);
    const mg = { ...open, enemies: [...open.enemies, { netId: 51, at: { x: 5, y: 0, z: 40 }, vitality: 'alive' as const, mg: true }] };
    expect(w.update(mg, 4)).toEqual([{ event: 'contact-mg', slot: 1 }]);
    // Out of sight long enough, it is a new contact again.
    expect(w.update(hidden, 5)).toEqual([]);
    expect(w.update(open, 5 + CALLOUTS.sight.forgetSeconds + 1)).toEqual([{ event: 'contact', slot: 1 }]);
    expect(canSee({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 40 }, [wall], 100)).toBe(false);
    expect(canSee({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 400 }, [], 100)).toBe(false);
  });

  it('calls reloads, a squad grenade thrown, and someone else’s landing near', () => {
    const w = new CalloutWatcher();
    w.update(view(), 0);
    const reload = view({ soldiers: [soldier(0, 0, 0), soldier(1, 3, 0, { reloading: true }), soldier(2, -3, 0)] });
    expect(w.update(reload, 1)).toEqual([{ event: 'reloading', slot: 1 }]);
    expect(w.update(reload, 2)).toEqual([]);
    const frag = view({ projectiles: [{ netId: 70, grenade: true, ownerSlot: 2, at: { x: -3, y: 1.5, z: 0 } }] });
    expect(w.update(frag, 3)).toEqual([{ event: 'frag-out', slot: 2 }]);
    expect(w.update(frag, 4)).toEqual([]);
    const theirs = view({ projectiles: [{ netId: 71, grenade: true, ownerSlot: 7, at: { x: 30, y: 0, z: 0 } }] });
    expect(w.update(theirs, 5)).toEqual([]);
    const landed = view({ projectiles: [{ netId: 71, grenade: true, ownerSlot: 7, at: { x: 5, y: 0, z: 0 } }] });
    expect(w.update(landed, 6)).toEqual([{ event: 'grenade', slot: 1 }]);
    expect(w.update(landed, 7)).toEqual([]);
  });

  it('calls a hit, a soldier going down (and the nearest other’s man down), the revive, and the soldier up again', () => {
    const w = new CalloutWatcher();
    w.update(view(), 0);
    w.onShot(99, 3, 20, view(), 1);
    expect(w.update(view(), 1)).toEqual([{ event: 'hit', slot: 2 }]);
    const down = view({ soldiers: [soldier(0, 0, 0), soldier(1, 3, 0), soldier(2, -3, 0, { vitality: 'downed' })] });
    expect(w.update(down, 2)).toEqual([
      { event: 'down', slot: 2 },
      { event: 'man-down', slot: 1 },
    ]);
    const reviving = view({ soldiers: [soldier(0, 0, 0), soldier(1, -2.5, 0), soldier(2, -3, 0, { vitality: 'downed', reviverSlot: 1 })] });
    expect(w.update(reviving, 3)).toEqual([{ event: 'reviving', slot: 1 }]);
    expect(w.update(view({ soldiers: [soldier(0, 0, 0), soldier(1, -2.5, 0), soldier(2, -3, 0)] }), 6)).toEqual([{ event: 'revived', slot: 1 }]);
  });

  it('credits an enemy down to the squadmate whose round or blast hurt it last, and to nobody after too long', () => {
    const w = new CalloutWatcher();
    const alive = (id: number) => ({ netId: id, at: { x: 0, y: 0, z: 200 }, vitality: 'alive' as const, mg: false });
    const dead = (id: number) => ({ ...alive(id), vitality: 'dead' as const });
    // Slot 2's grenade, seen in the air before it went off.
    w.update(view({ enemies: [alive(50), alive(51), alive(52)], projectiles: [{ netId: 80, grenade: true, ownerSlot: 2, at: { x: 0, y: 1, z: 190 } }] }), 0);
    w.onShot(2, 50, 40, view({ enemies: [alive(50), alive(51), alive(52)] }), 1);
    w.onDetonation(80, [51], 1);
    w.onDetonation(81, [52], 1);
    w.onShot(2, 52, 40, view({ enemies: [alive(50), alive(51), alive(52)] }), 1);
    expect(w.update(view({ enemies: [dead(50), dead(51), alive(52)] }), 1.5)).toEqual([
      { event: 'enemy-down', slot: 1 },
      { event: 'enemy-down', slot: 2 },
    ]);
    expect(w.update(view({ enemies: [dead(50), dead(51), dead(52)] }), 1 + CALLOUTS.killCreditSeconds + 1)).toEqual([]);
  });

  it('acknowledges each new order by the bot given it, says when it cannot, and calls the objective', () => {
    const w = new CalloutWatcher();
    w.update(view({ mission: mission() }), 0);
    const move = { slot: 1, order: 'move' as const, point: { x: 5, y: 0, z: 5 }, target: null, from: 0 };
    expect(w.update(view({ orders: [move], mission: mission() }), 1)).toEqual([{ event: 'order-move', slot: 1 }]);
    expect(w.update(view({ orders: [move], mission: mission() }), 2)).toEqual([]);
    expect(w.update(view({ orders: [move, { ...move, slot: 2, order: 'hold' }], mission: mission() }), 3)).toEqual([{ event: 'order-hold', slot: 2 }]);
    w.onOrderFailed(1);
    expect(w.update(view({ orders: [], mission: mission() }), 4)).toEqual([{ event: 'order-failed', slot: 1 }]);
    expect(w.update(view({ mission: mission({ satisfied: true }) }), 5)).toEqual([{ event: 'objective-clear', slot: 1 }]);
    expect(w.update(view({ mission: mission({ satisfied: true, progress: 450 }) }), 6)).toEqual([{ event: 'objective-hold', slot: 1 }]);
    expect(w.update(view({ mission: mission({ state: 'complete', satisfied: true, progress: 900 }) }), 7)).toEqual([{ event: 'objective-done', slot: 1 }]);
    w.onScriptCallout('man-down', view());
    w.onScriptCallout('not-an-event', view());
    expect(w.update(view(), 8)).toEqual([{ event: 'man-down', slot: 1 }]);
  });
});
