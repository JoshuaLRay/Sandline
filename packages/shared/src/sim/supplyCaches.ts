/**
 * Finite supplies (U-132, U-112): static content and pure transfer arithmetic.
 * The host must recompute and commit a transfer against current stock when use
 * completes (U-133); a preview is never a reservation. No pickup item/net IDs.
 */
import RAW_RULES from '../data/supply-caches.json' with { type: 'json' };
import { POSITION } from '../net/quantize.ts';
import { PROJECTILE_IDS, type ProjectileId } from './ballistics.ts';
import type { ClassDef } from './classes.ts';
import { WEAPONS } from './weapons.ts';

export type SupplyProjectileId = Exclude<ProjectileId, 'smokecloud'>;
export type SupplyItem =
  | { kind: 'projectile'; projectile: SupplyProjectileId }
  | { kind: 'health-kit' }
  | { kind: 'primary-ammo' };

/**
 * Storage denomination, not tuning: one magazine = 2,400 integer units. This
 * divides every shipped primary magazine (5, 6, 10, 30, 32, 100). Saves/wire
 * must keep this denomination; changing it requires an explicit migration.
 */
export const SUPPLY_AMMO_UNITS_PER_MAGAZINE = 2400;
const MAX_STOCK = 65535;
export const MAX_SUPPLY_CACHES = 64;
const CACHE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isSupplyCacheId(id: unknown): id is string {
  return typeof id === 'string' && CACHE_ID.test(id);
}

export interface SupplyStock {
  readonly projectiles: Readonly<Partial<Record<SupplyProjectileId, number>>>;
  readonly healthKits: number;
  readonly primaryAmmoUnits: number;
}

/** Durable stock is keyed by authored identity, never by a weapon pickup ID. */
export interface SupplyCacheStock {
  readonly id: string;
  readonly stock: SupplyStock;
}

export interface SupplyCacheDef extends SupplyCacheStock {
  readonly feet: Readonly<{ x: number; y: number; z: number }>;
}

/** A server-accepted choice; percent is zero until held use starts. */
export interface SupplyUseProgress {
  readonly slot: number;
  readonly cacheId: string;
  readonly item: SupplyItem;
  readonly percent: number;
}

export function parseSupplyItem(raw: unknown): SupplyItem {
  const o = obj('supply item', raw, ['kind'], ['projectile']);
  if (o['kind'] === 'projectile' && PROJECTILE_IDS.some((id) => id !== 'smokecloud' && id === o['projectile'])) {
    return { kind: 'projectile', projectile: o['projectile'] as SupplyProjectileId };
  }
  if ((o['kind'] === 'health-kit' || o['kind'] === 'primary-ammo') && o['projectile'] === undefined) return { kind: o['kind'] };
  throw new SupplyDataError('supply item: invalid choice');
}

export function parseSupplyCacheStocks(raw: unknown): SupplyCacheStock[] {
  if (!Array.isArray(raw) || raw.length > MAX_SUPPLY_CACHES) throw new SupplyDataError('supply cache stock: invalid list');
  const seen = new Set<string>();
  return raw.map((row) => {
    const o = obj('supply cache stock', row, ['id', 'stock']);
    const id = o['id'];
    if (!isSupplyCacheId(id) || seen.has(id)) throw new SupplyDataError('supply cache stock: invalid or duplicate id');
    seen.add(id);
    return { id, stock: parseSupplyStock(o['stock']) };
  });
}

/** A view of existing inventory. Transfers never change its weapon/equipment identities. */
export interface SupplyInventory {
  readonly primary: string | null;
  readonly secondary: string | null;
  readonly heldWeapon: string;
  readonly ammo: number;
  readonly equipment: number;
  readonly pouch: readonly number[];
  readonly kits: number;
}

export interface SupplyTransfer {
  readonly status: 'transferred' | 'empty' | 'full' | 'incompatible';
  /** Whole rounds, projectiles or kit charges delivered (never magazine units). */
  readonly amount: number;
  readonly stock: SupplyStock;
  readonly inventory: SupplyInventory;
}

