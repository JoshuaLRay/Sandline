import { describe, expect, it } from 'vitest';
import { type SupplyInventory, type SupplyUseProgress } from '@sandline/shared';
import { mobileSupplyChoiceModel } from './mobileSupplyModel.ts';
import { SUPPLY_FIXTURES, SUPPLY_FIXTURE_INVENTORY } from './supplyFixtures.ts';
import type { CommandRow } from './menu/commandModel.ts';

const rows: CommandRow[] = Array.from({ length: 5 }, (_, slot) => ({
  slot, label: `Slot ${slot + 1}`, human: slot === 0 || slot === 4, commander: slot === 3 ? 4 : 0,
  options: [], switchable: slot === 1, captured: slot === 2,
}));
const capacity = () => ({ pouch: [2, 2], healthKits: 3 });
const source = {
  sessionKey: {}, rows, commanderSlot: 0, caches: SUPPLY_FIXTURES, uses: [] as readonly SupplyUseProgress[],
  inventory: () => SUPPLY_FIXTURE_INVENTORY as SupplyInventory | null, capacity,
};

describe('mobile commander cache model (U-148)', () => {
  it('exposes only commanded uncaptured bots, independently of a watched human or unrelated inventory', () => {
    const model = mobileSupplyChoiceModel(source);
    expect(model.recipients.map(row => row.slot)).toEqual([1]);
    expect(model.recipients[0]!.caches).toHaveLength(5);
    expect(model.recipients[0]!.caches[0]!.choices.map(row => row.status)).toEqual(['transferred', 'transferred', 'transferred']);
    const full = mobileSupplyChoiceModel({ ...source, inventory: () => ({ ...SUPPLY_FIXTURE_INVENTORY, ammo: 30, kits: 3, pouch: [2, 2] }) });
    expect(full.recipients[0]!.caches[0]!.choices.every(row => row.status === 'full')).toBe(true);
    expect(mobileSupplyChoiceModel({ ...source, commanderSlot: -1 }).recipients).toEqual([]);
  });

  it('retains stock and all host use when no recipient inventory is confirmed, with no transfer prediction', () => {
    const uses: SupplyUseProgress[] = [
      { slot: 1, cacheId: 'P-SOUTH', item: { kind: 'health-kit' }, percent: 0 },
      { slot: 3, cacheId: 'P-SOUTH', item: { kind: 'primary-ammo' }, percent: 40 },
    ];
    const model = mobileSupplyChoiceModel({ ...source, inventory: () => null, uses });
    expect(model.recipients[0]!.confirmed).toBe(false);
    expect(model.recipients[0]!.caches[0]!.choices.every(row => row.status === 'watching')).toBe(true);
    expect(model.caches[0]!.others).toEqual(uses);
    expect(model.caches[0]!.choices[1]!.stock).toBe('2 remaining');
    const confirmed = mobileSupplyChoiceModel({ ...source, uses });
    expect(confirmed.recipients[0]!.caches[0]!.own).toEqual(uses[0]);
    expect(confirmed.recipients[0]!.caches[0]!.others).toEqual([uses[1]]);
    expect(SUPPLY_FIXTURE_INVENTORY.kits).toBe(0);
    expect(SUPPLY_FIXTURES[0]!.stock.healthKits).toBe(2);
  });
});
