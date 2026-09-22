/**
 * Regressions from the first weapon QA pass. Every case here is something a
 * person reported after playing the deployed build, which is the only way these
 * were ever going to be found — none of them is visible from shared's tests.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_SECONDS, getWeapon } from '@sandline/shared';
import { CombatQA, WEAPON_ORDER } from './CombatQA.ts';

const AIM_YAW = 0;
const AIM_PITCH = 0;

function ctx(overrides: { firing?: boolean; triggerEdge?: boolean } = {}) {
  return {
    origin: new THREE.Vector3(0, 1.55, 0),
    yaw: AIM_YAW,
    pitch: AIM_PITCH,
    firing: overrides.firing ?? false,
    triggerEdge: overrides.triggerEdge ?? false,
    ads: false,
    prone: false,
  };
}

/** Run ticks, holding whatever trigger state is given, and return the end time. */
function run(combat: CombatQA, fromTick: number, ticks: number, state = {}): number {
  let tick = fromTick;
  for (let i = 0; i < ticks; i += 1) {
    tick += 1;
    combat.tick(tick, tick * TICK_SECONDS, ctx(state));
  }
  return tick;
}

describe('CombatQA', () => {
  let scene: THREE.Scene;
  let combat: CombatQA;

  beforeEach(() => {
    scene = new THREE.Scene();
    combat = new CombatQA(scene);
  });

  it('completes a reload while the trigger is released', () => {
    /**
     * The reported bug: "the countdown just restarts as soon as it's done".
     * `finishReload` used to be reached only from inside `tryFire`, so with the
     * trigger up the reload never settled, the magazine stayed empty, and the
     * idle auto-reload kicked off another one every tick, forever.
     */
    const carbine = getWeapon('carbine');
    const emptyAt = run(combat, 0, carbine.magSize * 3, { firing: true });
    expect(combat.shotsFired).toBe(carbine.magSize);

    // Now let go, and wait out the reload doing nothing at all.
    const reloadTicks = Math.ceil(carbine.reloadSeconds / TICK_SECONDS) + 2;
    const after = run(combat, emptyAt, reloadTicks);

    expect(combat.readout(after * TICK_SECONDS, false)).toContain(`${carbine.magSize}/${carbine.magSize}`);
    expect(combat.readout(after * TICK_SECONDS, false)).not.toContain('reloading');
  });

  it('keeps firing while the trigger is held on an automatic', () => {
    run(combat, 0, 30, { firing: true });
    expect(combat.shotsFired).toBeGreaterThan(1);
  });

  it('fires once per pull on a semi-automatic, however long the trigger is held', () => {
    // Reported as "all guns are also fully auto".
    combat.selectWeapon(WEAPON_ORDER.indexOf('marksman'));
    let tick = 0;
    tick += 1;
    combat.tick(tick, tick * TICK_SECONDS, ctx({ firing: true, triggerEdge: true }));
    expect(combat.shotsFired).toBe(1);

    // Sixty ticks of holding it down: at 180 rpm that is ample cadence room.
    run(combat, tick, 60, { firing: true });
    expect(combat.shotsFired).toBe(1);

    // Release and pull again.
    tick += 61;
    combat.tick(tick, tick * TICK_SECONDS, ctx({ firing: true, triggerEdge: true }));
    expect(combat.shotsFired).toBe(2);
  });

  it('switching weapons does not carry the previous magazine or reload over', () => {
    run(combat, 0, 40, { firing: true });
    combat.selectWeapon(WEAPON_ORDER.indexOf('sidearm'));
    const sidearm = getWeapon('sidearm');
    expect(combat.readout(100, false)).toContain(`${sidearm.magSize}/${sidearm.magSize}`);
  });
});
