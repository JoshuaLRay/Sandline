import { describe, expect, it } from 'vitest';
import { PROJECTILE_IDS } from './ballistics.ts';
import { classById } from './classes.ts';
import { encounterFor } from './encounters.ts';
import { emptyEventScript, parseEventScript } from './events.ts';
import { requireWorld } from './world.ts';
import { WEAPONS } from './weapons.ts';
import {
  parseSupplyCaches, parseSupplyRules, parseSupplyStock, SUPPLY_AMMO_UNITS_PER_MAGAZINE as UNITS,
  SUPPLY_RULES, transferSupply, type SupplyInventory, type SupplyItem, type SupplyStock,
} from './supplyCaches.ts';

// §12 contents/feet are a fixture, not production authoring (U-117).
const fiveCaches = [
  { id: 'P-SOUTH', feet: { x: 50, y: 8, z: 58 }, stock: { projectiles: { rocket: 6 }, primaryMagazines: 6, healthKits: 2 } },
  { id: 'P-ROAD', feet: { x: -6, y: 8, z: 118 }, stock: { primaryMagazines: 3, healthKits: 1 } },
  { id: 'P-RIDGE', feet: { x: 86, y: 14, z: 102 }, stock: { primaryMagazines: 3, healthKits: 1 } },
  { id: 'P-BASEMENT', feet: { x: -22, y: 0, z: 314 }, stock: { projectiles: { rocket: 6 }, primaryMagazines: 3, healthKits: 1 } },
  { id: 'P-OUTPOST', feet: { x: 14, y: 8, z: 380 }, stock: { projectiles: { rocket: 12 }, primaryMagazines: 6, healthKits: 3 } },
];
const brennan = classById('brennan')!;
const rocket: SupplyItem = { kind: 'projectile', projectile: 'rocket' };
const medical: SupplyItem = { kind: 'health-kit' };
const ammunition: SupplyItem = { kind: 'primary-ammo' };
const stock = (): SupplyStock => ({ projectiles: { rocket: 6, frag: 2 }, healthKits: 2, primaryAmmoUnits: 3 * UNITS });
const inventory = (overrides: Partial<SupplyInventory> = {}): SupplyInventory => ({
  primary: 'lmg', secondary: null, heldWeapon: 'lmg', ammo: 80,
  equipment: PROJECTILE_IDS.indexOf('rocket'), pouch: brennan.pouch.map(() => 0), kits: 1,
  ...overrides,
});

function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

