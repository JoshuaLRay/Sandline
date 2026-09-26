/**
 * The engine headless (T-2.45): driven with a fake audio context, it loads
 * every render on unlock, plays a placed sound through a panner, a gain and
 * (behind a box) a low-pass, starts a distant one late by the speed of sound,
 * keeps to the voice limit by priority, never plays one variant twice in a
 * row, and applies the three volumes.
 */
import { describe, expect, it } from 'vitest';
import { MIX, SOUNDS, boxFrom, parseSounds, type MixConfig } from '@sandline/shared';
import { AudioEngine, nextVariant } from './engine.ts';
import { type FakeNode, fakeContext } from './fakeAudio.ts';

/** A test recipe set: a UI click and a two-variant gunshot, as the engine needs them (bounds are the renderer's concern). */
const TEST_SOUNDS = parseSounds({
  sounds: {
    click: { class: 'ui', seconds: 0.05, bounds: { peakDb: [-6, 0], rmsDb: [-60, 0], seconds: [0, 0.05] }, layers: [{ source: { kind: 'impulse' }, envelope: { attack: 0, decay: 0.01 } }] },
    shot: { class: 'weapon', seconds: 0.3, variants: 3, bounds: { peakDb: [-6, 0], rmsDb: [-60, 0], seconds: [0, 0.3] }, layers: [{ source: { kind: 'noise' }, envelope: { attack: 0, decay: 0.1 } }] },
  },
});

async function engine(mix: MixConfig = MIX) {
  const fake = fakeContext();
  const fetched: string[] = [];
  const e = new AudioEngine({
    createContext: () => fake.ctx,
    fetchBytes: (file) => {
      fetched.push(file);
      return Promise.resolve(new ArrayBuffer(16));
    },
    sounds: TEST_SOUNDS,
    mix,
  });
  await e.unlock();
  return { e, fake, fetched };
}

/** The chain from a source to where it ends, by kind. */
function chain(from: FakeNode): string[] {
  const out: string[] = [];
  let n: FakeNode | undefined = from;
  while (n) {
    out.push(n.kind);
    n = n.connections[0];
  }
  return out;
}

describe('the audio engine, headless (T-2.45)', () => {
  it('plays nothing before unlock, and loads every variant of every sound on it', async () => {
    const cold = new AudioEngine({ createContext: () => fakeContext().ctx, fetchBytes: () => Promise.resolve(new ArrayBuffer(1)), sounds: TEST_SOUNDS });
    expect(cold.play('click')).toBe(false);
    const { e, fetched } = await engine();
    expect(e.ready).toBe(true);
    expect(fetched.sort()).toEqual(['click.0.wav', 'shot.0.wav', 'shot.1.wav', 'shot.2.wav']);
    expect(e.play('nope')).toBe(false);
  });

  it('routes a UI sound straight to the bus, and a placed one through its gain and a panner at the source', async () => {
    const { e, fake } = await engine();
    e.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(e.play('click')).toBe(true);
    const click = fake.made.filter((n) => n.kind === 'source').at(-1)!;
    expect(chain(click)).toEqual(['source', 'gain', 'gain', 'gain', 'destination']);
    expect(e.play('shot', { at: { x: 10, y: 1.6, z: 0 } })).toBe(true);
    const shot = fake.made.filter((n) => n.kind === 'source').at(-1)!;
    expect(chain(shot)).toEqual(['source', 'gain', 'panner', 'gain', 'gain', 'destination']);
    const panner = fake.made.filter((n) => n.kind === 'panner').at(-1)!;
    expect(panner['panningModel']).toBe('HRTF');
    expect((panner['positionX'] as { value: number }).value).toBe(10);
  });

  it('muffles a sound behind a box and starts a distant one late by the speed of sound', async () => {
    const { e, fake } = await engine();
    e.setWorld([boxFrom({ id: 'wall', x: 0, y: 0, z: 10, w: 6, h: 3, d: 0.3 }, 'cover')]);
    e.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(e.play('shot', { at: { x: 0, y: 1.6, z: 40 } })).toBe(true);
    const shot = fake.made.filter((n) => n.kind === 'source').at(-1)!;
    expect(chain(shot)[1]).toBe('filter');
    const start = fake.started.at(-1)!;
    expect(start.when).toBeCloseTo(10 + 40 / MIX.speedOfSound, 9);
    // Your own shot at the same place: no delay.
    e.play('shot', { at: { x: 5, y: 1.6, z: 0 }, own: true });
    expect(fake.started.at(-1)!.when).toBe(10);
  });

  it('keeps to the voice limit: a nearer shot steals a farther one, and a farther one than all is dropped', async () => {
    const { e, fake } = await engine({ ...MIX, voiceLimit: 2 });
    e.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(e.play('shot', { at: { x: 100, y: 0, z: 0 } })).toBe(true);
    expect(e.play('shot', { at: { x: 50, y: 0, z: 0 } })).toBe(true);
    expect(e.voices).toBe(2);
    expect(e.play('shot', { at: { x: 5, y: 0, z: 0 } })).toBe(true);
    const sources = fake.made.filter((n) => n.kind === 'source');
    expect(sources[0]!['stopped']).toBe(true);
    expect(e.play('shot', { at: { x: 300, y: 0, z: 0 } })).toBe(false);
    expect(e.voices).toBe(2);
    // One finishing frees its voice.
    (sources[1]!['onended'] as () => void)();
    expect(e.voices).toBe(1);
  });

  it('never plays one variant twice in a row, and applies the three volumes', async () => {
    const def = TEST_SOUNDS.sounds.get('shot')!;
    let last = -1;
    for (let i = 0; i < 20; i += 1) {
      const next = nextVariant(def, last);
      expect(next).not.toBe(last);
      last = next;
    }
    expect(nextVariant(TEST_SOUNDS.sounds.get('click')!, 0)).toBe(0);
    const { e, fake } = await engine();
    e.setVolumes({ master: 0.5, effects: 0.25, voice: 0.75 });
    const gains = fake.made.filter((n) => n.kind === 'gain').slice(0, 3).map((n) => (n['gain'] as { value: number }).value);
    expect(gains).toEqual([0.5, 0.25, 0.75]);
    // The committed recipes are what the page loads by default.
    expect(SOUNDS.sounds.size).toBeGreaterThan(0);
  });
});
