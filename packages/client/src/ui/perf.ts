/**
 * Frame time, measured (T-5.04). `FrameStats` keeps the last frames' times
 * and the worst draw calls and triangles over the same window, and sums them
 * up the way the budget is read — median and 95th-percentile frame time, the
 * frame rate those mean. `?perf` draws it in a corner (`createPerfOverlay`)
 * for the owner on target hardware, and publishes the same numbers on
 * `window.__sandlinePerf` for `pnpm perf:frame` to read.
 */

export interface PerfSummary {
  frames: number;
  medianMs: number;
  p95Ms: number;
  worstMs: number;
  /** The frame rate the median frame time is. */
  fps: number;
  drawCalls: number;
  triangles: number;
}

export class FrameStats {
  private readonly times: number[] = [];
  private readonly calls: number[] = [];
  private readonly tris: number[] = [];

  constructor(private readonly window = 600) {}

  push(frameMs: number, drawCalls: number, triangles: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    this.times.push(frameMs);
    this.calls.push(drawCalls);
    this.tris.push(triangles);
    if (this.times.length > this.window) {
      this.times.shift();
      this.calls.shift();
      this.tris.shift();
    }
  }

  clear(): void {
    this.times.length = 0;
    this.calls.length = 0;
    this.tris.length = 0;
  }

  summary(): PerfSummary {
    const sorted = [...this.times].sort((a, b) => a - b);
    const at = (q: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
    const median = at(0.5);
    return {
      frames: sorted.length,
      medianMs: median,
      p95Ms: at(0.95),
      worstMs: sorted.length ? sorted[sorted.length - 1]! : 0,
      fps: median > 0 ? 1000 / median : 0,
      drawCalls: this.calls.reduce((m, c) => Math.max(m, c), 0),
      triangles: this.tris.reduce((m, t) => Math.max(m, t), 0),
    };
  }
}

/** The overlay's text. */
export function perfText(s: PerfSummary): string {
  return [
    `${s.fps.toFixed(0)} fps  (median ${s.medianMs.toFixed(1)} ms, p95 ${s.p95Ms.toFixed(1)} ms, worst ${s.worstMs.toFixed(1)} ms over ${s.frames})`,
    `draw calls ${s.drawCalls} / 300   triangles ${s.triangles.toLocaleString('en')}`,
  ].join('\n');
}

export function createPerfOverlay(parent: HTMLElement): { update(s: PerfSummary): void } {
  const root = document.createElement('pre');
  root.id = 'perf';
  root.className = 'perf-overlay';
  parent.append(root);
  return {
    update(s) {
      root.textContent = perfText(s);
    },
  };
}
