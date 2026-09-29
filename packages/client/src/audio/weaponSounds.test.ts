/**
 * Weapon sounds in play (T-2.46): the near report close, the far report far
 * and both at equal power between; one report per trigger pull however many
 * pellets; a reload's stages once each as its progress crosses them; and
 * automatic fire at each gun's own cadence, through the engine, never plays
 * the same variant twice in a row.
 */
import { describe, expect, it } from 'vitest';
import { SOUNDS, WEAPONS, WEAPON_SOUNDS, getWeapon, shotIntervalSeconds } from '@sandline/shared';
import { AudioEngine } from './engine.ts';
import { fakeContext } from './fakeAudio.ts';
import { cycleSoundPlan, ReloadWatcher, ShotDeduper, gunSoundPlan } from './weaponSounds.ts';

describe('gunSoundPlan (T-2.46)', () => {
  it('plays the near report close, the far one far, and both at equal power between', () => {
    const { nearM, farM } = WEAPON_SOUNDS.crossfade;
    const gun = WEAPON_SOUNDS.guns['marksman']!;
    expect(gunSoundPlan('marksman', 0)).toEqual([{ sound: gun.near, gain: 1 }]);
    expect(gunSoundPlan('marksman', farM + 100)).toEqual([{ sound: gun.far, gain: 1 }]);
    const mid = gunSoundPlan('marksman', (nearM + farM) / 2);
    expect(mid.map((p) => p.sound)).toEqual([gun.near, gun.far]);
    expect(mid[0]!.gain ** 2 + mid[1]!.gain ** 2).toBeCloseTo(1, 9);
    expect(mid[0]!.gain).toBeCloseTo(mid[1]!.gain, 9);
    // A gun with no sounds of its own is heard as the carbine.
    expect(gunSoundPlan('railgun', 0)[0]!.sound).toBe(WEAPON_SOUNDS.guns['carbine']!.near);
  });
});

describe('ShotDeduper (T-2.46)', () => {
  it("hears one report for a shotgun's eight pellets, and the next pull after the window", () => {
    const d = new ShotDeduper(25);
    expect(d.accept(7, 1000)).toBe(true);
    for (let i = 0; i < 7; i += 1) expect(d.accept(7, 1000 + i)).toBe(false);
    expect(d.accept(9, 1001)).toBe(true);
    expect(d.accept(7, 1030)).toBe(true);
  });
});

