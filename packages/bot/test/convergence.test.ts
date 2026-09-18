import { describe, expect, it } from 'vitest';
import { CORRECTION_THRESHOLD_M, DEFAULT_MOVE_CONFIG, POSITION, TICK_SECONDS } from '@sandline/shared';
import { type ScenarioResult, formatRow, runScenario } from '../src/harness.ts';

/**
 * Netcode CI matrix (T-1.22) — M1's exit gate.
 *
 * Per ADR-014 this asserts BOUNDED PREDICTION DIVERGENCE and CORRECTION
 * FREQUENCY, not hash equality between clients. The server is authoritative, so
 * clients are never expected to agree bit-for-bit; what matters is whether a
 * player would see a correction.
 *
 * Every cell prints its numbers, pass or fail, so a slow regression is visible
 * as a trend before it crosses a threshold.
 */

const TICKS = 300;

/**
 * Expected worst-case divergence for a given latency.
 *
 * Prediction disagrees with authority for as long as an input is in flight. A
 * player who changes direction at full sprint diverges by roughly
 * `speed x round-trip` before the server's view catches up, so the bound is
 * derived from movement config rather than picked to fit the current numbers -
 * it stays correct if sprint speed is retuned.
 *
 * The quantization floor is added because position encodes at 1/64 m, which
 * contributes up to sqrt(3) x half a step on its own.
 */
function divergenceBound(latencyMs: number, lossRate: number, ticks: number): number {
  const quantizationFloor = Math.sqrt(3) * POSITION.maxError;

  // Packet loss widens the window too: a dropped input leaves the server a tick
  // further behind. Over `ticks` samples at rate p the longest expected run of
  // consecutive losses is about log(ticks)/log(1/p) - a real statistical bound
  // rather than a number chosen to fit today's measurements.
  const lostRunTicks =
    lossRate > 0 ? Math.ceil(Math.log(ticks) / Math.log(1 / lossRate)) : 0;

  const inFlightSeconds = (latencyMs * 2) / 1000 + TICK_SECONDS * (1 + lostRunTicks);
  const travel = DEFAULT_MOVE_CONFIG.sprintSpeed * inFlightSeconds;
  return quantizationFloor + travel * 1.25;
}

/**
 * How often a correction is acceptable.
 *
 * A flat limit is wrong, because a LOST INPUT is an unavoidable cause of
 * correction, not a defect: if the server never receives what you did on a
 * tick, it cannot predict it, and correcting is the right response. So the
 * ceiling scales with loss - corrections should be no more frequent than the
 * inputs that went missing.
 *
 * Observed, and worth recording because it looks like a bug: 0ms with 20% loss
 * produces MORE corrections (~8%) than 200ms with 20% loss (~2%). At zero
 * latency each dropped input is detected against a very recent tick, so the
 * mismatch is immediate and sharp; at high latency reconciliation compares
 * against a much older tick by which the server has already caught up through
 * its repeat-last-input rule. Higher latency is not better here - it is
 * measuring an older, more settled comparison point.
 */
function maxCorrectionRate(lossRate: number): number {
  // 5% floor for clean links; above that, bounded by what loss alone explains.
  return Math.max(0.05, lossRate * 0.75);
}

const LATENCIES = [0, 80, 200];
const LOSSES = [0, 0.05, 0.2];
const BOT_COUNTS = [2, 6];

const results: ScenarioResult[] = [];