describe('finite supply content (U-132)', () => {
  it('retains all five authored IDs/floors and exact §12 stocks through script validation', () => {
    const world = requireWorld('greybox-01');
    const script = parseEventScript({ ...emptyEventScript(world.id), supplyCaches: fiveCaches }, encounterFor(world.id)!, world, null);
    expect(script.supplyCaches?.map((c) => ({ id: c.id, feet: c.feet }))).toEqual(fiveCaches.map((c) => ({ id: c.id, feet: c.feet })));
    const caches = script.supplyCaches!;
    expect(caches.reduce((n, c) => n + (c.stock.projectiles.rocket ?? 0), 0)).toBe(24);
    expect(caches.reduce((n, c) => n + c.stock.primaryAmmoUnits, 0)).toBe(21 * UNITS);
    expect(caches.reduce((n, c) => n + c.stock.healthKits, 0)).toBe(8);
    expect(caches[3]!.feet.y).toBe(0);
    caches.forEach((c, i) => {
      expect(c.stock).toEqual({
        projectiles: fiveCaches[i]!.stock.projectiles ?? {},
        healthKits: fiveCaches[i]!.stock.healthKits,
        primaryAmmoUnits: fiveCaches[i]!.stock.primaryMagazines * UNITS,
      });
      expect(parseSupplyStock(JSON.parse(JSON.stringify(c.stock)))).toEqual(c.stock);
    });
  });

  it('keeps legacy scripts unchanged and caches separate from pickup actions', () => {
    const world = requireWorld('greybox-01');
    const encounter = encounterFor(world.id)!;
    expect(parseEventScript(emptyEventScript(world.id), encounter, world, null)).toEqual(emptyEventScript(world.id));
    expect(parseSupplyCaches([])).toEqual([]);
    expect(() => parseEventScript({ ...emptyEventScript(world.id), supplyCache: fiveCaches }, encounter, world, null)).toThrow(/unknown key 'supplyCache'/);
    expect(() => parseEventScript({ ...emptyEventScript(world.id), events: [{ id: 'fake-rocket', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'pickup', weapon: 'rocket', x: 0, z: 0 }] }] }, encounter, world, null)).toThrow(/expected a gun/);
  });

  it('rejects duplicate/malformed IDs and invalid list shapes without borrowing pickup IDs', () => {
    expect(() => parseSupplyCaches([fiveCaches[0], fiveCaches[0]])).toThrow(/duplicate cache 'P-SOUTH'/);
    for (const id of ['', 'x'.repeat(65), '-leading', 'cache space', 'é', 1, '__proto__']) {
      expect(() => parseSupplyCaches([{ ...fiveCaches[0], id }])).toThrow(/\.id/);
    }
    for (const raw of [null, {}, Array(65).fill(fiveCaches[0])]) expect(() => parseSupplyCaches(raw)).toThrow(/list/);
  });

  it('requires all three finite feet coordinates within the shared position range', () => {
    for (const axis of ['x', 'y', 'z']) for (const value of [NaN, Infinity, -Infinity, 512, -512.01, '0', null]) {
      expect(() => parseSupplyCaches([{ ...fiveCaches[0], feet: { ...fiveCaches[0]!.feet, [axis]: value } }])).toThrow(new RegExp(`feet.${axis}`));
    }
    expect(() => parseSupplyCaches([{ ...fiveCaches[0], feet: { x: 0, z: 0 } }])).toThrow(/missing 'y'/);
  });

  it('rejects misspelled/unknown keys throughout cache, feet and stock', () => {
    for (const bad of [
      { ...fiveCaches[0], netId: 1 },
      { ...fiveCaches[0], feet: { ...fiveCaches[0]!.feet, yaw: 0 } },
      { ...fiveCaches[0], stock: { rounds: 6 } },
      { ...fiveCaches[0], stock: { projectiles: { rockett: 6 } } },
      { ...fiveCaches[0], stock: { projectiles: { toString: 6 } } },
      { ...fiveCaches[0], stock: { projectiles: { smokecloud: 6 } } },
    ]) expect(() => parseSupplyCaches([bad])).toThrow(/unknown key/);
    for (const field of ['id', 'feet', 'stock']) {
      const bad: Record<string, unknown> = { ...fiveCaches[0] };
      delete bad[field];
      expect(() => parseSupplyCaches([bad])).toThrow(/missing/);
    }
  });

  it('rejects invalid/nonfinite/fractional stocks rather than clamping or inventing supplies', () => {
    for (const value of [-1, .5, NaN, Infinity, '2', null, 65536]) {
      for (const bad of [{ projectiles: { rocket: value } }, { healthKits: value }, { primaryMagazines: value }]) {
        expect(() => parseSupplyCaches([{ ...fiveCaches[0], stock: bad }])).toThrow();
      }
    }
    for (const projectiles of [null, [], 1]) expect(() => parseSupplyCaches([{ ...fiveCaches[0], stock: { projectiles } }])).toThrow(/object/);
    expect(parseSupplyCaches([{ ...fiveCaches[0], stock: {} }])[0]!.stock).toEqual({ projectiles: {}, healthKits: 0, primaryAmmoUnits: 0 });
  });

  it('validates durable stock including fractional-magazine remainders without rescaling', () => {
    const remaining = { projectiles: { rocket: 0 }, healthKits: 0, primaryAmmoUnits: 1 };
    expect(parseSupplyStock(JSON.parse(JSON.stringify(remaining)))).toEqual(remaining);
    for (const primaryAmmoUnits of [-1, .5, NaN, Infinity, 65535 * UNITS + 1]) expect(() => parseSupplyStock({ ...remaining, primaryAmmoUnits })).toThrow(/primaryAmmoUnits/);
    expect(() => parseSupplyStock({ ...remaining, primaryMagazines: 1 })).toThrow(/unknown key/);
    expect(() => parseSupplyStock({ healthKits: 0, primaryAmmoUnits: 0 })).toThrow(/missing 'projectiles'/);
  });

  it('reads validated one-second/2 m defaults from data', () => {
    expect(SUPPLY_RULES).toEqual({ useSeconds: 1, reachM: 2 });
    for (const raw of [{ useSeconds: 0, reachM: 2 }, { useSeconds: Infinity, reachM: 2 }, { useSeconds: 1, reachM: 0 }, { useSeconds: 1, reachM: 4 }, { useSeconds: 1, reachM: 2, radius: 2 }]) expect(() => parseSupplyRules(raw)).toThrow();
  });
});

