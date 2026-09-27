/**
 * U-012: the missing voice cues, wired end to end short of the recordings.
 *
 * The watcher: hit, down and dead are three transitions, not two — a dying
 * breath only when a soldier dies, never when they only go down, never
 * twice for one death and never on a respawn; the same snapshot again says
 * nothing; an enemy opening fire (hit or miss) is an engagement, once per
 * quiet spell; and a reset (a rejoin, a retry) forgets it all without
 * calling out what it finds.
 *
 * The director: three routes with their own rules — squad dialogue near or
 * on the radio, a body's sound only where the body is (never on the radio,
 * involuntary, silent until recorded), an enemy's shout only where it stands
 * in the enemy's voice — every unrecorded play labelled a placeholder, and a
 * reset that lets nothing from before hold a line back or play late.
 */
import { describe, expect, it } from 'vitest';
import { CALLOUTS, VOICES } from '@sandline/shared';
import { type CalloutSpeaker, CalloutDirector, voiceIndex } from './callouts.ts';
import { type CalloutView, CalloutWatcher, type SeenEnemy, type SquadSoldier } from './calloutEvents.ts';

const EAR = { x: 0, y: 1.6, z: 0 };
const CHIRP = 0.5;
const soldier = (slot: number, x: number, extra: Partial<SquadSoldier> = {}): SquadSoldier => ({ netId: slot + 1, slot, at: { x, y: 0, z: 0 }, vitality: 'alive', reloading: false, reviverSlot: -1, self: slot === 0, ...extra });
const enemy = (netId: number, extra: Partial<SeenEnemy> = {}): SeenEnemy => ({ netId, at: { x: 0, y: 0, z: 300 }, vitality: 'alive', mg: false, ...extra });
const view = (patch: Partial<CalloutView> = {}): CalloutView => ({ soldiers: [soldier(0, 0), soldier(1, 3), soldier(2, -3)], enemies: [], projectiles: [], orders: [], mission: null, boxes: [], ...patch });
const withSlot2 = (vitality: SquadSoldier['vitality']) => view({ soldiers: [soldier(0, 0), soldier(1, 3), soldier(2, -3, { vitality })] });
const events = (cues: { event: string }[]) => cues.map((c) => c.event);

describe('hit, down and dead as distinct transitions (U-012)', () => {
  it('down is a cry and words; dying is a last breath — only on death, from down or from up, once', () => {
    const w = new CalloutWatcher();
    w.update(view(), 0);
    expect(events(w.update(withSlot2('downed'), 1))).toEqual(['downed-cry', 'down', 'man-down']);
    // The same snapshot again, and again: nothing new.
    expect(w.update(withSlot2('downed'), 2)).toEqual([]);
    expect(w.update(withSlot2('downed'), 3)).toEqual([]);
    // Bled out: the last breath, said by the one dying — not a second downed cry.
    expect(w.update(withSlot2('dead'), 4)).toEqual([{ event: 'dying', slot: 2 }]);
    expect(w.update(withSlot2('dead'), 5)).toEqual([]);
    // A respawn says nothing.
    expect(w.update(withSlot2('alive'), 20)).toEqual([]);
    // Killed outright: the last breath, and no downed cry, no "man down".
    expect(w.update(withSlot2('dead'), 21)).toEqual([{ event: 'dying', slot: 2 }]);
  });

  it('a round into a squadmate who is up is a grunt and words; one into a downed or dead squadmate is neither', () => {
    const w = new CalloutWatcher();
    w.update(view(), 0);
    w.onShot(99, 3, 20, view(), 1);
    expect(events(w.update(view(), 1))).toEqual(['hit', 'hit-grunt']);
    w.onShot(99, 3, 20, withSlot2('downed'), 2);
    w.onShot(99, 3, 20, withSlot2('dead'), 2);
    w.onShot(99, 3, 0, view(), 2);
    expect(events(w.update(withSlot2('downed'), 2))).not.toContain('hit-grunt');
  });
});

