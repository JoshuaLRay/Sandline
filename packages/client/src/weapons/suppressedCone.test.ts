/**
 * The page's weapon cone under suppression (T-3.16).
 *
 * The server widens a suppressed player's shots by `SUPPRESSION.coneDeg` at
 * full, taken from the level as the wire carries it; the page is told that
 * level as the `Suppression` component. Here a real session and a real
 * `NetClient` over a loopback prove the level arrives, and that `CombatQA`'s
 * predicted cone — the one its tracers spread in and the crosshair draws —
 * given that level is exactly the server's.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ANGLE_UNITS,
  SUPPRESSION,
  createLoopbackPair,
  createWeaponState,
  currentConeUnits,
  getWeapon,
  suppressionConeUnits,
  suppressionFromWire,
  suppressionLevel,
  suppressionToWire,
} from '@sandline/shared';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';
import { CombatQA } from './CombatQA.ts';

const TICK_MS = 1000 / 30;

describe('the suppressed cone on the page (T-3.16)', () => {
  it('reads the replicated level, and its predicted cone is the server’s cone at that level', () => {
    const session = new Session(undefined, '', 'range');
    const pair = createLoopbackPair();
    session.addConnection(pair.a, 0);
    const net = new NetClient(pair.b, 'me');
    net.join();
    pair.settle();
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
      }
    };
    run(3);
    expect(net.joined).toBe(true);
    expect(net.suppression).toBe(0);

    const slot = session.slots[0]!;
    const combat = new CombatQA(new THREE.Scene());
    const carbine = getWeapon('carbine');
    const plain = combat.coneDegrees(true);
    for (const level of [0.25, 0.6, 1]) {
      slot.suppression = { level, at: session.tick * (TICK_MS / 1000) };
      run(1);
      const told = net.suppression;
      expect(told).toBe(suppressionFromWire(suppressionToWire(suppressionLevel(slot.suppression, session.tick * (TICK_MS / 1000)))));
      // What the server fires with at this level, from the same weapon state.
      const server = (currentConeUnits(carbine, createWeaponState(carbine), true, false, suppressionConeUnits(level)) / ANGLE_UNITS) * 360;
      expect(combat.coneDegrees(true, false, told)).toBeCloseTo(server, 12);
      expect(combat.coneDegrees(true, false, told) - plain).toBeCloseTo((suppressionConeUnits(told) / ANGLE_UNITS) * 360, 12);
    }
    // Full suppression is the data's amount wider, to the angle quantum.
    expect(combat.coneDegrees(true, false, 1) - plain).toBeCloseTo(SUPPRESSION.coneDeg, 1);
  });
});
