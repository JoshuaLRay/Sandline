/**
 * Bot CLI (T-1.20).
 *
 *   pnpm bot --count 2 --ticks 600
 *   pnpm bot --count 6 --ticks 600 --latency 200 --loss 0.2
 */
import { CORRECTION_THRESHOLD_M, POSITION } from '@sandline/shared';
import { formatRow, runScenario } from './harness.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const count = arg('count', 2);
const ticks = arg('ticks', 600);
const latencyMs = arg('latency', 0);
const jitterMs = arg('jitter', 0);
const lossRate = arg('loss', 0);

const result = runScenario({ bots: count, ticks, latencyMs, jitterMs, lossRate, seed: 1 });

console.log(`\n${count} bots x ${ticks} ticks, ${latencyMs}ms latency, ${(lossRate * 100).toFixed(0)}% loss\n`);
console.log(formatRow(result));
console.log(`\n  all joined          ${result.allJoined}`);
console.log(`  missed baselines    ${result.totalMissedBaselines}`);
for (const [i, m] of result.perBot.entries()) {
  console.log(
    `  bot${i}: peak ${m.peakDivergence.toFixed(4)} m, ` +
      `${m.trueCorrections}/${m.reconciles} corrections ` +
      `(${m.corrections} counted internally), ${m.unmatched} unmatched`,
  );
}

/**
 * Divergence cannot meaningfully go below the wire's own resolution.
 *
 * Position quantizes to 1/64 m, so each axis carries up to half a step of
 * error and a 3D distance up to sqrt(3) x that - about 13.5 mm - purely from
 * encoding. A threshold under that floor is unachievable by construction, no
 * matter how good the prediction is.
 *
 * The property actually worth asserting is that divergence stays below the
 * correction threshold, because that is what determines whether the player
 * ever SEES a correction.
 */
const QUANTIZATION_FLOOR_M = Math.sqrt(3) * POSITION.maxError;
console.log(
  `\n  quantization floor  ${QUANTIZATION_FLOOR_M.toFixed(4)} m (1/64 m position encoding)`,
);
console.log(`  unmatched reconciles ${result.totalUnmatched} (must be 0)`);

/**
 * On a CLEAN link, divergence must stay under the correction threshold: there
 * is nothing to explain a correction, so seeing one means prediction is wrong.
 *
 * On a LOSSY link that is unachievable by construction. A lost run of inputs
 * longer than the redundancy carries is information the server never receives,
 * so some divergence is arithmetic rather than a defect. What matters there is
 * how OFTEN the player is corrected, and that reconciliation never fails to
 * match — the latter is structural, so it is held to zero at every setting.
 */
const clean = latencyMs === 0 && lossRate === 0;
const ok = clean
  ? result.allJoined && result.peakDivergence < CORRECTION_THRESHOLD_M
  : result.allJoined && result.totalUnmatched === 0 && result.worstTrueCorrectionRate < 0.01;
console.log(
  clean
    ? `${ok ? 'OK' : 'FAIL'}: peak divergence ${result.peakDivergence.toFixed(4)} m ` +
        `(threshold ${CORRECTION_THRESHOLD_M} m on a clean link)`
    : `${ok ? 'OK' : 'FAIL'}: corrections ${(result.worstTrueCorrectionRate * 100).toFixed(2)}% ` +
        `(under 1%), ${result.totalUnmatched} unmatched, peak ${result.peakDivergence.toFixed(4)} m`,
);
if (!ok) process.exit(1);
export {};
