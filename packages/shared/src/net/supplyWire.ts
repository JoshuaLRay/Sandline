/** U-133: bounded cache messages, exact stock integers and quantized authored feet. */
import { PROJECTILE_IDS } from '../sim/ballistics.ts';
import {
  isSupplyCacheId, MAX_SUPPLY_CACHES, parseSupplyCacheStocks, parseSupplyItem, parseSupplyStock,
  type SupplyItem, type SupplyStock, type SupplyUseProgress,
} from '../sim/supplyCaches.ts';
import { BitReader, BitWriter } from './BitStream.ts';
import type { Message } from './protocol.ts';
import { POSITION, dequantize, quantize } from './quantize.ts';

const IDS = PROJECTILE_IDS.filter((id) => id !== 'smokecloud');
/** Refuse oversized LEB128 integers before 32-bit coercion can turn stock into zero. */
function readUint(r: BitReader): number {
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    const byte = r.readBits(8);
    if (shift === 28 && byte > 0x0f) throw new RangeError('supply integer overflow');
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
  }
  throw new RangeError('supply integer overflow');
}
const checkedId = (id: string): string => {
  if (!isSupplyCacheId(id)) throw new RangeError('invalid supply cache id');
  return id;
};
const count = (r: BitReader, max: number): number => {
  const n = readUint(r);
  if (n > max) throw new RangeError('supply list exceeds its bound');
  return n;
};

function writeItem(w: BitWriter, item: SupplyItem | null): void {
  if (item !== null) parseSupplyItem(item);
  w.writeBits(item === null ? 0 : item.kind === 'health-kit' ? 1 : item.kind === 'primary-ammo' ? 2 : 3 + IDS.indexOf(item.projectile), 4);
}
function readItem(r: BitReader): SupplyItem | null {
  const code = r.readBits(4);
  if (code === 0) return null;
  if (code === 1) return { kind: 'health-kit' };
  if (code === 2) return { kind: 'primary-ammo' };
  const projectile = IDS[code - 3];
  if (!projectile) throw new RangeError('invalid supply item code');
  return { kind: 'projectile', projectile };
}
function writeStock(w: BitWriter, stock: SupplyStock): void {
  parseSupplyStock(stock);
  for (const id of IDS) {
    const n = stock.projectiles[id];
    w.writeBool(n !== undefined);
    if (n !== undefined) w.writeVarUint(n);
  }
  w.writeVarUint(stock.healthKits);
  w.writeVarUint(stock.primaryAmmoUnits);
}
function readStock(r: BitReader): SupplyStock {
  const projectiles: Partial<Record<(typeof IDS)[number], number>> = {};
  for (const id of IDS) if (r.readBool()) projectiles[id] = readUint(r);
  return parseSupplyStock({ projectiles, healthKits: readUint(r), primaryAmmoUnits: readUint(r) });
}

export function writeSupplySelect(w: BitWriter, msg: Extract<Message, { kind: 'SupplySelect' }>): void {
  if (!Number.isInteger(msg.requestId) || msg.requestId < 0 || msg.requestId > 0xffffffff) throw new RangeError('invalid supply request id');
  w.writeBits(msg.requestId, 32);
  w.writeString(checkedId(msg.cacheId));
  writeItem(w, msg.item);
}
export function readSupplySelect(r: BitReader): Extract<Message, { kind: 'SupplySelect' }> {
  return { kind: 'SupplySelect', requestId: r.readBits(32), cacheId: checkedId(r.readString()), item: readItem(r) };
}

export function writeSupplies(w: BitWriter, msg: Extract<Message, { kind: 'Supplies' }>): void {
  parseSupplyCacheStocks(msg.caches.map(({ id, stock }) => ({ id, stock })));
  w.writeBool(msg.full);
  w.writeVarUint(msg.caches.length);
  for (const cache of msg.caches) {
    w.writeString(cache.id);
    for (const axis of ['x', 'y', 'z'] as const) {
      const n = cache.feet[axis];
      if (!Number.isFinite(n) || n < POSITION.min || n > POSITION.max) throw new RangeError('invalid supply feet');
      w.writeBits(quantize(n, POSITION), POSITION.bits);
    }
    writeStock(w, cache.stock);
  }
}
export function readSupplies(r: BitReader): Extract<Message, { kind: 'Supplies' }> {
  const full = r.readBool();
  const caches = Array.from({ length: count(r, MAX_SUPPLY_CACHES) }, () => ({
    id: checkedId(r.readString()),
    feet: {
      x: dequantize(r.readBits(POSITION.bits), POSITION),
      y: dequantize(r.readBits(POSITION.bits), POSITION),
      z: dequantize(r.readBits(POSITION.bits), POSITION),
    },
    stock: readStock(r),
  }));
  parseSupplyCacheStocks(caches.map(({ id, stock }) => ({ id, stock })));
  return { kind: 'Supplies', full, caches };
}

function checkUse(use: SupplyUseProgress, seen: Set<number>): void {
  if (!Number.isInteger(use.slot) || use.slot < 0 || use.slot > 5 || seen.has(use.slot)) throw new RangeError('invalid supply user slot');
  seen.add(use.slot);
  checkedId(use.cacheId);
  parseSupplyItem(use.item);
  if (!Number.isInteger(use.percent) || use.percent < 0 || use.percent > 100) throw new RangeError('invalid supply progress');
}
export function writeSupplyProgress(w: BitWriter, msg: Extract<Message, { kind: 'SupplyProgress' }>): void {
  if (msg.uses.length > 6) throw new RangeError('too many supply users');
  const seen = new Set<number>();
  w.writeVarUint(msg.uses.length);
  for (const use of msg.uses) {
    checkUse(use, seen);
    w.writeBits(use.slot, 3);
    w.writeString(use.cacheId);
    writeItem(w, use.item);
    w.writeBits(use.percent, 7);
  }
}
export function readSupplyProgress(r: BitReader): Extract<Message, { kind: 'SupplyProgress' }> {
  const seen = new Set<number>();
  const uses = Array.from({ length: count(r, 6) }, () => {
    const slot = r.readBits(3);
    const cacheId = checkedId(r.readString());
    const item = readItem(r);
    if (item === null) throw new RangeError('supply progress needs an item');
    const use = { slot, cacheId, item, percent: r.readBits(7) };
    checkUse(use, seen);
    return use;
  });
  return { kind: 'SupplyProgress', uses };
}
