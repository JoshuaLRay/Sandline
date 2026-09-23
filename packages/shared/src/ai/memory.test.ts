import { describe, expect, it } from 'vitest';
import {
  MEMORY,
  type MemoryConfig,
  beginThink,
  chooseTarget,
  confidenceAt,
  createTargetMemory,
  forgetTarget,
  isForgotten,
  parseMemoryConfig,
  rememberHeard,
  rememberSeen,
  targetScore,
} from './memory.ts';
import { type StimulusConfig, parseStimulusConfig } from './stimuli.ts';

/** Our own numbers, so retuning memory.json never changes what these prove. */
const RAW = { forgetSeconds: 10, threatSeconds: 3, visibleWeight: 4, proximityM: 20, threatFactor: 2, downedFactor: 0 };
const M: MemoryConfig = parseMemoryConfig(RAW);
const S: StimulusConfig = parseStimulusConfig({
  nearMissM: 1,
  kinds: {
    shot: { radiusM: 100, confidence: 0.8 },
    impact: { radiusM: 10, confidence: 0.3 },
    nearMiss: { radiusM: 5, confidence: 0.5 },
    detonation: { radiusM: 80, confidence: 0.3 },
    sprint: { radiusM: 12, confidence: 0.6 },
  },
});
const HERE = { x: 0, y: 0, z: 0 };
const at = (x: number, z: number) => ({ x, y: 0, z });

