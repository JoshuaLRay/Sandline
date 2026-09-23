/**
 * Headless simulation runner (T-0.12).
 *
 * Runs a named scenario for N ticks. With --parity, runs two independent
 * instances and reports divergence (ADR-014) rather than comparing against a
 * committed golden hash, which was rejected as R10 "determinism theater".
 *
 *   pnpm sim-run --scenario fall --ticks 1000 --parity
 *
 * `cover-duel` (T-3.20) is a different kind of scenario: not the physics
 * sandbox but the authoritative session, a rifleman against a scripted
 * shooter over every seed in `scenarios/cover-duel.json`. It prints each
 * run's numbers and exits 1 when any threshold is missed (`--ticks` and
 * `--parity` do not apply).
 *
 *   pnpm sim-run --scenario cover-duel
 *
 * `pinned` (T-3.21) is the same kind: two riflemen in one group against a
 * scripted soldier holding cover, over every seed in `scenarios/pinned.json`.
 *
 *   pnpm sim-run --scenario pinned
 *
 * `mg` (T-3.23) runs the machine gunner and the rifleman through the same
 * pinned and flanked fights and compares them, over `scenarios/mg.json`.
 *
 *   pnpm sim-run --scenario mg
 */
import { Simulation } from '../../shared/src/sim/Simulation.ts';
import { divergence } from '../../shared/test/harness/parity.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const scenarioName = arg('scenario', 'fall');
const ticks = Number.parseInt(arg('ticks', '1000'), 10);
const parity = flag('parity');

if (scenarioName === 'pinned') {
  const { reportPinned, summarisePinned } = await import('./scenarios/pinned.ts');
  const summary = await summarisePinned();
  console.log(reportPinned(summary));
  if (summary.failures.length > 0) {
    for (const f of summary.failures) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
  console.log('OK: every threshold met');
  process.exit(0);
}

if (scenarioName === 'mg') {
  const { reportMg, summariseMg } = await import('./scenarios/mg.ts');
  const summary = await summariseMg();
  console.log(reportMg(summary));
  if (summary.failures.length > 0) {
    for (const f of summary.failures) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
  console.log('OK: every threshold met');
  process.exit(0);
}

if (scenarioName === 'cover-duel') {
  const { report, summarise } = await import('./scenarios/coverDuel.ts');
  const summary = await summarise();
  console.log(report(summary));
  if (summary.failures.length > 0) {
    for (const f of summary.failures) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
  console.log('OK: every threshold met');
  process.exit(0);
}

const SCENARIOS: Record<string, (sim: Simulation) => void> = {
  fall: (sim) => { sim.spawnActor({ x: 0, y: 10, z: 0 }); },
  crowd: (sim) => {
    for (let i = 0; i < 46; i++) {
      sim.spawnActor({ x: (i % 8) * 1.5 - 6, y: 2 + Math.floor(i / 8) * 1.2, z: Math.floor(i / 8) * 1.5 - 4 });
    }
  },
};

const build = SCENARIOS[scenarioName];
if (!build) {
  console.error(`unknown scenario '${scenarioName}'. available: ${[...Object.keys(SCENARIOS), 'cover-duel', 'pinned', 'mg'].join(', ')}`);
  process.exit(1);
}

async function makeSim(): Promise<Simulation> {
  const sim = await Simulation.create();
  build!(sim);
  return sim;
}

const THRESHOLD = 1e-4;
const a = await makeSim();

if (!parity) {
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) a.step();
  const ms = performance.now() - t0;
  console.log(`scenario=${scenarioName} ticks=${ticks} entities=${a.snapshot().entities.length}`);
  console.log(`wall=${ms.toFixed(1)}ms  ${((ms / ticks) * 1000).toFixed(1)}us/tick`);
  a.dispose();
} else {
  const b = await makeSim();
  let max = 0;
  let firstBreach = -1;
  for (let i = 0; i < ticks; i++) {
    a.step();
    b.step();
    const d = divergence(a.sample(), b.sample());
    if (d > max) max = d;
    if (firstBreach === -1 && d > THRESHOLD) firstBreach = i;
  }
  console.log(`scenario=${scenarioName} ticks=${ticks} entities=${a.snapshot().entities.length}`);
  console.log(`[parity] max divergence ${max.toExponential(3)} m (threshold ${THRESHOLD.toExponential(0)})`);
  a.dispose();
  b.dispose();
  if (firstBreach >= 0) {
    console.error(`FAIL: exceeded threshold first at tick ${firstBreach}`);
    process.exit(1);
  }
  console.log('OK: within bound');
}
