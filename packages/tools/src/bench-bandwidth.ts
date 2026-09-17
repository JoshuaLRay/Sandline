/**
 * Measures actual snapshot bandwidth against the ADR-012 budget.
 *
 * Budget: ~18 KB/s down per player (~50 entities x ~12 B x 30 Hz).
 * Any design exceeding 40 KB/s needs review.
 *
 * Run: pnpm bench:bandwidth
 */
import { BitWriter } from '../../shared/src/net/BitStream.ts';
import { COMPONENT_IDS } from '../../shared/src/ecs/components.ts';
import { writeDelta } from '../../shared/src/net/delta.ts';
import { writeSnapshot, type WorldSnapshot } from '../../shared/src/net/snapshot.ts';
import { Sfc32 } from '../../shared/src/math/prng.ts';

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const H = COMPONENT_IDS.Health;
const ENTITIES = 50;
const TICKS = 300;
const HZ = 30;

const rng = new Sfc32(2024);
let world: WorldSnapshot = {
  tick: 0,
  entities: Array.from({ length: ENTITIES }, (_, i) => ({
    netId: i + 1,
    components: {
      [T]: [32768 + i * 40, 1000, 32768, (i * 37) % 1024, 512],
      [V]: [2048, 2048, 2048],
      [H]: [100, 100],
    },
  })),
};

const fullW = new BitWriter();
writeSnapshot(fullW, world);
const fullBytes = fullW.byteLength;

// Roughly a third of a squad moves on any given tick in a firefight.
let deltaTotal = 0;
for (let tick = 1; tick <= TICKS; tick++) {
  const next: WorldSnapshot = {
    tick,
    entities: world.entities.map((e) => {
      if (rng.nextUint32() % 3 !== 0) return e;
      const t = e.components[T] as number[];
      return {
        netId: e.netId,
        components: { ...e.components, [T]: [(t[0]! + 4) % 65536, t[1]!, (t[2]! + 2) % 65536, (t[3]! + 3) % 1024, t[4]!] },
      };
    }),
  };
  const w = new BitWriter();
  writeDelta(w, next, world);
  deltaTotal += w.byteLength;
  world = next;
}

const avgDelta = deltaTotal / TICKS;
const fullRate = (fullBytes * HZ) / 1024;
const deltaRate = (avgDelta * HZ) / 1024;

console.log(`${ENTITIES} entities (Transform + Velocity + Health), ${TICKS} ticks at ${HZ}Hz\n`);
console.log(`  full snapshot    ${fullBytes.toString().padStart(5)} B   ${(fullBytes / ENTITIES).toFixed(1)} B/entity   ${fullRate.toFixed(1)} KB/s if resent every tick`);
console.log(`  average delta    ${avgDelta.toFixed(0).padStart(5)} B   ${(avgDelta / ENTITIES).toFixed(1)} B/entity   ${deltaRate.toFixed(1)} KB/s`);
console.log(`  delta saves      ${(100 - (avgDelta / fullBytes) * 100).toFixed(1)}% versus full snapshots\n`);
console.log(`ADR-012 budget: ~18 KB/s per player, review needed above 40 KB/s.`);
console.log(
  deltaRate <= 18
    ? `VERDICT: ${deltaRate.toFixed(1)} KB/s is inside the 18 KB/s budget.`
    : deltaRate <= 40
      ? `VERDICT: ${deltaRate.toFixed(1)} KB/s is over the 18 KB/s target but under the 40 KB/s review line.`
      : `VERDICT: ${deltaRate.toFixed(1)} KB/s EXCEEDS the review line. Revisit ADR-012.`,
);
export {};