describe('target memory (T-3.14)', () => {
  it('parses a full row and the committed one, and refuses malformed ones', () => {
    expect(M).toEqual(RAW);
    expect(MEMORY.forgetSeconds).toBeGreaterThan(0);
    expect(MEMORY.visibleWeight).toBeGreaterThanOrEqual(1);
    for (const raw of [
      null,
      [],
      { ...RAW, extra: 1 },
      { ...RAW, forgetSeconds: 0 },
      { ...RAW, visibleWeight: 0.5 },
      { ...RAW, threatFactor: 0.5 },
      { ...RAW, downedFactor: 2 },
      { ...RAW, proximityM: 'near' },
    ]) {
      expect(() => parseMemoryConfig(raw)).toThrow();
    }
  });

  it("an unseen shooter's last known position is where the shot came from", () => {
    const memory = createTargetMemory();
    rememberHeard(memory, { kind: 'shot', at: { x: 30, y: 1.6, z: -12 }, sourceNetId: 4 }, 1, M, S);
    const entry = memory.entries.get(4)!;
    expect({ x: entry.x, y: entry.y, z: entry.z }).toEqual({ x: 30, y: 1.6, z: -12 });
    expect(entry.visible).toBe(false);
    expect(entry.confidence).toBe(0.8);
    // It moves and fires again: the position follows the newest shot.
    rememberHeard(memory, { kind: 'shot', at: { x: 25, y: 1.6, z: -10 }, sourceNetId: 4 }, 2, M, S);
    expect(memory.entries.get(4)!.x).toBe(25);
    // A sprint locates too.
    rememberHeard(memory, { kind: 'sprint', at: at(5, 5), sourceNetId: 2 }, 2, M, S);
    expect(memory.entries.get(2)!.z).toBe(5);
  });

  it('sight beats sound: a heard shot does not move a target in view', () => {
    const memory = createTargetMemory();
    rememberSeen(memory, 3, at(10, 0), 1, false);
    rememberHeard(memory, { kind: 'shot', at: at(40, 0), sourceNetId: 3 }, 1.05, M, S);
    expect(memory.entries.get(3)!.x).toBe(10);
    expect(memory.entries.get(3)!.confidence).toBe(1);
  });

  it('impacts, near misses and blasts tell nothing of where, only that it is shooting', () => {
    const memory = createTargetMemory();
    rememberHeard(memory, { kind: 'nearMiss', at: at(1, 1), sourceNetId: 5 }, 1, M, S);
    expect(memory.entries.has(5)).toBe(false);
    rememberHeard(memory, { kind: 'shot', at: at(50, 0), sourceNetId: 5 }, 1, M, S);
    rememberHeard(memory, { kind: 'impact', at: at(1, 1), sourceNetId: 5 }, 1, M, S);
    const entry = memory.entries.get(5)!;
    expect(entry.x).toBe(50);
    expect(entry.threatAt).toBe(1);
    // Nobody in particular tells memory nothing.
    rememberHeard(memory, { kind: 'shot', at: at(3, 3), sourceNetId: 0 }, 1, M, S);
    expect(memory.entries.has(0)).toBe(false);
  });

  it('memory decays to forgotten on its data-set time', () => {
    const memory = createTargetMemory();
    rememberHeard(memory, { kind: 'shot', at: at(20, 0), sourceNetId: 4 }, 100, M, S);
    rememberSeen(memory, 3, at(10, 0), 100, false);
    beginThink(memory, 100.1, M); // 3 goes out of sight after this sighting
    let last = Infinity;
    for (let t = 100; t < 110; t += 0.5) {
      const c = confidenceAt(memory.entries.get(3)!, t, M);
      expect(c).toBeLessThanOrEqual(last);
      last = c;
    }
    expect(confidenceAt(memory.entries.get(4)!, 105, M)).toBeCloseTo(0.4, 9);
    beginThink(memory, 109.99, M);
    expect([...memory.entries.keys()]).toEqual([4, 3]);
    expect(isForgotten(memory.entries.get(3)!, 110, M)).toBe(true);
    beginThink(memory, 110, M);
    expect(memory.entries.size).toBe(0);
    expect(chooseTarget(memory, HERE, 110, M)).toBeNull();
  });

  it('a fresh sound tops up a fading memory, never lowers it', () => {
    const memory = createTargetMemory();
    rememberSeen(memory, 3, at(10, 0), 0, false);
    beginThink(memory, 1, M);
    // At 1 s confidence is 0.9; a sprint (0.6) moves it but keeps 0.9.
    rememberHeard(memory, { kind: 'sprint', at: at(12, 0), sourceNetId: 3 }, 1, M, S);
    expect(memory.entries.get(3)!.confidence).toBeCloseTo(0.9, 9);
    expect(memory.entries.get(3)!.updatedAt).toBe(1);
  });

  it('a visible target beats a remembered one, even nearer and freshly heard', () => {
    for (const [seenAt, heardAt] of [
      [5, 5],
      [30, 10],
      [60, 20],
      [80, 30],
    ] as const) {
      for (const config of [M, MEMORY]) {
        const memory = createTargetMemory();
        rememberHeard(memory, { kind: 'shot', at: at(heardAt, 0), sourceNetId: 2 }, 0, config, S);
        rememberSeen(memory, 3, at(0, seenAt), 0, false);
        expect(chooseTarget(memory, HERE, 0, config)).toBe(3);
      }
    }
  });

  it('prefers the close, and the one shooting at it', () => {
    const memory = createTargetMemory();
    rememberSeen(memory, 2, at(40, 0), 0, false);
    rememberSeen(memory, 3, at(0, 20), 0, false);
    expect(chooseTarget(memory, HERE, 0, M)).toBe(3);
    rememberHeard(memory, { kind: 'nearMiss', at: at(0.5, 0), sourceNetId: 2 }, 0, M, S);
    // 4 × 1/3 × 2 beats 4 × 1/2.
    expect(chooseTarget(memory, HERE, 0, M)).toBe(2);
    // The threat wears off.
    expect(chooseTarget(memory, HERE, 3.5, M)).toBe(3);
  });

  it('a downed target is chosen only when nothing else is known', () => {
    for (const config of [M, MEMORY]) {
      const memory = createTargetMemory();
      rememberSeen(memory, 2, at(2, 0), 0, true);
      expect(chooseTarget(memory, HERE, 0, config)).toBe(2);
      // Anything else known at all — far, unseen, nearly forgotten — comes first.
      rememberHeard(memory, { kind: 'impact', at: at(1, 0), sourceNetId: 2 }, 0, config, S);
      rememberHeard(memory, { kind: 'sprint', at: at(0, 90), sourceNetId: 5 }, 0, config, S);
      expect(chooseTarget(memory, HERE, config.forgetSeconds - 0.01, config)).toBe(5);
      forgetTarget(memory, 5);
      expect(chooseTarget(memory, HERE, 0, config)).toBe(2);
    }
  });

  it('a soft downed factor is a discount, not a veto', () => {
    const soft = parseMemoryConfig({ ...RAW, downedFactor: 0.5 });
    const memory = createTargetMemory();
    rememberSeen(memory, 2, at(2, 0), 0, true);
    rememberHeard(memory, { kind: 'shot', at: at(60, 0), sourceNetId: 5 }, 0, soft, S);
    expect(targetScore(memory.entries.get(2)!, HERE, 0, soft)).toBeGreaterThan(2 * targetScore(memory.entries.get(5)!, HERE, 0, soft));
    expect(chooseTarget(memory, HERE, 0, soft)).toBe(2);
  });
});
