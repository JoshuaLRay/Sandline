/** Frame time, measured (T-5.04): the summary reads the budget's way. */
import { describe, expect, it } from 'vitest';
import { FrameStats, perfText } from './perf.ts';

describe('frame stats (T-5.04)', () => {
  it('gives the median, 95th percentile and worst frame, the fps the median is, and the worst draw calls and triangles', () => {
    const s = new FrameStats(100);
    for (let i = 0; i < 95; i++) s.push(16, 120, 50_000);
    for (let i = 0; i < 5; i++) s.push(40, 180, 90_000);
    const sum = s.summary();
    expect(sum).toMatchObject({ frames: 100, medianMs: 16, worstMs: 40, drawCalls: 180, triangles: 90_000 });
    expect(sum.p95Ms).toBe(40);
    expect(sum.fps).toBeCloseTo(62.5, 1);
    expect(perfText(sum)).toMatch(/^63 fps .*\ndraw calls 180 \/ 300/);
  });

  it('keeps only its window, ignores nonsense and clears', () => {
    const s = new FrameStats(3);
    for (const ms of [10, 20, 30, 40, Number.NaN, -1]) s.push(ms, 1, 1);
    expect(s.summary()).toMatchObject({ frames: 3, medianMs: 30, worstMs: 40 });
    s.clear();
    expect(s.summary()).toMatchObject({ frames: 0, fps: 0 });
  });
});