describe('the enemy opening fire (U-012)', () => {
  it('an enemy\'s first shot — hit or miss — is an engagement it shouts; not again until it has been quiet a while', () => {
    const w = new CalloutWatcher();
    const v = view({ enemies: [enemy(50), enemy(51)] });
    w.update(v, 0);
    // A miss (no target) still opens fire.
    w.onShot(50, 0, 0, v, 1);
    expect(w.update(v, 1)).toEqual([{ event: 'enemy-engage', slot: -1, enemy: 50 }]);
    // It keeps firing: the same engagement.
    for (let t = 2; t < 2 + CALLOUTS.engageQuietSeconds; t += 1) w.onShot(50, 3, 10, v, t);
    expect(events(w.update(v, 12))).not.toContain('enemy-engage');
    // Another enemy opens fire: its own.
    w.onShot(51, 0, 0, v, 12);
    expect(w.update(v, 12)).toEqual([{ event: 'enemy-engage', slot: -1, enemy: 51 }]);
    // Quiet past the spell, then firing again: a new engagement.
    const later = 12 + CALLOUTS.engageQuietSeconds + 1;
    w.onShot(50, 0, 0, v, later);
    expect(w.update(v, later)).toEqual([{ event: 'enemy-engage', slot: -1, enemy: 50 }]);
    // A squadmate's shot is not an enemy's; a dead enemy shouts nothing.
    w.onShot(2, 50, 10, v, later + 1);
    w.onShot(51, 0, 0, view({ enemies: [enemy(50), enemy(51, { vitality: 'dead' })] }), later + 30);
    expect(events(w.update(v, later + 30))).not.toContain('enemy-engage');
  });
});

describe('a rejoin or a retry starts the callouts afresh (U-012)', () => {
  it('the watcher forgets what it saw and what was waiting, and its next look calls nothing out', () => {
    const w = new CalloutWatcher();
    w.update(view({ enemies: [enemy(50)] }), 0);
    w.onShot(50, 3, 20, view({ enemies: [enemy(50)] }), 1);
    w.onOrderFailed(1);
    w.reset();
    // What was waiting is gone; the world as it is now — a squadmate down, a new order — is learned, not called.
    const after = view({ soldiers: [soldier(0, 0), soldier(1, 3), soldier(2, -3, { vitality: 'downed' })], orders: [{ slot: 1, order: 'hold', point: null, target: null, from: 0 }] });
    expect(w.update(after, 2)).toEqual([]);
    expect(w.update(after, 3)).toEqual([]);
    // And it hears the next thing as new: the enemy's next shot is a fresh engagement.
    w.onShot(50, 0, 0, view({ enemies: [enemy(50)] }), 3.5);
    expect(events(w.update(after, 3.5))).toEqual(['enemy-engage']);
  });

  it('the director forgets its cooldowns, who is talking and the radio queue', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    const far = (slot: number): CalloutSpeaker => ({ slot, at: { x: 0, y: 0, z: 60 }, self: false });
    expect(d.say('contact', far(1), EAR, 0)).not.toBeNull();
    expect(d.say('man-down', far(2), EAR, 0.1)).toBeNull(); // waiting for the radio
    d.reset();
    expect(d.onAir(0.2)).toBe(false);
    expect(d.speaking(1, 0.2)).toBe(false);
    // Nothing from before plays late...
    expect(d.update(0.2)).toEqual([]);
    // ...and nothing from before holds a line back.
    expect(d.say('contact', far(1), EAR, 0.3)).not.toBeNull();
  });
});