describe('ReloadWatcher (T-2.46)', () => {
  it('plays out, in and bolt once each as the progress crosses them, and starts again after', () => {
    const w = new ReloadWatcher({ in: 0.5, bolt: 0.8 });
    expect(w.update(0)).toEqual([]);
    expect(w.update(0.01)).toEqual(['out']);
    expect(w.update(0.3)).toEqual([]);
    expect(w.update(0.6)).toEqual(['in']);
    expect(w.update(0.7)).toEqual([]);
    expect(w.update(0.95)).toEqual(['bolt']);
    expect(w.update(1)).toEqual([]);
    expect(w.update(0)).toEqual([]);
    // U-007: a reload seen late (a remote soldier's, first snapshot mid-way) plays only the stage it has
    // just reached — not every cue it has passed, all at once.
    expect(w.update(0.9)).toEqual(['bolt']);
    expect(w.update(0)).toEqual([]);
    expect(w.update(0.6)).toEqual(['in']);
    expect(w.update(0.95)).toEqual(['bolt']);
    expect(w.update(0)).toEqual([]);
    // The first snapshot of a reload that has just begun still plays its start.
    expect(w.update(0.04)).toEqual(['out']);
  });

  it('a cancelled reload plays none of its later stages; a repeated snapshot replays nothing (U-007)', () => {
    const w = new ReloadWatcher({ in: 0.55, bolt: 0.85 });
    expect(w.update(0.02)).toEqual(['out']);
    expect(w.update(0.3)).toEqual([]);
    // Cancelled (a swap, death, a reset): the progress is gone, and so are its cues.
    expect(w.update(0)).toEqual([]);
    expect(w.update(0)).toEqual([]);
    // The same progress arriving again and again (snapshots repeating) is silent.
    const v = new ReloadWatcher({ in: 0.55, bolt: 0.85 });
    const heard: string[] = [];
    for (const p of [0.01, 0.01, 0.2, 0.2, 0.2, 0.56, 0.56, 0.7, 0.86, 0.86, 1, 1]) heard.push(...v.update(p));
    expect(heard).toEqual(['out', 'in', 'bolt']);
  });

  it('a new reload begun between two looks starts its cues again (U-007)', () => {
    const w = new ReloadWatcher({ in: 0.55, bolt: 0.85 });
    const heard: string[] = [];
    for (const p of [0.02, 0.6, 0.9, 0.97]) heard.push(...w.update(p));
    // Done and straight into the next before a look saw 0.
    for (const p of [0.03, 0.6, 0.9]) heard.push(...w.update(p));
    expect(heard).toEqual(['out', 'in', 'bolt', 'out', 'in', 'bolt']);
  });

  it('the local reload on the weapon clock: each cue once, at its stage, for every gun (U-007)', () => {
    for (const id of Object.keys(WEAPON_SOUNDS.guns)) {
      if (id === 'knife') continue; // A blade has no magazine to reload.
      const reload = getWeapon(id).reloadSeconds;
      const w = new ReloadWatcher();
      const at: Record<string, number> = {};
      // The page feeds it every tick: progress through the reload, 0 when none.
      for (let t = 0; t <= reload + 0.2; t += 1 / 30) {
        const p = t < reload ? Math.max(t / reload, 1e-6) : 0;
        for (const stage of w.update(p)) {
          expect(at[stage], `${id} ${stage} twice`).toBeUndefined();
          at[stage] = t;
        }
      }
      expect(at['out']).toBe(0);
      expect(Math.abs(at['in']! - WEAPON_SOUNDS.stages.in * reload)).toBeLessThanOrEqual(1 / 30 + 1e-9);
      expect(Math.abs(at['bolt']! - WEAPON_SOUNDS.stages.bolt * reload)).toBeLessThanOrEqual(1 / 30 + 1e-9);
    }
  });
});

describe('automatic fire through the engine (T-2.46)', () => {
  it("at each gun's cadence never plays the same variant twice in a row", async () => {
    const fake = fakeContext();
    const engine = new AudioEngine({ createContext: () => fake.ctx, fetchBytes: (file) => Promise.resolve(new TextEncoder().encode(file).buffer as ArrayBuffer), sounds: SOUNDS });
    await engine.unlock();
    engine.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    for (const id of Object.keys(WEAPONS)) {
      const near = WEAPON_SOUNDS.guns[id]!.near;
      const shots = Math.max(10, Math.round(2 / shotIntervalSeconds(WEAPONS[id]!)));
      const played: string[] = [];
      for (let i = 0; i < shots; i += 1) {
        expect(engine.play(near, { at: { x: 0, y: 1.6, z: 0 }, own: true })).toBe(true);
        const source = fake.made.filter((n) => n.kind === 'source').at(-1)!;
        played.push((source['buffer'] as { file: string }).file);
        // The voice finishes on its own before the next, as a short report at a gun's cadence would.
        (source['onended'] as () => void)();
      }
      for (let i = 1; i < played.length; i += 1) expect(played[i], `${id} shot ${i}`).not.toBe(played[i - 1]);
      expect(new Set(played).size).toBe(SOUNDS.sounds.get(near)!.variants);
    }
  });
});

describe('the bolt-action cycle (U-043)', () => {
  it('a bolt-action gun plans a bolt sound after its shot; no other gun does', () => {
    const plan = cycleSoundPlan('sniper-bolt-left');
    expect(plan).toEqual({ sound: 'bolt-cycle', delaySeconds: WEAPON_SOUNDS.guns['sniper-bolt-left']!.cycle!.delaySeconds });
    for (const id of Object.keys(WEAPONS)) if (id !== 'sniper-bolt-left') expect(cycleSoundPlan(id), id).toBeNull();
    expect(cycleSoundPlan('no-such-gun')).toBeNull();
  });
});
