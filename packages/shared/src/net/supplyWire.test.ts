import { describe, expect, it } from 'vitest';
import { Sfc32 } from '../math/prng.ts';
import { PROJECTILE_IDS } from '../sim/ballistics.ts';
import { parseSupplyCacheStocks, parseSupplyItem, type SupplyCacheDef, type SupplyItem } from '../sim/supplyCaches.ts';
import { BitWriter } from './BitStream.ts';
import { POSITION } from './quantize.ts';
import { decodeMessage, encodeMessage, ProtocolError, type Message } from './protocol.ts';

const IDS = PROJECTILE_IDS.filter((id) => id !== 'smokecloud');
const items: SupplyItem[] = [{ kind: 'health-kit' }, { kind: 'primary-ammo' }, ...IDS.map((projectile) => ({ kind: 'projectile' as const, projectile }))];
const stock = { projectiles: { rocket: 65535, frag: 0 }, healthKits: 65535, primaryAmmoUnits: 65535 * 2400 };
const cache: SupplyCacheDef = { id: 'cache', feet: { x: 1.125, y: 8, z: -2 }, stock };

describe('dedicated cache wire (U-133)', () => {
  it('round-trips all three message types over 10,000 randomized stock, item, floor and progress samples', () => {
    const rng = new Sfc32(133);
    for (let i = 0; i < 10_000; i++) {
      const caches: SupplyCacheDef[] = Array.from({ length: rng.nextUint32() % 4 + 1 }, (_, k) => ({
        id: `C${k}_${i}`,
        feet: { x: (rng.nextUint32() % 60000 - 30000) / 64, y: (rng.nextUint32() % 60000 - 30000) / 64, z: (rng.nextUint32() % 60000 - 30000) / 64 },
        stock: { projectiles: Object.fromEntries(IDS.filter(() => rng.nextUint32() % 2 === 0).map((id) => [id, rng.nextUint32() % 65536])),
          healthKits: rng.nextUint32() % 65536, primaryAmmoUnits: rng.nextUint32() % (65535 * 2400 + 1) },
      }));
      const messages: Message[] = [
        { kind: 'Supplies', full: rng.nextUint32() % 2 === 0, caches },
        { kind: 'SupplySelect', requestId: rng.nextUint32(), cacheId: caches[0]!.id, item: i % 10 === 0 ? null : items[i % items.length]! },
        { kind: 'SupplyProgress', uses: Array.from({ length: rng.nextUint32() % 7 }, (_, slot) => ({ slot, cacheId: caches[slot % caches.length]!.id, item: items[rng.nextUint32() % items.length]!, percent: rng.nextUint32() % 101 })) },
      ];
      for (const msg of messages) expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    }
  });

  it('retains maximum stock, 64-byte IDs, 64 caches, exact zero entries and empty scenery', () => {
    const caches = Array.from({ length: 64 }, (_, i) => ({ ...cache, id: `${i}`.padEnd(64, 'a') }));
    const full: Message = { kind: 'Supplies', full: true, caches };
    expect(decodeMessage(encodeMessage(full))).toEqual(full);
    const exhausted: Message = { kind: 'Supplies', full: false, caches: [{ ...cache, stock: { projectiles: { rocket: 0 }, healthKits: 0, primaryAmmoUnits: 0 } }] };
    expect(decodeMessage(encodeMessage(exhausted))).toEqual(exhausted);
    expect(decodeMessage(encodeMessage({ kind: 'SupplySelect', requestId: 0xffffffff, cacheId: 'cache', item: null }))).toMatchObject({ requestId: 0xffffffff, item: null });
  });

  it('refuses invalid IDs, stock, choices, duplicate users and oversized lists on write', () => {
    for (const id of ['', 'é', 'bad/id', '__proto__', 'x'.repeat(65)]) expect(() => encodeMessage({ kind: 'SupplySelect', requestId: 1, cacheId: id, item: items[0]! })).toThrow();
    for (const requestId of [-1, 1.2, 0x100000000]) expect(() => encodeMessage({ kind: 'SupplySelect', requestId, cacheId: 'cache', item: items[0]! })).toThrow();
    for (const bad of [null, {}, { kind: 'projectile', projectile: 'smokecloud' }, { kind: 'primary-ammo', projectile: 'frag' }, { kind: 'weapon', weapon: 'carbine' }]) expect(() => parseSupplyItem(bad)).toThrow();
    expect(() => encodeMessage({ kind: 'Supplies', full: true, caches: Array(65).fill(cache) })).toThrow();
    expect(() => encodeMessage({ kind: 'Supplies', full: true, caches: [cache, cache] })).toThrow();
    expect(() => parseSupplyCacheStocks([{ id: 'cache', stock: { ...stock, healthKits: -1 } }])).toThrow();
    const use = { slot: 0, cacheId: 'cache', item: items[0]!, percent: 50 };
    for (const uses of [[use, use], [{ ...use, slot: 6 }], [{ ...use, percent: 101 }], Array(7).fill(use)]) expect(() => encodeMessage({ kind: 'SupplyProgress', uses })).toThrow();
  });

  it('refuses forged list lengths, stock overflows, item codes, duplicate slots and truncation on read', () => {
    const header = (variant: number) => { const w = new BitWriter(); w.writeBits(15, 4); w.writeBits(7, 3); w.writeBits(variant, 4); return w; };
    const list = header(11); list.writeBool(true); list.writeVarUint(65);
    expect(() => decodeMessage(list.toUint8Array())).toThrow(ProtocolError);
    const choice = header(10); choice.writeBits(1, 32); choice.writeString('cache'); choice.writeBits(15, 4);
    expect(() => decodeMessage(choice.toUint8Array())).toThrow(ProtocolError);
    const overflow = encodeMessage({ kind: 'Supplies', full: true, caches: [{ ...cache, stock: { ...stock, healthKits: 0 } }] });
    expect(() => decodeMessage(overflow.slice(0, -1))).toThrow(ProtocolError);
    const badStock = header(11); badStock.writeBool(true); badStock.writeVarUint(1); badStock.writeString('cache');
    badStock.writeBits(0, POSITION.bits); badStock.writeBits(0, POSITION.bits); badStock.writeBits(0, POSITION.bits);
    IDS.forEach(() => badStock.writeBool(false)); badStock.writeVarUint(65536); badStock.writeVarUint(0);
    expect(() => decodeMessage(badStock.toUint8Array())).toThrow(ProtocolError);
    // 2^32 in five LEB128 bytes must not wrap to zero before stock validation.
    const wrapped = header(11); wrapped.writeBool(true); wrapped.writeVarUint(1); wrapped.writeString('cache');
    for (let i = 0; i < 3; i++) wrapped.writeBits(0, POSITION.bits);
    IDS.forEach(() => wrapped.writeBool(false));
    for (let i = 0; i < 4; i++) wrapped.writeBits(0x80, 8);
    wrapped.writeBits(0x10, 8); wrapped.writeVarUint(0);
    expect(() => decodeMessage(wrapped.toUint8Array())).toThrow(ProtocolError);
    const users = header(12); users.writeVarUint(2);
    for (let i = 0; i < 2; i++) { users.writeBits(0, 3); users.writeString('cache'); users.writeBits(1, 4); users.writeBits(50, 7); }
    expect(() => decodeMessage(users.toUint8Array())).toThrow(ProtocolError);
    for (const msg of [
      { kind: 'Supplies', full: true, caches: [cache] },
      { kind: 'SupplySelect', requestId: 1, cacheId: 'cache', item: items[0]! },
      { kind: 'SupplyProgress', uses: [{ slot: 0, cacheId: 'cache', item: items[0]!, percent: 100 }] },
    ] as const) expect(() => decodeMessage(encodeMessage(msg).slice(0, -1))).toThrow(ProtocolError);
  });
});

