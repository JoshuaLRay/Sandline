/**
 * Netgraph overlay (T-1.23).
 *
 * The instrument for judging netcode by eye. T-1.22 asserts the numbers in CI
 * and the link sliders make a bad connection reproducible; this is what turns
 * "it felt wrong just then" into a reading, while it is still on screen.
 *
 * Deliberately a canvas rather than DOM text. The numbers that matter here are
 * SHAPES — a correction spike, a burst of jitter, a gap where snapshots stopped
 * — and a digit that updates four times a second shows none of that. A
 * sparkline shows a spike that lasted 200 ms half a second after it happened,
 * which is exactly when a tester is asking what that was.
 */
import { type Panel, createPanel } from './Panel.ts';

/** Seconds of history at 60 fps, which is the width of the graphs. */
const SAMPLES = 180;

interface SeriesSpec {
  label: string;
  colour: string;
  /** Value now. */
  read: () => number;
  /** Formatted for the readout. */
  format: (v: number) => string;
  /**
   * Fixed upper bound for the vertical scale, or 0 to autoscale.
   *
   * Autoscale is the right default for anything whose interesting range is
   * unknown, but it lies about calm periods: a graph that rescales to its own
   * noise makes a flat line look eventful. Anything with a meaningful budget
   * gets a fixed ceiling so calm reads as calm.
   */
  ceiling: number;
}

class Series {
  private readonly values = new Float32Array(SAMPLES);
  private head = 0;
  private filled = 0;

  push(v: number): void {
    this.values[this.head] = Number.isFinite(v) ? v : 0;
    this.head = (this.head + 1) % SAMPLES;
    if (this.filled < SAMPLES) this.filled += 1;
  }

  get latest(): number {
    return this.values[(this.head - 1 + SAMPLES) % SAMPLES] ?? 0;
  }

  get peak(): number {
    let max = 0;
    for (let i = 0; i < this.filled; i += 1) {
      const v = this.values[i] ?? 0;
      if (v > max) max = v;
    }
    return max;
  }

  /** Oldest to newest, for drawing. */
  forEach(fn: (value: number, index: number) => void): void {
    for (let i = 0; i < this.filled; i += 1) {
      const idx = (this.head - this.filled + i + SAMPLES * 2) % SAMPLES;
      fn(this.values[idx] ?? 0, i);
    }
  }
}

export interface NetgraphSource {
  rttMs: number;
  jitterMs: number;
  snapshotGapRate: number;
  snapshotBytes: number;
  predictionErrorM: number;
  interpAheadTicks: number;
  tickDrift: number;
  correctionRate: number;
}

const ROW_HEIGHT = 34;
const WIDTH = 248;

export function createNetgraph(read: () => NetgraphSource): Panel & { sample: () => void } {
  const panel = createPanel('netgraph', 'Netgraph');

  const specs: SeriesSpec[] = [
    {
      label: 'RTT',
      colour: '#f0b429',
      read: () => read().rttMs,
      format: (v) => `${v.toFixed(0)} ms`,
      // ADR-012 designs for 40-200 ms; 300 keeps a bad link on the graph.
      ceiling: 300,
    },
    {
      label: 'Jitter',
      colour: '#9fd0ff',
      read: () => read().jitterMs,
      format: (v) => `${v.toFixed(1)} ms`,
      ceiling: 60,
    },
    {
      label: 'Prediction error',
      colour: '#ff8f4d',
      read: () => read().predictionErrorM,
      format: (v) => `${(v * 100).toFixed(1)} cm`,
      // The correction threshold is 2 cm; 20 cm shows the spikes that matter.
      ceiling: 0.2,
    },
    {
      label: 'Snapshot',
      colour: '#b9e6a3',
      read: () => read().snapshotBytes,
      format: (v) => `${v.toFixed(0)} B`,
      ceiling: 0,
    },
  ];

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * 2;
  canvas.height = ROW_HEIGHT * specs.length * 2;
  canvas.style.width = '100%';
  canvas.style.height = `${ROW_HEIGHT * specs.length}px`;
  canvas.className = 'netgraph-canvas';
  panel.body.append(canvas);

  const footer = document.createElement('pre');
  footer.className = 'panel-out';
  panel.body.append(footer);

  const ctx = canvas.getContext('2d');
  const series = specs.map(() => new Series());

  function draw(): void {
    if (!ctx) return;
    const w = canvas.width;
    const rowH = canvas.height / specs.length;
    ctx.clearRect(0, 0, w, canvas.height);
    ctx.font = '18px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';

    specs.forEach((spec, row) => {
      const s = series[row] as Series;
      const top = row * rowH;
      const scale = spec.ceiling > 0 ? spec.ceiling : Math.max(s.peak, 1e-6);

      ctx.strokeStyle = 'rgba(232, 220, 200, 0.14)';
      ctx.beginPath();
      ctx.moveTo(0, top + rowH - 1);
      ctx.lineTo(w, top + rowH - 1);
      ctx.stroke();

      ctx.strokeStyle = spec.colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      s.forEach((value, i) => {
        const x = (i / (SAMPLES - 1)) * w;
        // Clamped, not rescaled: a spike past the ceiling pins to the top and
        // stays legible instead of flattening everything else.
        const y = top + rowH - 2 - Math.min(1, value / scale) * (rowH - 14);
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      });
      ctx.stroke();

      ctx.fillStyle = 'rgba(232, 220, 200, 0.75)';
      ctx.fillText(spec.label, 4, top + 3);
      const text = spec.format(s.latest);
      ctx.fillStyle = spec.colour;
      ctx.fillText(text, w - ctx.measureText(text).width - 4, top + 3);
    });
  }

  return {
    ...panel,
    sample(): void {
      if (panel.root.hidden || panel.root.classList.contains('collapsed')) return;
      const now = read();
      specs.forEach((spec, i) => (series[i] as Series).push(spec.read()));
      /**
       * RTT and jitter appear here as well as on the graph. The graph shows the
       * shape, which is what it is for, but a tester reading a number out loud
       * wants text — and canvas text cannot be selected, copied, or read by
       * anything automated.
       */
      footer.textContent =
        `rtt         ${now.rttMs.toFixed(0)} ms  (jitter ${now.jitterMs.toFixed(1)} ms)\n` +
        `snapshot gaps ${(now.snapshotGapRate * 100).toFixed(1)}%\n` +
        `corrections ${(now.correctionRate * 100).toFixed(1)}%\n` +
        `interp ahead ${now.interpAheadTicks} ticks\n` +
        `tick drift  ${now.tickDrift}`;
      draw();
    },
  };
}