describe('netcode convergence matrix (T-1.22)', () => {
  for (const bots of BOT_COUNTS) {
    for (const latencyMs of LATENCIES) {
      for (const lossRate of LOSSES) {
        const label = `${bots} bots @ ${latencyMs}ms, ${Math.round(lossRate * 100)}% loss`;

        it(label, () => {
          const r = runScenario({
            bots,
            ticks: TICKS,
            latencyMs,
            jitterMs: Math.round(latencyMs / 4),
            lossRate,
            seed: 1,
          });
          results.push(r);
          console.log(formatRow(r));

          expect(r.allJoined, 'every bot completed its handshake').toBe(true);

          // A ceiling, not a precise model: it catches divergence blowing up,
          // while `worstCorrectionRate` below is the sensitive quality metric.
          const bound = divergenceBound(latencyMs, lossRate, TICKS);
          expect(
            r.peakDivergence,
            `peak divergence ${r.peakDivergence.toFixed(3)}m exceeds the ` +
              `${bound.toFixed(3)}m bound for ${latencyMs}ms / ${Math.round(lossRate * 100)}% loss`,
          ).toBeLessThan(bound);

          const maxRate = maxCorrectionRate(lossRate);
          expect(
            r.worstCorrectionRate,
            `correction rate ${(r.worstCorrectionRate * 100).toFixed(1)}% exceeds ` +
              `${(maxRate * 100).toFixed(1)}% for ${Math.round(lossRate * 100)}% loss`,
          ).toBeLessThan(maxRate);

          // Every bot must still be receiving state. A bot that silently stops
          // applying snapshots would otherwise post perfect divergence numbers.
          expect(r.minSnapshotsApplied, 'bots are still receiving state').toBeGreaterThan(TICKS * 0.4);
        });
      }
    }
  }

  it('needs no corrections at all on a clean link', () => {
    // The strongest statement available: with no latency and no loss, the
    // client's prediction is right every single tick.
    const r = runScenario({ bots: 6, ticks: TICKS, seed: 7 });
    expect(r.worstCorrectionRate).toBe(0);
    expect(r.peakDivergence).toBeLessThan(CORRECTION_THRESHOLD_M);
  });

  // The failure mode that matters most: error that accumulates rather than
  // being corrected. A run four times as long must not diverge four times as far.
  it('does not drift without bound over a long run', () => {
    const short = runScenario({ bots: 2, ticks: 200, latencyMs: 120, jitterMs: 30, lossRate: 0.1, seed: 3 });
    const long = runScenario({ bots: 2, ticks: 800, latencyMs: 120, jitterMs: 30, lossRate: 0.1, seed: 3 });
    console.log(`  drift check: 200 ticks ${short.peakDivergence.toFixed(3)}m, 800 ticks ${long.peakDivergence.toFixed(3)}m`);
    expect(long.peakDivergence).toBeLessThan(short.peakDivergence * 2 + 0.5);
  });

  it('recovers baselines rather than stalling under heavy loss', () => {
    // Losing a baseline is routine on the unreliable channel; the client must
    // ask for a full snapshot and carry on, not wedge.
    const r = runScenario({ bots: 2, ticks: 400, latencyMs: 100, lossRate: 0.3, seed: 11 });
    console.log(`  heavy loss: ${r.minSnapshotsApplied} snapshots applied, ${r.totalMissedBaselines} baselines missed`);
    expect(r.allJoined).toBe(true);
    expect(r.minSnapshotsApplied).toBeGreaterThan(50);
  });

  it('prints the full matrix', () => {
    console.log('\n  === netcode matrix (T-1.22) ===');
    for (const r of results) console.log(formatRow(r));
    for (const r of results) {
      const bound = divergenceBound(r.latencyMs, r.lossRate, TICKS);
      const headroom = bound / Math.max(r.peakDivergence, 1e-9);
      console.log(
        `  ${String(r.bots).padStart(2)} bots ${String(r.latencyMs).padStart(3)}ms ` +
          `${String(Math.round(r.lossRate * 100)).padStart(2)}%: bound ${bound.toFixed(3)}m, ` +
          `headroom ${headroom.toFixed(1)}x`,
      );
    }
    console.log('');
    expect(results.length).toBe(BOT_COUNTS.length * LATENCIES.length * LOSSES.length);
  });
});

/**
 * The stated target for a poor connection: 80 ms, 15 ms jitter, 5% loss, and
 * no jitteriness for the person on that link.
 *
 * Kept as its own case rather than folded into the matrix because it is a
 * PRODUCT commitment, not a sweep point. The matrix asks "does this survive";
 * this asks "is it pleasant", which is a much higher bar and the one that was
 * being failed. Before the smoothness pass this link produced corrections on a
 * third of reconciles and failed to match on 98% of them.
 */
describe('the poor-connection target', () => {
  it('reconciles cleanly at 80ms / 15ms jitter / 5% loss', () => {
    const r = runScenario({ bots: 6, ticks: 1800, latencyMs: 80, jitterMs: 15, lossRate: 0.05, seed: 7 });

    expect(r.allJoined, 'every bot completed its handshake').toBe(true);

    /**
     * Structural, so held to exactly zero. Matching the acknowledged tick
     * either works or it does not — a failure to match is not the link being
     * bad, it is the client throwing its predictions away, and that happens for
     * reasons that do not depend on how lossy the link is.
     */
    expect(r.totalUnmatched, 'reconciliation matched every acknowledgement').toBe(0);

    /**
     * Corrections are what the player actually SEES. A lost run longer than the
     * resend depth is information the server never receives, so this cannot be
     * zero — but at 1% it is roughly one visible correction every three
     * seconds, and measured it sits nearer one a minute.
     */
    expect(
      r.worstTrueCorrectionRate,
      `worst correction rate ${(r.worstTrueCorrectionRate * 100).toFixed(2)}% should be under 1%`,
    ).toBeLessThan(0.01);

    console.log(
      `[target] 80ms/15ms/5%: corrections ${(r.worstTrueCorrectionRate * 100).toFixed(2)}%, ` +
        `unmatched ${r.totalUnmatched}, peak ${r.peakDivergence.toFixed(4)}m`,
    );
  });

  it('is essentially perfect at 80ms / 15ms jitter with no loss', () => {
    // Latency and jitter alone should cost nothing at all: every input arrives,
    // so the server has no reason to disagree with the client beyond encoding.
    const r = runScenario({ bots: 6, ticks: 900, latencyMs: 80, jitterMs: 15, lossRate: 0, seed: 7 });
    expect(r.totalUnmatched).toBe(0);
    expect(r.worstTrueCorrectionRate).toBe(0);
    console.log(`[target] 80ms/15ms/0%: peak ${r.peakDivergence.toFixed(4)}m, 0 corrections`);
  });
});
