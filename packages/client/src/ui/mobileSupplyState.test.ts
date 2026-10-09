import { describe, expect, it, vi } from 'vitest';
import { type RosterEntry, type SupplyInventory, type SupplyUseProgress, type Vitality } from '@sandline/shared';
import type { NetClient } from '../net/NetClient.ts';
import { SUPPLY_FIXTURES, SUPPLY_FIXTURE_INVENTORY } from './supplyFixtures.ts';
import { mobileSupplyState } from './mobileSupplyState.ts';

function state(slot = 0) {
  const classes = ['preach', 'brennan', 'holloway', 'ortiz', 'marsh', 'vance'];
  const roster: RosterEntry[] = classes.map((classId, index) => ({
    name: index === slot ? 'Commander' : '', human: index === slot, classId,
    commander: index === slot ? -1 : slot, captured: false, takenBy: -1,
  }));
  const inventories = new Map<number, SupplyInventory | null>(classes.map((_, index) => [index, SUPPLY_FIXTURE_INVENTORY]));
  const vitalities = new Map<number, Vitality | null>(classes.map((_, index) => [index, 'alive']));
  const recipientSupplyInventory = vi.fn((index: number) => inventories.get(index) ?? null);
  const client = {
    roster, slot, spectatedSlot: slot,
    supplyCaches: SUPPLY_FIXTURES, supplyProgress: [] as SupplyUseProgress[],
    recipientSupplyInventory,
    recipientSupplyVitality: (index: number) => vitalities.get(index) ?? null,
  };
  return { client, net: client as unknown as NetClient, roster, inventories, vitalities, recipientSupplyInventory };
}

describe('production mobile commander supply adapter (U-148)', () => {
  it('uses the seated issuer class reach while watching a human with squad-wide authority', () => {
    const s = state(3);
    s.roster[0] = { ...s.roster[0]!, human: true, commander: -1, name: 'Watched human' };
    s.client.spectatedSlot = 0;
    s.roster[5] = { ...s.roster[5]!, commander: 0 };
    const view = mobileSupplyState(s.net);
    expect(view.commanderSlot).toBe(3);
    expect(view.recipients.map(row => row.slot)).toEqual([3, 4]);
    expect(s.recipientSupplyInventory.mock.calls.map(([index]) => index)).toEqual([3, 4]);
  });

  it('includes the autonomous own seat only while spectating and excludes human, captured, downed and missing soldiers', () => {
    const s = state();
    s.roster[2] = { ...s.roster[2]!, human: true, commander: -1, name: 'Another human' };
    s.client.spectatedSlot = 2;
    s.roster[3] = { ...s.roster[3]!, captured: true };
    s.vitalities.set(4, 'downed'); s.vitalities.delete(5);
    expect(mobileSupplyState(s.net).recipients.map(row => row.slot)).toEqual([0, 1]);
    s.client.spectatedSlot = -1;
    expect(mobileSupplyState(s.net).recipients.map(row => row.slot)).toEqual([1]);
    s.client.spectatedSlot = 2; s.vitalities.set(0, 'downed');
    expect(mobileSupplyState(s.net).recipients.map(row => row.slot)).toEqual([1]);
  });

  it('revokes an owned bot immediately on the confirmed roster update and rejects unknown issuer classes', () => {
    const s = state();
    expect(mobileSupplyState(s.net).recipients.some(row => row.slot === 1)).toBe(true);
    s.roster[1] = { ...s.roster[1]!, commander: 2 };
    expect(mobileSupplyState(s.net).recipients.some(row => row.slot === 1)).toBe(false);
    s.roster[0] = { ...s.roster[0]!, classId: '' };
    expect(mobileSupplyState(s.net).recipients).toEqual([]);
  });

  it('uses each confirmed recipient inventory and class capacity without changing authoritative stock or progress', () => {
    const s = state();
    s.inventories.set(1, { ...SUPPLY_FIXTURE_INVENTORY, pouch: [0, 1, 0, 0, 0, 0], ammo: 30 });
    s.inventories.set(2, { ...SUPPLY_FIXTURE_INVENTORY, equipment: 4, ammo: 0, heldWeapon: 'smg', primary: 'smg' });
    s.inventories.set(3, null);
    s.client.supplyProgress = [{ slot: 1, cacheId: 'P-SOUTH', item: { kind: 'projectile', projectile: 'rocket' }, percent: 37 }];
    const before = structuredClone(s.client.supplyCaches);
    const view = mobileSupplyState(s.net);
    const brennan = view.recipients.find(row => row.slot === 1)!.caches[0]!;
    const holloway = view.recipients.find(row => row.slot === 2)!.caches[0]!;
    const awaiting = view.recipients.find(row => row.slot === 3)!;
    expect(brennan.choices[0]?.detail).toBe('Take 1');
    expect(holloway.choices[0]?.status).toBe('incompatible');
    expect(awaiting.confirmed).toBe(false);
    expect(awaiting.caches.every(cache => cache.readOnly && cache.choices.every(row => row.status === 'watching'))).toBe(true);
    expect(brennan.own).toEqual(s.client.supplyProgress[0]);
    expect(s.client.supplyCaches).toEqual(before);
    expect(s.client.supplyProgress[0]?.percent).toBe(37);
  });
});