describe('three routes, heard three ways (U-012)', () => {
  const body = (slot: number, m: number): CalloutSpeaker => ({ slot, at: { x: m, y: 0, z: 0 }, self: false });
  const shouter = (netId: number, m: number): CalloutSpeaker => ({ slot: -1, enemy: netId, at: { x: 0, y: 0, z: m }, self: false });

  it('a body\'s sound is heard where the body is, never on the radio, not at all past its reach — and holds nobody\'s words up', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    const reach = CALLOUTS.routes.body.audibleM;
    const grunt = d.say('hit-grunt', body(1, reach - 1), EAR, 0)!;
    expect(grunt).toMatchObject({ route: 'body', radio: false, at: { x: reach - 1, y: 0, z: 0 } });
    // Past its reach: nothing, and no cooldown spent — nearer, it is heard at once.
    expect(d.say('dying', body(2, CALLOUTS.radioBeyondM + 30), EAR, 1)).toBeNull();
    expect(d.say('dying', body(2, 5), EAR, 1)).toMatchObject({ route: 'body', radio: false });
    // Involuntary: the grunt did not make slot 1 busy, and words do not silence a grunt.
    expect(d.speaking(1, 0.01)).toBe(false);
    expect(d.say('hit', body(1, 5), EAR, 0.01)).toMatchObject({ route: 'radio' });
    expect(d.say('hit-grunt', body(1, 5), EAR, CALLOUTS.events['hit-grunt'].cooldown + 0.02)).not.toBeNull();
    // Your own: your own, whatever the reach.
    expect(d.say('downed-cry', { slot: 0, at: null, self: true }, EAR, 2)).toMatchObject({ own: true, radio: false });
  });

  it('an enemy\'s shout is its own: in the enemy\'s voice, where it stands, never on the radio; nobody else may say it, nor it anything else', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    const shout = d.say('enemy-engage', shouter(52, 60), EAR, 0)!;
    expect(shout).toMatchObject({ route: 'shout', enemy: 52, slot: -1, radio: false, at: { x: 0, y: 0, z: 60 } });
    expect(d.say('enemy-engage', { slot: 1, at: { x: 1, y: 0, z: 0 }, self: false }, EAR, 100)).toBeNull();
    expect(d.say('contact', shouter(52, 10), EAR, 100)).toBeNull();
    expect(d.say('enemy-engage', shouter(53, CALLOUTS.routes.shout.audibleM + 1), EAR, 200)).toBeNull();
    // Recorded, it is the enemy profile the netId picks, dry.
    const { line, style } = CALLOUTS.events['enemy-engage'].lines[0]!;
    const profile = VOICES.enemyProfiles[52 % VOICES.enemyProfiles.length]!.id;
    const key = `${profile}/${line}.${style}.dry`;
    const recorded = new CalloutDirector({ chirpSeconds: CHIRP, index: voiceIndex({ inputsHash: '', sampleRate: 24000, speakers: [], missing: [], lines: { [key]: [{ file: `${profile}/${line}.${style}.dry.0.wav`, bytes: 1, lufs: -16, peakDb: -1, seconds: 0.9 }] } }) });
    expect(recorded.say('enemy-engage', shouter(52, 30), EAR, 0)).toMatchObject({ file: `voice/${profile}/${line}.${style}.dry.0.wav`, isPlaceholder: false, placeholder: null, seconds: 0.9 });
  });

  it('every unrecorded play says it is a placeholder: the chirp for dialogue, silence for a body or an enemy', () => {
    const d = new CalloutDirector({ chirpSeconds: CHIRP });
    expect(d.say('contact', body(1, 10), EAR, 0)).toMatchObject({ file: null, isPlaceholder: true, placeholder: CALLOUTS.chirp, seconds: CHIRP });
    expect(d.say('hit-grunt', body(2, 5), EAR, 0)).toMatchObject({ file: null, isPlaceholder: true, placeholder: null, seconds: 0 });
    expect(d.say('enemy-engage', shouter(50, 40), EAR, 0)).toMatchObject({ file: null, isPlaceholder: true, placeholder: null });
    // Each route's own level.
    expect(d.say('downed-cry', body(3, 5), EAR, 0)!.gain).toBeCloseTo(10 ** (CALLOUTS.routes.body.gainDb / 20), 9);
  });
});
