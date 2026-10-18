/** U-229: §12 fixed stock and candidate-floor authoring, no live activation. */
import { describe, expect, it } from 'vitest';
import { ClientConnection, createLoopbackPair, createMoveState, parseSupplyCaches, PROTOCOL_VERSION,
  requireWorld, SUPPLY_AMMO_UNITS_PER_MAGAZINE, TICK_SECONDS, transferSupply,
  type SupplyInventory } from '@sandline/shared';
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
  it('runs one-second authoritative transfers at all five actual constructed cache floors', () => {
    const { world } = replacementInputs();
    const supplyCaches = buildReplacementSupplies(world);
    const session = new Session(undefined, '', world, {
      events: { world: world.id, blockers: [], events: [], supplyCaches }, loadouts: 'class',
    });
    const pair = createLoopbackPair();
    let now = 0, tick = 0, requestId = 0;
    const settle = () => { for (let i = 0; i < 3; i++) pair.settle(); };
    const client = new ClientConnection(pair.b);
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        now += TICK_SECONDS * 1000; tick++;
        client.send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0b1000 });
        settle(); session.step(now); settle();
      }
    };
    try {
      session.addConnection(pair.a, now);
      client.send({ kind: 'Join', version: PROTOCOL_VERSION, name: 'U229', room: '', slot: 0 });
      settle();
      const soldier = session.slots[0]!;
      for (const cache of supplyCaches) {
        soldier.state = createMoveState(cache.feet.x, cache.feet.y, cache.feet.z);
        soldier.kits = 0;
        client.send({ kind: 'SupplySelect', requestId: ++requestId, cacheId: cache.id, item: { kind: 'health-kit' } });
        settle(); step(30);
        expect(soldier.kits, cache.id).toBe(1);
        expect(session.supplyCaches.find((c) => c.id === cache.id)!.stock.healthKits, cache.id)
          .toBe(cache.stock.healthKits - 1);
      }
      // A cache directly above/below cannot be collected from the wrong storey,
      // even when x/z coincide and the item is compatible.
      const high = supplyCaches[4]!;
      soldier.state = createMoveState(high.feet.x, 0, high.feet.z);
      soldier.kits = 0;
      client.send({ kind: 'SupplySelect', requestId: ++requestId, cacheId: high.id, item: { kind: 'health-kit' } });
      settle(); step(31);
      expect(soldier.kits).toBe(0);
      expect(session.supplyCaches.find((c) => c.id === high.id)!.stock.healthKits)
        .toBe(high.stock.healthKits - 1);
    } finally {
      session.close();
    }
  }, 180_000);
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
