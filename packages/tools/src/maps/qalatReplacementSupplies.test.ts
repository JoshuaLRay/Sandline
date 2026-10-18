/** U-229: §12 fixed stock and candidate-floor authoring, no live activation. */
import { describe, expect, it } from 'vitest';
import { parseSupplyCaches, requireWorld, SUPPLY_AMMO_UNITS_PER_MAGAZINE,
  transferSupply, type SupplyInventory } from '@sandline/shared';
import { replacementInputs } from './qalatReplacement.ts';
import { buildReplacementSupplies } from './qalatReplacementSupplies.ts';
import { Session } from '../../../server/src/session/Session.ts';
import raw from './qalat-replacement-supplies.json' with { type: 'json' };

const cacheIds = ['P-SOUTH', 'P-ROAD', 'P-RIDGE', 'P-BASEMENT', 'P-OUTPOST'];
const at = [[50,8,58],[-6,8,118],[86,14,102],[-21,0,314],[14,8,380]];
const rockets = [6,0,0,6,12], mags = [6,3,3,3,6], kits = [2,1,1,1,3];

describe('U-229 staged Qalat supply caches', () => {
  it('declares exactly five fixed IDs, 24 rockets, 21 magazine equivalents and 8 kit charges', () => {
    const items = parseSupplyCaches(raw);
    expect(items.map((c) => c.id)).toEqual(cacheIds);
    expect(items.map((c) => [c.feet.x,c.feet.y,c.feet.z])).toEqual(at);
    expect(items.map((c) => c.stock.projectiles.rocket ?? 0)).toEqual(rockets);
    expect(items.map((c) => c.stock.primaryAmmoUnits)).toEqual(mags.map((n) => n * SUPPLY_AMMO_UNITS_PER_MAGAZINE));
    expect(items.map((c) => c.stock.healthKits)).toEqual(kits);
    expect(items.reduce((n, c) => n + (c.stock.projectiles.rocket ?? 0), 0)).toBe(24);
    expect(items.every((c) => Object.keys(c.stock.projectiles).every((key) => key === 'rocket'))).toBe(true);
  });
  it('requires the candidate revision and validates support and headroom at each constructed cache floor', () => {
    const { world } = replacementInputs();
    expect(buildReplacementSupplies(world)).toEqual(parseSupplyCaches(raw));
    expect(world.mission).toBeNull();
    expect(requireWorld('qalat-road').mapRevision ?? 1).toBe(1);
    expect(() => buildReplacementSupplies({ ...world, mapRevision: 1 })).toThrow(/revision 2/);
    expect(() => buildReplacementSupplies({ ...world, id: 'qalat-road' })).toThrow(/unregistered/);
  }, 60_000);
  it('initializes all five authored cache identities and finite stocks in a real isolated Session', () => {
    const { world } = replacementInputs();
    const supplyCaches = buildReplacementSupplies(world);
    const session = new Session(undefined, '', world, {
      events: { world: world.id, blockers: [], events: [], supplyCaches }, loadouts: 'class',
    });
    try {
      expect(session.supplyCaches).toEqual(supplyCaches);
      expect(session.supplyCaches.map((cache) => cache.id)).toEqual(cacheIds);
      expect(session.supplyCaches.reduce((n, cache) => n + (cache.stock.projectiles.rocket ?? 0), 0)).toBe(24);
    } finally {
      session.close();
    }
  }, 120_000);
  it('uses the existing finite stock transfer: partial refills, full/incompatible choices consume nothing', () => {
    const stock = parseSupplyCaches(raw)[0]!.stock;
    const inventory: SupplyInventory = {
      primary: 'm4', secondary: null, heldWeapon: 'm4', ammo: 28, equipment: -1,
      pouch: [], kits: 0,
    };
    const capacity = { pouch: [], healthKits: 3 };
    const kit = transferSupply(stock, inventory, capacity, { kind: 'health-kit' });
    expect(kit.status).toBe('transferred');
    expect(kit.stock.healthKits).toBe(1);
    expect(kit.inventory.kits).toBe(1);
    const empty = transferSupply(kit.stock, { ...kit.inventory, kits: 3 }, capacity, { kind: 'health-kit' });
    expect(empty.status).toBe('full'); expect(empty.stock).toBe(kit.stock);
    const incompatible = transferSupply(stock, inventory, capacity, { kind: 'projectile', projectile: 'rocket' });
    expect(incompatible.status).toBe('incompatible'); expect(incompatible.stock).toBe(stock);
  });
  it('refuses duplicate identities and fake firearm stock under the existing parser', () => {
    expect(() => parseSupplyCaches([raw[0], raw[0]])).toThrow(/duplicate/);
    expect(() => parseSupplyCaches([{ ...raw[0], stock: { ...raw[0]!.stock, weapon: 'rocket' } }])).toThrow(/unknown key/);
  });
});
