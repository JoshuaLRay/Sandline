/**
 * The pointer-lock jump guard (QA: the view spun, rarely, early in a session).
 */
import { describe, expect, it } from 'vitest';
import { MOUSE_GUARD, MouseGuard } from './mouseGuard.ts';

function clocked() {
  let t = 1000;
  const guard = new MouseGuard(() => t);
  return { guard, advance: (ms: number) => (t += ms) };
}

describe('the mouse guard', () => {
  it('drops the one huge jump browsers report as the lock is taken, and keeps ordinary moves', () => {
    const { guard, advance } = clocked();
    guard.settle();
    expect(guard.accept(12, -3)).toBe(true);
    expect(guard.accept(-640, 210)).toBe(false);
    expect(guard.accept(MOUSE_GUARD.settleMaxPx + 1, 0)).toBe(false);
    expect(guard.accept(40, 8)).toBe(true);
    // Settled: a big move out of a build-up is a flick, and counts.
    advance(MOUSE_GUARD.settleMs + 1);
    expect(guard.accept(200, 0)).toBe(true);
    expect(guard.dropped).toBe(2);
  });

  it('lets a real flick through as it builds up, but not the same distance out of stillness', () => {
    const { guard, advance } = clocked();
    advance(10_000);
    for (const dx of [60, 140, 260, 380, 520, 600]) expect(guard.accept(dx, 0), `${dx}`).toBe(true);
    const still = clocked().guard;
    for (let i = 0; i < 20; i++) expect(still.accept(1, 0)).toBe(true);
    expect(still.accept(600, 0)).toBe(false);
    expect(still.accept(0, -900)).toBe(false);
    expect(still.accept(Number.NaN, 0)).toBe(false);
    // Under the spike size nothing is ever dropped, whatever came before.
    expect(still.accept(MOUSE_GUARD.spikePx, 0)).toBe(true);
  });
});
