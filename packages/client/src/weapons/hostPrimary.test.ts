import * as THREE from 'three';
import { expect, it } from 'vitest';
import { BitWriter, COMPONENT_IDS, POSITION, PROJECTILE_IDS, TICK_SECONDS, createLoopbackPair, encodeMessage, getWeapon, quantize, writeDelta } from '@sandline/shared';
import { NetClient } from '../net/NetClient.ts';
import { CombatQA, WEAPON_ORDER } from './CombatQA.ts';
import { syncHostPrimary, type PrimarySeen } from './hostPrimary.ts';

it('keeps firing the mounted MG through a carried-primary snapshot and adopts the new primary after dismount', () => {
  const combat = new CombatQA(new THREE.Scene());
  const carbine = WEAPON_ORDER.indexOf('carbine');
  const breacher = WEAPON_ORDER.indexOf('breacher');
  const pair = createLoopbackPair();
  const net = new NetClient(pair.b, 'tester');
  pair.a.send(encodeMessage({ kind: 'JoinAck', netId: 7, slot: 2, serverTick: 0, room: 'QA', world: 'mission-01', resume: '', resumed: false, identity: '' }));
  pair.settle();
  const snapshot = (tick: number, primary: number, ammo: number, mounted: boolean) => {
    const transform = [quantize(3, POSITION), 0, quantize(70.5, POSITION), 0, 0];
    const writer = new BitWriter();
    writeDelta(writer, { tick, entities: [
      { netId: 7, components: {
        [COMPONENT_IDS.Transform]: transform,
        [COMPONENT_IDS.PlayerSlot]: [2, 0],
        [COMPONENT_IDS.Weapon]: [primary, 0, 0, ...PROJECTILE_IDS.map(() => 0), ammo, primary],
      } },
      { netId: 50, components: {
        [COMPONENT_IDS.Transform]: transform,
        [COMPONENT_IDS.Emplacement]: [0, mounted ? 3 : 0, 0, 0],
      } },
    ] }, null);
    pair.a.send(encodeMessage({ kind: 'Delta', tick, baselineTick: null, lastProcessedInputTick: -1, payload: writer.toUint8Array() }));
    pair.settle();
  };
  let seen: PrimarySeen | null = null;
  const sync = () => {
    const result = syncHostPrimary(net, net.mounted !== null, seen, combat);
    seen = result.seen;
    return result;
  };

  snapshot(1, carbine, getWeapon('carbine').magSize, false);
  sync();
  combat.useGun(getWeapon('lmg')); // The local mount transition in main.ts.
  snapshot(2, breacher, 4, true);
  expect(net.mounted).not.toBeNull();
  expect(sync().adopted).toBe(false);
  expect(combat.weapon.id).toBe('lmg');
  expect(combat.weaponIndex).toBe(-1);
  const shot = combat.tick(1, TICK_SECONDS, {
    origin: new THREE.Vector3(3, 1.2, 70.5), yaw: 0, pitch: 0,
    firing: true, triggerEdge: true, ads: true,
  });
  expect(shot).not.toBeNull();
  expect(combat.weapon.id).toBe('lmg');
  expect(combat.magazine(TICK_SECONDS).ammo).toBe(getWeapon('lmg').magSize - 1);

  combat.selectWeapon(carbine); // The local dismount transition in main.ts.
  snapshot(3, breacher, 4, false);
  expect(net.mounted).toBeNull();
  expect(sync().adopted).toBe(true);
  expect(combat.weapon.id).toBe('breacher');
  expect(combat.magazine(TICK_SECONDS).ammo).toBe(4);
});