describe('commander cache wire (U-146)', () => {
  it('round-trips every recipient, supply type and cancellation with full-width request IDs', () => {
    const rng = new Sfc32(146);
    for (let slot = 0; slot < 6; slot++) {
      for (const item of [null, ...items]) {
        for (const requestId of [0, rng.nextUint32(), 0xffffffff]) {
          const msg: Message = { kind: 'CommanderSupplySelect', requestId, slot, cacheId: 'c'.repeat(64), item };
          expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
        }
      }
    }
  });

  it('rejects invalid recipients, requests, cache IDs and choices before sending', () => {
    const valid: Extract<Message, { kind: 'CommanderSupplySelect' }> = { kind: 'CommanderSupplySelect', requestId: 1, slot: 0, cacheId: 'cache', item: items[0]! };
    for (const slot of [-1, 6, 7, 1.5, Number.NaN]) expect(() => encodeMessage({ ...valid, slot })).toThrow();
    for (const requestId of [-1, 1.5, 0x100000000, Number.NaN]) expect(() => encodeMessage({ ...valid, requestId })).toThrow();
    for (const cacheId of ['', 'bad/id', '__proto__', 'é', 'x'.repeat(65)]) expect(() => encodeMessage({ ...valid, cacheId })).toThrow();
    expect(() => encodeMessage({ ...valid, item: { kind: 'projectile', projectile: 'smokecloud' } as unknown as SupplyItem })).toThrow();
  });

  it('rejects forged out-of-squad slots, unsafe cache IDs, invalid item codes and truncation', () => {
    const forged = (slot: number, cacheId: string, item: number): Uint8Array => {
      const w = new BitWriter();
      w.writeBits(15, 4); w.writeBits(7, 3); w.writeBits(14, 4);
      w.writeBits(1, 32); w.writeBits(slot, 3); w.writeString(cacheId); w.writeBits(item, 4);
      return w.toUint8Array();
    };
    for (const slot of [6, 7]) expect(() => decodeMessage(forged(slot, 'cache', 1))).toThrow(ProtocolError);
    for (const cacheId of ['', '__proto__', 'é', 'x'.repeat(65)]) expect(() => decodeMessage(forged(0, cacheId, 1))).toThrow(ProtocolError);
    expect(() => decodeMessage(forged(0, 'cache', 15))).toThrow(ProtocolError);
    const bytes = encodeMessage({ kind: 'CommanderSupplySelect', requestId: 1, slot: 5, cacheId: 'cache', item: null });
    for (let length = 0; length < bytes.length; length++) expect(() => decodeMessage(bytes.slice(0, length))).toThrow(ProtocolError);
  });
});
