/**
 * Placing a sound (T-2.45): a box between the ear and the source gives the
 * mix's low-pass and cut, a clear line gives none; the falloff and the
 * speed of sound follow distance, and your own sound is never delayed; the
 * voice limit steals the least important voice and drops a sound that
 * outranks nobody.
 */
import { describe, expect, it } from 'vitest';
import { MIX, boxFrom, dbToGain, falloffGain } from '@sandline/shared';
import { VoicePool, occlusion, place } from './spatial.ts';

const wall = boxFrom({ id: 'wall', x: 0, y: 0, z: 10, w: 6, h: 3, d: 0.3 }, 'cover');
const ear = { x: 0, y: 1.6, z: 0 };

describe('occlusion (T-2.45)', () => {
  it('a box between gives the attenuation; a clear line, or a source on the near face, gives none', () => {
    const behind = occlusion(ear, { x: 0, y: 1, z: 20 }, [wall], MIX);
    expect(behind).toEqual({ occluded: true, lowpassHz: MIX.occlusion.lowpassHz, gain: dbToGain(MIX.occlusion.gainDb) });
    expect(occlusion(ear, { x: 10, y: 1, z: 20 }, [wall], MIX)).toEqual({ occluded: false, lowpassHz: null, gain: 1 });
    expect(occlusion(ear, { x: 0, y: 1, z: 9.84 }, [wall], MIX).occluded).toBe(false);
    // Over the top of a 3 m wall: clear.
    expect(occlusion({ x: 0, y: 6, z: 0 }, { x: 0, y: 6, z: 20 }, [wall], MIX).occluded).toBe(false);
  });
});

describe('place (T-2.45)', () => {
  it('takes the class falloff and the occlusion for gain, and distance over the speed of sound for the start', () => {
    const far = { x: 30, y: 1.6, z: 0 };
    const p = place('weapon', far, ear, [wall], MIX);
    expect(p.distanceM).toBeCloseTo(30, 9);
    expect(p.gain).toBeCloseTo(falloffGain(MIX.classes.weapon.falloff, 30), 9);
    expect(p.delaySeconds).toBeCloseTo(30 / MIX.speedOfSound, 9);
    const hidden = place('weapon', { x: 0, y: 1, z: 30 }, ear, [wall], MIX);
    expect(hidden.lowpassHz).toBe(MIX.occlusion.lowpassHz);
    expect(hidden.gain).toBeCloseTo(falloffGain(MIX.classes.weapon.falloff, hidden.distanceM) * dbToGain(MIX.occlusion.gainDb), 9);
    // Your own shot: no delay, a higher priority.
    const own = place('weapon', far, ear, [], MIX, true);
    expect(own.delaySeconds).toBe(0);
    expect(own.priority).toBeGreaterThan(p.priority);
    // Unplaced (the UI): full gain, no delay.
    expect(place('ui', null, ear, [], MIX)).toMatchObject({ gain: 1, lowpassHz: null, delaySeconds: 0 });
  });
});

describe('VoicePool (T-2.45)', () => {
  it('takes free voices, then steals the least important (oldest of equals), and drops what outranks nobody', () => {
    const pool = new VoicePool<string>(3);
    expect(pool.acquire('a', 10)).toEqual({ ok: true, stolen: null });
    expect(pool.acquire('b', 5)).toEqual({ ok: true, stolen: null });
    expect(pool.acquire('c', 5)).toEqual({ ok: true, stolen: null });
    // Full: a louder one steals the oldest of the two quietest.
    expect(pool.acquire('d', 8)).toEqual({ ok: true, stolen: 'b' });
    expect(pool.items().sort()).toEqual(['a', 'c', 'd']);
    // No louder than the quietest: dropped, nothing stopped.
    expect(pool.acquire('e', 5)).toEqual({ ok: false });
    pool.release('c');
    expect(pool.acquire('e', 1)).toEqual({ ok: true, stolen: null });
    expect(pool.size).toBe(3);
  });
});
