import { describe, expect, it } from 'vitest';
import { createSupplySessionFixture } from './supplySessionFixture.ts';

describe('cache UI models on the actual Session and NetClient (U-134)', () => {
  it('shows partial ammo and finite projectiles, interrupts kit holds and reflects serialized contention', () => {
    const room = createSupplySessionFixture(); const a = room.join(1); const b = room.join(0);
    const soldier = room.place(a, 0); soldier.weaponState.ammo = soldier.weapon.magSize - 15;
    soldier.pouch[1] = 0; soldier.kits = 0; room.step(3);
    expect(a.net.supplyCaches).toHaveLength(5);
    expect(room.model(a, 0).choices[0]!.detail).toBe('Take 2');
    a.net.selectSupply('P-SOUTH', { kind: 'primary-ammo' }); room.settle(); a.holding = true;
    expect(room.model(a, 0).own?.percent).toBe(0); room.step(15);
    expect(room.model(a, 0).own?.percent).toBe(50); expect(soldier.weaponState.ammo).toBe(85);
    room.step(15); expect(soldier.weaponState.ammo).toBe(100);
    expect(a.net.supplyCaches[0]!.stock.primaryAmmoUnits).toBe(14040); // 15 LMG rounds cost 360 units.
    expect(room.model(a, 0).choices[2]!.status).toBe('full');
    a.net.selectSupply('P-SOUTH', { kind: 'projectile', projectile: 'rocket' }); room.settle(); room.step(30);
    expect(soldier.pouch[1]).toBe(2); expect(a.net.supplyCaches[0]!.stock.projectiles.rocket).toBe(4);
    a.net.selectSupply('P-SOUTH', { kind: 'health-kit' }); room.settle(); room.step(12);
    a.holding = false; room.step(6); expect(room.model(a, 0).own).toBeNull();
    expect(soldier.kits).toBe(0); expect(a.net.supplyCaches[0]!.stock.healthKits).toBe(2);
    room.place(a, 1); const other = room.place(b, 1); other.kits = 0;
    a.net.selectSupply('P-ROAD', { kind: 'health-kit' }); b.net.selectSupply('P-ROAD', { kind: 'health-kit' }); room.settle();
    a.holding = b.holding = true; room.step(15);
    expect(room.model(a, 1).others[0]?.percent).toBe(50);
    room.step(15); expect(other.kits).toBe(1); expect(soldier.kits).toBe(0);
    expect(a.net.supplyCaches[1]!.stock.healthKits).toBe(0); expect(room.model(a, 1).choices[0]!.status).toBe('empty');
    expect(room.model(a, 1).own).toBeNull(); expect(a.net.supplyCaches).toEqual(b.net.supplyCaches);
  });

  it('visits all five stock fixtures and keeps spectator requests read-only on the host', () => {
    const room = createSupplySessionFixture(); const a = room.join(1); const observer = room.join(0);
    room.place(a, 4); room.session.slots[1]!.kits = 0; room.step(3);
    a.net.selectSupply('P-OUTPOST', { kind: 'health-kit' }); room.settle(); a.holding = true; room.step(12);
    observer.net.spectate(1); room.settle();
    const view = room.model(observer, 4, true); expect(view.own).toBeNull(); expect(view.others[0]?.percent).toBe(40);
    observer.net.selectSupply('P-OUTPOST', { kind: 'health-kit' }); observer.holding = true; room.settle(); room.step(30);
    expect(room.session.slots[0]!.kits).toBe(3); expect(room.session.slots[1]!.kits).toBe(1);
    expect(observer.net.supplyCaches[4]!.stock.healthKits).toBe(2);
    for (let i = 0; i < 5; i++) expect(room.model(a, i).id).toBe(a.net.supplyCaches[i]!.id);
  });
});
