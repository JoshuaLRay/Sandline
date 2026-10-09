import type { ClassDef, SupplyCacheDef, SupplyInventory, SupplyUseProgress } from '@sandline/shared';
import type { CommandRow } from './menu/commandModel.ts';
import { supplyChoiceModel, type SupplyChoiceModel } from './supplyModel.ts';

export interface MobileSupplyRecipient {
  slot: number;
  label: string;
  confirmed: boolean;
  caches: readonly SupplyChoiceModel[];
}

export interface MobileSupplyChoiceModel {
  /** The connection object: a replacement session cannot inherit a pending request. */
  sessionKey: object;
  commanderSlot: number;
  caches: readonly SupplyChoiceModel[];
  recipients: readonly MobileSupplyRecipient[];
}

/** Eligibility comes from the commander roster, independently of the watched soldier. */
export function mobileSupplyChoiceModel(source: {
  sessionKey: object;
  rows: readonly CommandRow[];
  commanderSlot: number;
  caches: readonly SupplyCacheDef[];
  uses: readonly SupplyUseProgress[];
  inventory: (slot: number) => SupplyInventory | null;
  capacity: (slot: number) => Pick<ClassDef, 'pouch' | 'healthKits'>;
}): MobileSupplyChoiceModel {
  const fallback = { pouch: [], healthKits: 0 };
  return {
    sessionKey: source.sessionKey,
    commanderSlot: source.commanderSlot,
    caches: source.caches.map(cache => supplyChoiceModel(cache, null, fallback, source.uses, -1, true)),
    recipients: source.rows.filter(row => source.commanderSlot >= 0 && !row.human && !row.captured && row.commander === source.commanderSlot).map(row => {
      const inventory = source.inventory(row.slot);
      return {
        slot: row.slot, label: row.label, confirmed: inventory !== null,
        caches: source.caches.map(cache => supplyChoiceModel(cache, inventory, source.capacity(row.slot), source.uses, row.slot, inventory === null)),
      };
    }),
  };
}