describe('capacity-safe supply transfers (U-132)', () => {
  it('fills Brennan only to two rockets, retains leftovers and changes no other inventory', () => {
    const beforeStock = frozen(stock());
    const beforeInventory = frozen(inventory());
    const result = transferSupply(beforeStock, beforeInventory, brennan, rocket);
    expect(result.status).toBe('transferred');
    expect(result.amount).toBe(2);
    expect(result.stock).toEqual({ ...beforeStock, projectiles: { rocket: 4, frag: 2 } });
    expect(result.inventory).toEqual({ ...beforeInventory, pouch: brennan.pouch.map((_, i) => i === PROJECTILE_IDS.indexOf('rocket') ? 2 : 0) });
    const full = transferSupply(result.stock, result.inventory, brennan, rocket);
    expect(full.status).toBe('full');
    expect(full.amount).toBe(0);
    expect(full.stock).toBe(result.stock);
    expect(full.inventory).toBe(result.inventory);
  });

  it('partially supplies the free rocket capacity and leaves the remaining finite stock', () => {
    const pouch = [...brennan.pouch];
    pouch[PROJECTILE_IDS.indexOf('rocket')] = 1;
    const result = transferSupply(stock(), inventory({ pouch }), brennan, rocket);
    expect(result.amount).toBe(1);
    expect(result.stock.projectiles.rocket).toBe(5);
    expect(result.inventory.pouch[PROJECTILE_IDS.indexOf('rocket')]).toBe(2);
    const scarce = transferSupply({ ...stock(), projectiles: { rocket: 1 } }, inventory(), brennan, rocket);
    expect(scarce.amount).toBe(1);
    expect(scarce.stock.projectiles.rocket).toBe(0);
  });

  it('rejects another class, missing/replaced equipment and malformed projectile selections without cost', () => {
    const beforeStock = frozen(stock());
    const beforeInventory = frozen(inventory());
    for (const [who, capacity, choice] of [
      [beforeInventory, classById('preach')!, rocket],
      [inventory({ equipment: -1 }), brennan, rocket],
      [inventory({ equipment: PROJECTILE_IDS.indexOf('c4') }), brennan, rocket],
      [beforeInventory, brennan, { kind: 'projectile', projectile: 'smokecloud' } as unknown as SupplyItem],
      [beforeInventory, brennan, { kind: 'projectile', projectile: 'unknown' } as unknown as SupplyItem],
    ] as const) {
      const result = transferSupply(beforeStock, who, capacity, choice);
      expect(result).toMatchObject({ status: 'incompatible', amount: 0 });
      expect(result.stock).toBe(beforeStock);
      expect(result.inventory).toBe(who);
    }
  });

  it('supports each carried projectile with the owning class capacity, including frag without slot 5', () => {
    for (const id of ['preach', 'brennan', 'holloway', 'ortiz', 'marsh', 'vance']) {
      const cls = classById(id)!;
      const equipment = (PROJECTILE_IDS as readonly string[]).indexOf(cls.equipment ?? '');
      for (const projectile of PROJECTILE_IDS) {
        if (projectile === 'smokecloud') continue;
        const cap = cls.pouch[PROJECTILE_IDS.indexOf(projectile)]!;
        const result = transferSupply({ ...stock(), projectiles: { [projectile]: 1 } }, inventory({ equipment }), cls, { kind: 'projectile', projectile });
        expect(result.status).toBe(cap > 0 ? 'transferred' : 'incompatible');
        if (cap > 0) expect(result.inventory.pouch[PROJECTILE_IDS.indexOf(projectile)]).toBe(1);
      }
    }
  });

  it('restores exactly one kit charge per use up to existing capacity, preserving weapons/pouch', () => {
    const before = frozen(inventory({ kits: 0 }));
    const first = transferSupply(frozen(stock()), before, brennan, medical);
    expect(first.amount).toBe(1);
    expect(first.inventory).toEqual({ ...before, kits: 1 });
    expect(first.stock).toEqual({ ...stock(), healthKits: 1 });
    const second = transferSupply(first.stock, first.inventory, brennan, medical);
    expect(second.stock.healthKits).toBe(0);
    expect(second.inventory.kits).toBe(2);
    const last = transferSupply(stock(), inventory({ kits: 2 }), brennan, medical);
    expect(last.inventory.kits).toBe(3);
    expect(transferSupply(last.stock, last.inventory, brennan, medical).status).toBe('full');
  });

  it('empty attempts consume nothing, including unavailable projectile keys and sub-round ammo remnants', () => {
    const empty = frozen({ projectiles: {}, healthKits: 0, primaryAmmoUnits: 1 });
    const who = frozen(inventory());
    for (const choice of [rocket, medical, ammunition]) {
      const result = transferSupply(empty, who, brennan, choice);
      expect(result).toMatchObject({ status: 'empty', amount: 0 });
      expect(result.stock).toBe(empty);
      expect(result.inventory).toBe(who);
    }
  });

  it('serial recomputation against the latest stock cannot overdraw a last charge/round', () => {
    for (const [finiteStock, choice] of [
      [{ ...stock(), projectiles: { rocket: 1 } }, rocket],
      [{ ...stock(), healthKits: 1 }, medical],
      [{ ...stock(), primaryAmmoUnits: UNITS / WEAPONS['lmg']!.magSize }, ammunition],
    ] as const) {
      const first = transferSupply(finiteStock, inventory(), brennan, choice);
      const second = transferSupply(first.stock, inventory(), brennan, choice);
      expect(first.amount).toBe(1);
      expect(second.status).toBe('empty');
      expect(second.amount).toBe(0);
    }
  });

  for (const def of Object.values(WEAPONS).filter((w) => w.role !== 'pistol' && w.role !== 'melee')) {
    it(`${def.id}: refills only missing whole rounds and charges exactly their magazine fraction`, () => {
      const who = frozen(inventory({ primary: def.id, heldWeapon: def.id, ammo: def.magSize - 1 }));
      const result = transferSupply(frozen(stock()), who, brennan, ammunition);
      expect(result.amount).toBe(1);
      expect(result.inventory).toEqual({ ...who, ammo: def.magSize });
      expect(result.stock).toEqual({ ...stock(), primaryAmmoUnits: 3 * UNITS - UNITS / def.magSize });
      expect(transferSupply(result.stock, result.inventory, brennan, ammunition).status).toBe('full');
      let pool = stock();
      let total = 0;
      while (true) {
        const next = transferSupply(pool, { ...who, ammo: 0 }, brennan, ammunition);
        if (next.amount === 0) break;
        total += next.amount;
        pool = next.stock;
      }
      expect(total).toBe(3 * def.magSize);
      expect(pool.primaryAmmoUnits).toBe(0);
    });
  }

  it('preserves mixed SMG/rifle/LMG fractions through JSON without creating whole rounds', () => {
    let pool = { ...stock(), primaryAmmoUnits: UNITS };
    // One missing SMG round consumes 1/32; one rifle round 1/30; LMG rounds 1/100.
    const smg = transferSupply(pool, inventory({ primary: 'smg', heldWeapon: 'smg', ammo: 31 }), brennan, ammunition);
    const rifle = transferSupply(smg.stock, inventory({ primary: 'carbine', heldWeapon: 'carbine', ammo: 29 }), brennan, ammunition);
    expect(rifle.stock.primaryAmmoUnits).toBe(UNITS - 75 - 80);
    pool = parseSupplyStock(JSON.parse(JSON.stringify(rifle.stock)));
    const lmg = transferSupply(pool, inventory({ ammo: 0 }), brennan, ammunition);
    expect(lmg.amount).toBe(93);
    expect(lmg.stock.primaryAmmoUnits).toBe(13);
    expect(75 + 80 + lmg.amount * 24 + lmg.stock.primaryAmmoUnits).toBe(UNITS);
    expect(transferSupply(lmg.stock, inventory({ ammo: 0 }), brennan, ammunition).status).toBe('empty');
  });

  it('resupplies a held secondary primary but never a pistol, knife, unknown or stowed gun', () => {
    const dual = inventory({ primary: 'smg', secondary: 'breacher', heldWeapon: 'breacher', ammo: 0 });
    expect(transferSupply(stock(), dual, classById('holloway')!, ammunition).inventory).toEqual({ ...dual, ammo: 6 });
    for (const who of [
      inventory({ heldWeapon: 'sidearm', ammo: 0 }),
      inventory({ heldWeapon: 'knife', primary: 'knife', ammo: 0 }),
      inventory({ heldWeapon: 'carbine', ammo: 0 }),
      inventory({ heldWeapon: 'unknown', primary: 'unknown', ammo: 0 }),
      inventory({ heldWeapon: 'toString', primary: 'toString', ammo: 0 }),
    ]) {
      const result = transferSupply(stock(), who, brennan, ammunition);
      expect(result).toMatchObject({ status: 'incompatible', amount: 0 });
      expect(result.inventory).toBe(who);
    }
  });
});