export class SupplyDataError extends Error {}
type Obj = Record<string, unknown>;

function obj(where: string, raw: unknown, required: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SupplyDataError(`${where}: expected an object`);
  const o = raw as Obj;
  for (const key of Object.keys(o)) if (!required.includes(key) && !optional.includes(key) && key !== '$comment') throw new SupplyDataError(`${where}: unknown key '${key}'`);
  for (const key of required) if (!(key in o)) throw new SupplyDataError(`${where}: missing '${key}'`);
  return o;
}

function finite(where: string, raw: unknown, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) throw new SupplyDataError(`${where}: expected a finite number in [${min}, ${max}]`);
  return raw;
}

function whole(where: string, raw: unknown, max = MAX_STOCK): number {
  const n = finite(where, raw, 0, max);
  if (!Number.isInteger(n)) throw new SupplyDataError(`${where}: expected a whole number`);
  return n;
}

function projectiles(where: string, raw: unknown): SupplyStock['projectiles'] {
  const ids = PROJECTILE_IDS.filter((id) => id !== 'smokecloud');
  const o = obj(where, raw, [], ids);
  return Object.fromEntries(Object.entries(o).filter(([key]) => key !== '$comment').map(([key, value]) => [key, whole(`${where}.${key}`, value)]));
}

/** Validate durable/replicated stock in its stable integer denomination. */
export function parseSupplyStock(raw: unknown, where = 'supply stock'): SupplyStock {
  const o = obj(where, raw, ['projectiles', 'healthKits', 'primaryAmmoUnits']);
  return {
    projectiles: projectiles(`${where}.projectiles`, o['projectiles']),
    healthKits: whole(`${where}.healthKits`, o['healthKits']),
    primaryAmmoUnits: whole(`${where}.primaryAmmoUnits`, o['primaryAmmoUnits'], MAX_STOCK * SUPPLY_AMMO_UNITS_PER_MAGAZINE),
  };
}

/**
 * Authoring uses whole magazine equivalents, durable state uses integer units.
 * Physical support/accessibility are checked by the Session consumer (U-133).
 */
export function parseSupplyCaches(raw: unknown, where = 'supplyCaches'): readonly SupplyCacheDef[] {
  if (!Array.isArray(raw) || raw.length > MAX_SUPPLY_CACHES) throw new SupplyDataError(`${where}: expected a list of at most ${MAX_SUPPLY_CACHES} caches`);
  const seen = new Set<string>();
  return raw.map((row, i) => {
    const at = `${where}[${i}]`;
    const o = obj(at, row, ['id', 'feet', 'stock']);
    const id = o['id'];
    if (!isSupplyCacheId(id)) throw new SupplyDataError(`${at}.id: expected 1–64 ASCII letters/digits/_/- starting with a letter or digit`);
    if (seen.has(id)) throw new SupplyDataError(`${at}.id: duplicate cache '${id}'`);
    seen.add(id);
    const feet = obj(`${at}.feet`, o['feet'], ['x', 'y', 'z']);
    const stock = obj(`${at}.stock`, o['stock'], [], ['projectiles', 'healthKits', 'primaryMagazines']);
    return {
      id,
      feet: {
        x: finite(`${at}.feet.x`, feet['x'], POSITION.min, POSITION.max),
        y: finite(`${at}.feet.y`, feet['y'], POSITION.min, POSITION.max),
        z: finite(`${at}.feet.z`, feet['z'], POSITION.min, POSITION.max),
      },
      stock: {
        projectiles: projectiles(`${at}.stock.projectiles`, stock['projectiles'] === undefined ? {} : stock['projectiles']),
        healthKits: stock['healthKits'] === undefined ? 0 : whole(`${at}.stock.healthKits`, stock['healthKits']),
        primaryAmmoUnits: (stock['primaryMagazines'] === undefined ? 0 : whole(`${at}.stock.primaryMagazines`, stock['primaryMagazines'])) * SUPPLY_AMMO_UNITS_PER_MAGAZINE,
      },
    };
  });
}

