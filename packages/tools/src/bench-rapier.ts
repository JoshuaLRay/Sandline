/**
 * ADR-005 requires MEASURING the deterministic build's cost rather than
 * assuming it is negligible. If the cost is material at this project's scale,
 * ADR-005 and ADR-014 must both be revisited before M1 starts.
 *
 * Scale under test is this game's, not a physics benchmark's: ~46 dynamic
 * bodies (6 players + 40 AI) on a static ground plane, stepped at 30 Hz.
 *
 * Run: pnpm bench:rapier
 */
const BODIES = 46;
const STEPS = 1800; // 60 seconds of simulation at 30 Hz
const REPS = 3;

async function bench(pkg: string): Promise<{ ms: number; checksum: number }> {
  const RAPIER = (await import(pkg)).default;
  await RAPIER.init();

  let best = Infinity;
  let checksum = 0;

  for (let rep = 0; rep < REPS; rep++) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60), ground);

    const bodies = [];
    for (let i = 0; i < BODIES; i++) {
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation((i % 8) * 1.5 - 6, 2 + Math.floor(i / 8) * 1.2, Math.floor(i / 8) * 1.5 - 4),
      );
      world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.35), b);
      bodies.push(b);
    }

    const t0 = performance.now();
    for (let s = 0; s < STEPS; s++) world.step();
    const elapsed = performance.now() - t0;
    best = Math.min(best, elapsed);

    checksum = 0;
    for (const b of bodies) {
      const t = b.translation();
      checksum += t.x + t.y + t.z;
    }
    world.free();
  }
  return { ms: best, checksum };
}

const targets = [
  ['deterministic (ADR-005 pick)', '@dimforge/rapier3d-deterministic-compat'],
  ['default', '@dimforge/rapier3d-compat'],
  ['simd', '@dimforge/rapier3d-simd-compat'],
] as const;

console.log(`${BODIES} dynamic bodies x ${STEPS} steps (${(STEPS / 30).toFixed(0)}s of sim at 30Hz), best of ${REPS}\n`);

const results: { label: string; ms: number; checksum: number }[] = [];
for (const [label, pkg] of targets) {
  try {
    const r = await bench(pkg);
    results.push({ label, ...r });
  } catch (e) {
    console.log(`  ${label.padEnd(30)} unavailable (${(e as Error).message.slice(0, 60)})`);
  }
}

const baseline = results.find((r) => r.label.startsWith('deterministic'));
for (const r of results) {
  const perStep = (r.ms / STEPS) * 1000;
  const rel = baseline ? ` (${(r.ms / baseline.ms).toFixed(2)}x deterministic)` : '';
  console.log(
    `  ${r.label.padEnd(30)} ${r.ms.toFixed(0).padStart(6)} ms total` +
    `  ${perStep.toFixed(1).padStart(6)} us/step${rel}`,
  );
}

const budgetUsPerStep = (1000 / 30) * 1000 * 0.25; // 25% of a 33.3ms server tick
console.log(`\nServer tick budget at 30Hz: 33333 us. 25% ceiling for physics: ${budgetUsPerStep.toFixed(0)} us/step.`);
if (baseline) {
  const perStep = (baseline.ms / STEPS) * 1000;
  console.log(
    perStep < budgetUsPerStep
      ? `VERDICT: deterministic build uses ${((perStep / budgetUsPerStep) * 100).toFixed(1)}% of that ceiling. ADR-005 stands.`
      : `VERDICT: deterministic build EXCEEDS the ceiling. Revisit ADR-005 and ADR-014 before M1.`,
  );
}

export {};
