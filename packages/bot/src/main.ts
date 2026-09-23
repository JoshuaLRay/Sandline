/**
 * Bot CLI (T-1.20, extended by T-1.5.01).
 *
 *   pnpm bot --count 2 --ticks 600                        # in-process, virtual clock
 *   pnpm bot --count 6 --ticks 600 --latency 200 --loss 0.2
 *   pnpm bot --url ws://localhost:8080 --count 2 --ticks 600   # a real host, real sockets
 *   pnpm bot --url ws://localhost:8080 --room K7PM             # into a room people are in
 *   pnpm bot --url wss://… --key hunter2                       # a host with JOIN_KEY set
 */
import { CORRECTION_THRESHOLD_M, POSITION } from '@sandline/shared';
import { type ScenarioResult, formatRow, runScenario } from './harness.ts';
import { runRemoteScenario } from './remote.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
}

const url = flag('url');
const room = flag('room') ?? '';
const key = flag('key') ?? process.env['JOIN_KEY'] ?? '';
const count = arg('count', 2);
const ticks = arg('ticks', 600);
const latencyMs = arg('latency', 0);
const jitterMs = arg('jitter', 0);
const lossRate = arg('loss', 0);

let result: ScenarioResult;
/** Set when the host went away mid-run: the numbers then describe a fragment. */
let endedEarly: string | null = null;
if (url) {
  /**
   * In remote mode the link belongs to the host, so `--latency` and `--loss`
   * change nothing about the run — they only say which thresholds to hold it
   * to. Saying so out loud, because a flag that silently does nothing is worse
   * than no flag: someone would otherwise read a clean 200 ms result that was
   * actually measured at zero.
   */
  console.log(`\nconnecting ${count} bots to ${url}`);
  console.log(
    '  link conditions live on the host (LINK_LATENCY_MS / LINK_JITTER_MS / LINK_LOSS).',
  );
  if (latencyMs || jitterMs || lossRate) {
    console.log(
      `  --latency/--jitter/--loss here only select the thresholds asserted below.`,
    );
  }
  const remote = await runRemoteScenario({ url, bots: count, ticks, seed: 1, room, key });
  result = { ...remote, latencyMs, lossRate };
  endedEarly = remote.endedEarly;
  console.log(`  room                ${remote.room || '(none — did not join)'}`);
  console.log(
    `\n  wall clock          ${remote.elapsedSeconds.toFixed(1)} s ` +
      `(${(remote.completedTicks / remote.elapsedSeconds).toFixed(1)} ticks/s nominal 30)`,
  );
  console.log(`  peak tick lateness  ${remote.peakTickLatenessMs.toFixed(1)} ms`);
  if (endedEarly) {
    console.log(`  ENDED EARLY         ${remote.completedTicks}/${ticks} ticks: ${endedEarly}`);
  }
} else {
  result = runScenario({ bots: count, ticks, latencyMs, jitterMs, lossRate, seed: 1 });
}

console.log(
  `\n${count} bots x ${ticks} ticks, ${latencyMs}ms latency, ${(lossRate * 100).toFixed(0)}% loss` +
    `${url ? ` (over ${url})` : ''}\n`,
);
console.log(formatRow(result));
console.log(`\n  all joined          ${result.allJoined}`);
console.log(`  missed baselines    ${result.totalMissedBaselines}`);
for (const [i, m] of result.perBot.entries()) {
  console.log(
    `  bot${i}: peak ${m.peakDivergence.toFixed(4)} m, ` +
      `${m.trueCorrections}/${m.reconciles} corrections ` +
      `(${m.corrections} counted internally), ${m.unmatched} unmatched` +
      `${m.disconnectReason ? ` — disconnected: ${m.disconnectReason}` : ''}`,
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
/**
 * A run that lost its host is not a passing run, however good its numbers look.
 * They look good precisely BECAUSE it was cut short: every metric is frozen at
 * the moment the socket closed, so a host that dies early leaves behind a brief,
 * flawless fragment. Fail on it explicitly rather than letting it read as OK.
 */
const finished = endedEarly === null;
const ok =
  finished &&
  (clean
    ? result.allJoined && result.peakDivergence < CORRECTION_THRESHOLD_M
    : result.allJoined && result.totalUnmatched === 0 && result.worstTrueCorrectionRate < 0.01);
if (!finished) console.log(`\nFAIL: run did not finish — ${endedEarly}`);
console.log(
  clean
    ? `${ok ? 'OK' : 'FAIL'}: peak divergence ${result.peakDivergence.toFixed(4)} m ` +
        `(threshold ${CORRECTION_THRESHOLD_M} m on a clean link)`
    : `${ok ? 'OK' : 'FAIL'}: corrections ${(result.worstTrueCorrectionRate * 100).toFixed(2)}% ` +
        `(under 1%), ${result.totalUnmatched} unmatched, peak ${result.peakDivergence.toFixed(4)} m`,
);
if (!ok) process.exit(1);
export {};
