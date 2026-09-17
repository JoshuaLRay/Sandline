/**
 * Parity harness (T-0.11, ADR-014).
 *
 * This REPLACES what would otherwise be a whole-world golden hash. That design
 * was rejected because it breaks on every damage or movement tuning change,
 * teaches the team to re-baseline reflexively, and then catches nothing (R10).
 *
 * What this does instead: run two independent simulation instances over a fixed
 * input sequence and REPORT divergence. It asserts nothing itself — callers
 * supply the bound appropriate to what they are testing. Constants come from the
 * caller's fixture, never from data/*.json, so gameplay tuning cannot break
 * anything built on it.
 *
 * Parity is bounded, not bit-exact. Callers get the actual number so the trend
 * is visible before it becomes a failure.
 */

export interface ParityReport {
  /** Largest divergence seen at any tick. */
  maxDivergence: number;
  /** Mean divergence across all ticks. */
  meanDivergence: number;
  /** First tick exceeding the caller's threshold, or -1 if never. */
  firstBreachTick: number;
  ticks: number;
}

export interface ParityScenario<TState> {
  /** Build a fresh instance. Called twice; the two must not share state. */
  create: () => TState;
  /** Advance one tick. */
  step: (state: TState, tick: number) => void;
  /** Extract comparable numbers — positions, velocities, whatever matters. */
  sample: (state: TState) => readonly number[];
  /** Optional teardown, e.g. freeing WASM worlds. */
  dispose?: (state: TState) => void;
}

/** Componentwise max absolute difference. Throws on shape mismatch. */
export function divergence(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`parity sample shape mismatch: ${a.length} vs ${b.length}`);
  }
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (Number.isNaN(av) || Number.isNaN(bv)) return Number.POSITIVE_INFINITY;
    const d = Math.abs(av - bv);
    if (d > worst) worst = d;
  }
  return worst;
}

export function runParity<TState>(
  scenario: ParityScenario<TState>,
  ticks: number,
  threshold = Number.POSITIVE_INFINITY,
): ParityReport {
  const a = scenario.create();
  const b = scenario.create();

  let maxDivergence = 0;
  let total = 0;
  let firstBreachTick = -1;

  try {
    for (let t = 0; t < ticks; t++) {
      scenario.step(a, t);
      scenario.step(b, t);
      const d = divergence(scenario.sample(a), scenario.sample(b));
      total += d;
      if (d > maxDivergence) maxDivergence = d;
      if (firstBreachTick === -1 && d > threshold) firstBreachTick = t;
    }
  } finally {
    scenario.dispose?.(a);
    scenario.dispose?.(b);
  }

  return {
    maxDivergence,
    meanDivergence: ticks > 0 ? total / ticks : 0,
    firstBreachTick,
    ticks,
  };
}

/**
 * One-line summary, printed on EVERY run rather than only on failure, so a
 * slowly worsening trend is visible before it crosses the threshold.
 */
export function formatParity(label: string, r: ParityReport): string {
  const breach = r.firstBreachTick >= 0 ? `, first breach @tick ${r.firstBreachTick}` : '';
  return `[parity] ${label}: max=${r.maxDivergence.toExponential(3)} mean=${r.meanDivergence.toExponential(3)} over ${r.ticks} ticks${breach}`;
}
