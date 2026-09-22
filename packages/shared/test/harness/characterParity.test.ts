/**
 * Character controller parity (T-1.12), run on every engine CI has.
 *
 * Two independent instances walk a fixed 500-tick sequence through walls,
 * steps, a jump onto cover and a fall off it, and must agree. This file is
 * included in the non-V8 browser run (vitest.browser.config.ts), which is the
 * only place a transcendental-drift bug would show; with the controller in
 * pure arithmetic and table trig, the expected divergence is exactly zero and
 * the bound is the ADR-014 one for good measure.
 *
 * Constants are declared here, not imported from DEFAULT_MOVE_CONFIG or from
 * world.json, so tuning either cannot touch what this proves.
 */
import { describe, expect, it } from 'vitest';
import { type MoveConfig, type MoveInput, type MoveState, createMoveState, stepCharacter } from '../../src/sim/CharacterController.ts';
import { type WorldBox, boxFrom } from '../../src/sim/world.ts';
import { formatParity, runParity } from './parity.ts';

const CONFIG: MoveConfig = {
  walkSpeed: 4.2,
  sprintSpeed: 6.8,
  crouchSpeed: 1.9,
  gravity: -19.6,
  jumpSpeed: 6.0,
  groundY: 0,
  maxFallSpeed: -55,
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.2,
  proneHeight: 0.8,
  proneSpeed: 1.1,
  stepHeight: 0.45,
  vaultMaxHeight: 1.25,
  vaultDistance: 1.5,
  vaultSeconds: 0.55,
  vaultProbe: 0.35,
  vaultLip: 0.15,
};
const DT = 1 / 30;

const WORLD: WorldBox[] = [
  boxFrom({ id: 'kerb', x: 0, y: 0, z: 4, w: 4, h: 0.4, d: 2 }, 'cover'),
  boxFrom({ id: 'wall', x: 0, y: 0, z: 9, w: 6, h: 2.4, d: 0.3 }, 'cover'),
  boxFrom({ id: 'crate', x: -4, y: 0, z: 8, w: 2, h: 0.8, d: 2 }, 'cover'),
  boxFrom({ id: 'post', x: 3, y: 0, z: 6, w: 0.18, h: 1.4, d: 0.18 }, 'post-minor'),
  // T-2.21: a hurdle on the opening straight, too tall to step and low
  // enough to vault, so the vault arithmetic runs on every engine too. The
  // script presses jump at it; walking into it alone does not vault.
  boxFrom({ id: 'hurdle', x: 0, y: 0, z: 6.6, w: 4, h: 0.9, d: 0.5 }, 'cover'),
];

/**
 * A scripted walk from the origin: over the kerb, into the wall, along it into
 * the crate, a jump onto the crate, off its far side, and a wander back.
 * Phases are 50 ticks; yaw is a wire angle (256 = +X, 512 = -Z, 768 = -X).
 */
function inputAt(tick: number): MoveInput {
  const phase = Math.floor(tick / 50) % 10;
  const yaw = [0, 0, 768, 768, 768, 512, 300, 128, 900, 0][phase] as number;
  return {
    moveX: phase === 6 ? 1 : phase === 8 ? -1 : 0,
    moveY: phase === 4 && tick % 50 < 5 ? 0 : 1,
    yaw,
    // Tick 45 is jump pressed at the hurdle: vaulting needs it (T-2.21).
    jump: (tick % 50 === 5 && (phase === 3 || phase === 7)) || tick === 45,
    sprint: phase === 1 || phase === 5 || phase === 9,
    crouch: phase === 6,
  };
}

describe('character controller parity (T-1.12)', () => {
  it('two instances agree exactly over 500 ticks of collision, steps and jumps', () => {
    const scenario = {
      create: (): { s: MoveState } => ({ s: createMoveState(0, 0, 0) }),
      step: (st: { s: MoveState }, tick: number) => {
        st.s = stepCharacter(st.s, inputAt(tick), DT, CONFIG, WORLD);
      },
      sample: (st: { s: MoveState }) => [st.s.x, st.s.y, st.s.z, st.s.vy, st.s.grounded ? 1 : 0, st.s.vault ? st.s.vault.elapsed : -1],
    };
    const report = runParity(scenario, 500, 1e-4);
    console.log(formatParity('character controller, 500 ticks', report));
    expect(report.ticks).toBe(500);
    expect(report.maxDivergence).toBe(0);
    expect(report.firstBreachTick).toBe(-1);
  });

  it('actually touched the scenery during the run (the sequence is not a walk in the open)', () => {
    let s = createMoveState(0, 0, 0);
    let stoodOnSomething = false;
    let vaulted = false;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let t = 0; t < 500; t++) {
      s = stepCharacter(s, inputAt(t), DT, CONFIG, WORLD);
      if (s.grounded && s.y > 0) stoodOnSomething = true;
      if (s.vault) vaulted = true;
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    expect(stoodOnSomething).toBe(true);
    expect(vaulted).toBe(true);
    expect(Number.isFinite(minZ) && Number.isFinite(maxZ)).toBe(true);
  });
});