export function parseSupplyRules(raw: unknown): Readonly<{ useSeconds: number; reachM: number }> {
  const o = obj('supply-caches', raw, ['useSeconds', 'reachM']);
  return {
    useSeconds: finite('supply-caches.useSeconds', o['useSeconds'], .01, 60),
    reachM: finite('supply-caches.reachM', o['reachM'], .01, 3),
  };
}

export const SUPPLY_RULES = Object.freeze(parseSupplyRules(RAW_RULES));

// New tuning must still preserve exact round accounting with the stable save denomination.
for (const def of Object.values(WEAPONS)) {
  if (def.role !== 'pistol' && def.role !== 'melee' && (!Number.isInteger(def.magSize) || def.magSize <= 0 || SUPPLY_AMMO_UNITS_PER_MAGAZINE % def.magSize !== 0)) {
    throw new SupplyDataError(`weapon '${def.id}': magazine size must divide ${SUPPLY_AMMO_UNITS_PER_MAGAZINE} supply units`);
  }
}

/**
 * One chosen type; no mutation, healing, weapon replacement or spare magazines.
 * Capacities come from the character's existing class. Equipment must already
 * occupy its slot; resupply cannot give another character Brennan's launcher.
 */
export function transferSupply(stock: SupplyStock, inventory: SupplyInventory, capacity: Pick<ClassDef, 'pouch' | 'healthKits'>, item: SupplyItem): SupplyTransfer {
  const reject = (status: SupplyTransfer['status']): SupplyTransfer => ({ status, amount: 0, stock, inventory });
  switch (item.kind) {
    case 'projectile': {
      const index = (PROJECTILE_IDS as readonly string[]).indexOf(item.projectile);
      const cap = capacity.pouch[index] ?? 0;
      const carried = inventory.pouch[index] ?? 0;
      if (index < 0 || index === PROJECTILE_IDS.indexOf('smokecloud') || (item.projectile !== 'frag' && inventory.equipment !== index) || !Number.isInteger(cap) || cap <= 0 || !Number.isInteger(carried) || carried < 0) return reject('incompatible');
      if (carried >= cap) return reject('full');
      const amount = Math.min(cap - carried, stock.projectiles[item.projectile] ?? 0);
      if (amount <= 0) return reject('empty');
      const pouch = [...inventory.pouch];
      pouch[index] = carried + amount;
      return {
        status: 'transferred', amount,
        stock: { ...stock, projectiles: { ...stock.projectiles, [item.projectile]: stock.projectiles[item.projectile]! - amount } },
        inventory: { ...inventory, pouch },
      };
    }
    case 'health-kit': {
      if (!Number.isInteger(capacity.healthKits) || capacity.healthKits <= 0 || !Number.isInteger(inventory.kits) || inventory.kits < 0) return reject('incompatible');
      if (inventory.kits >= capacity.healthKits) return reject('full');
      if (stock.healthKits <= 0) return reject('empty');
      return { status: 'transferred', amount: 1, stock: { ...stock, healthKits: stock.healthKits - 1 }, inventory: { ...inventory, kits: inventory.kits + 1 } };
    }
    case 'primary-ammo': {
      const def = Object.hasOwn(WEAPONS, inventory.heldWeapon) ? WEAPONS[inventory.heldWeapon] : undefined;
      if (!def || def.role === 'pistol' || def.role === 'melee' || (inventory.heldWeapon !== inventory.primary && inventory.heldWeapon !== inventory.secondary) || !Number.isInteger(inventory.ammo) || inventory.ammo < 0) return reject('incompatible');
      if (inventory.ammo >= def.magSize) return reject('full');
      const perRound = SUPPLY_AMMO_UNITS_PER_MAGAZINE / def.magSize;
      const amount = Math.min(def.magSize - inventory.ammo, Math.floor(stock.primaryAmmoUnits / perRound));
      if (amount <= 0) return reject('empty');
      return {
        status: 'transferred', amount,
        stock: { ...stock, primaryAmmoUnits: stock.primaryAmmoUnits - amount * perRound },
        inventory: { ...inventory, ammo: inventory.ammo + amount },
      };
    }
  }
}
