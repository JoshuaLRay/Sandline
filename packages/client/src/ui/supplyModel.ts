import {
  classById, getProjectile, PROJECTILE_IDS, rayWorld, SUPPLY_AMMO_UNITS_PER_MAGAZINE, SUPPLY_RULES, transferSupply, WEAPON_IDS,
  type ClassDef, type SupplyCacheDef, type SupplyInventory, type SupplyItem, type SupplyUseProgress, type WorldBox,
} from '@sandline/shared';
import type { NetClient } from '../net/NetClient.ts';

/** Confirmed inventory and capacities, including free QA sessions, in the host's denomination. */
export function supplyInventory(net: NetClient, holdingEquipment = false): SupplyInventory {
  return {
    primary: WEAPON_IDS[net.primary ?? -1] ?? null, secondary: WEAPON_IDS[net.secondary ?? -1] ?? null,
    heldWeapon: holdingEquipment ? '' : WEAPON_IDS[net.magazine?.weapon ?? -1] ?? '', ammo: net.magazine?.ammo ?? 0,
    equipment: net.equipment, pouch: net.pouch ?? [], kits: net.kits,
  };
}
export function supplyCapacity(net: NetClient): Pick<ClassDef, 'pouch' | 'healthKits'> {
  return classById(net.roster[net.slot]?.classId ?? '') ?? { pouch: PROJECTILE_IDS.map(id => getProjectile(id).carried), healthKits: 3 };
}

export const supplyItemKey = (item: SupplyItem): string => item.kind === 'projectile' ? item.projectile : item.kind;
export const supplyItemName = (item: SupplyItem): string => item.kind === 'projectile'
  ? getProjectile(item.projectile).name : item.kind === 'health-kit' ? 'Health kit' : 'Primary ammunition';
export const supplyEmpty = (cache: SupplyCacheDef): boolean => cache.stock.healthKits === 0 &&
  cache.stock.primaryAmmoUnits === 0 && Object.values(cache.stock.projectiles).every(count => count === 0);

/** A nearby hint on the correct floor with unobstructed sight. The host still judges every request. */
export function supplyInReach(caches: readonly SupplyCacheDef[], feet: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number }, boxes: readonly WorldBox[], preferredId?: string): SupplyCacheDef | null {
  const preferred = caches.find(cache => cache.id === preferredId);
  if (preferred && supplyInReach([preferred], feet, eye, boxes)) return preferred;
  let best: SupplyCacheDef | null = null;
  let distance = SUPPLY_RULES.reachM;
  for (const cache of caches) {
    const p = cache.feet;
    const d = Math.hypot(feet.x - p.x, feet.y - p.y, feet.z - p.z);
    if (Math.abs(feet.y - p.y) > 1 || d > distance) continue;
    const dx = p.x - eye.x; const dy = p.y + .5 - eye.y; const dz = p.z - eye.z;
    const length = Math.hypot(dx, dy, dz);
    if (length > 0 && rayWorld({ origin: eye, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length }, boxes)) continue;
    best = cache; distance = d;
  }
  return best;
}

export interface SupplyChoiceRow {
  item: SupplyItem;
  name: string;
  stock: string;
  status: 'transferred' | 'empty' | 'full' | 'incompatible' | 'watching';
  detail: string;
}
export interface SupplyChoiceModel {
  id: string;
  empty: boolean;
  readOnly: boolean;
  choices: readonly SupplyChoiceRow[];
  own: SupplyUseProgress | null;
  others: readonly SupplyUseProgress[];
}

function ammoStock(units: number): string {
  if (units === 0) return '0 magazine equivalents';
  const mags = units / SUPPLY_AMMO_UNITS_PER_MAGAZINE;
  return mags < .01 ? 'Less than 0.01 magazine' : `${Number(mags.toFixed(2))} magazine equivalents`;
}

/** Pure transfer previews; stock, selection and the clock are never predicted locally. */
export function supplyChoiceModel(cache: SupplyCacheDef, inventory: SupplyInventory | null,
  capacity: Pick<ClassDef, 'pouch' | 'healthKits'>, uses: readonly SupplyUseProgress[], slot: number, readOnly = false): SupplyChoiceModel {
  const items: SupplyItem[] = [
    ...Object.keys(cache.stock.projectiles).map(projectile => ({ kind: 'projectile', projectile }) as SupplyItem),
    { kind: 'health-kit' }, { kind: 'primary-ammo' },
  ];
  const choices: SupplyChoiceRow[] = items.map(item => {
    const transfer = inventory && !readOnly ? transferSupply(cache.stock, inventory, capacity, item) : null;
    const status: SupplyChoiceRow['status'] = transfer?.status ?? 'watching';
    return {
      item, name: supplyItemName(item), status,
      stock: item.kind === 'primary-ammo' ? ammoStock(cache.stock.primaryAmmoUnits)
        : `${item.kind === 'health-kit' ? cache.stock.healthKits : cache.stock.projectiles[item.projectile] ?? 0} remaining`,
      detail: status === 'full' ? 'Already full' : status === 'incompatible'
        ? item.kind === 'primary-ammo' ? 'Hold a carried primary' : 'Incompatible equipment'
        : status === 'empty' ? 'Depleted' : status === 'watching' ? 'Stock only'
        : `Take ${transfer!.amount}${item.kind === 'primary-ammo' ? ' rounds' : item.kind === 'health-kit' ? ' kit charge' : ''}`,
    };
  });
  return {
    id: cache.id, empty: supplyEmpty(cache), readOnly,
    choices, own: readOnly ? null : uses.find(use => use.cacheId === cache.id && use.slot === slot) ?? null,
    others: uses.filter(use => use.cacheId === cache.id && (readOnly || use.slot !== slot)),
  };
}
