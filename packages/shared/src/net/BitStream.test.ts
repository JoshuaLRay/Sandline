import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter, decodeUtf8, encodeUtf8 } from './BitStream.ts';
import { Sfc32 } from '../math/prng.ts';

const roundTrip = (write: (w: BitWriter) => void): BitReader => {
  const w = new BitWriter();
  write(w);
  return new BitReader(w.toUint8Array());
};

describe('BitWriter/BitReader (T-1.01)', () => {
  it('round-trips single bits', () => {
    const bits = [1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1];
    const r = roundTrip((w) => bits.forEach((b) => w.writeBits(b, 1)));
    for (const b of bits) expect(r.readBits(1)).toBe(b);
  });

  it('round-trips values at every bit width', () => {
    for (let width = 1; width <= 32; width++) {
      // Use 2**width, NOT (1 << width): the shift operators are signed 32-bit,
      // so `1 << 31` is negative and `(1 << 32)` is 1. Getting this wrong is the
      // classic way to produce a silently corrupt stream (ADR-009).
      const max = 2 ** width - 1;
      for (const v of [0, 1, max, Math.floor(max / 2), Math.floor(max / 3)]) {
        const r = roundTrip((w) => w.writeBits(v, width));
        expect(r.readBits(width)).toBe(v >>> 0);
      }
    }
  });

  it('handles the signed-shift boundary at 31 and 32 bits', () => {
    // Where the trap above lives, pinned explicitly. A reader that builds its
    // result with `1 << 31` gets a negative number unless it unsigns on return.
    const cases: [number, number][] = [
      [31, 0x7fffffff],
      [31, 0x40000000],
      [32, 0xffffffff],
      [32, 0x80000000],
      [32, 0xdeadbeef],
    ];
    for (const [width, value] of cases) {
      const r = roundTrip((w) => w.writeBits(value, width));
      const got = r.readBits(width);
      expect(got).toBe(value);
      expect(got).toBeGreaterThanOrEqual(0); // never leaks a negative
    }
  });

  // ADR-009: a serialization bug corrupts state silently rather than throwing,
  // so this is property-based over random inputs, not a handful of examples.
  it('survives 10,000 random mixed-width round-trips', () => {
    const rng = new Sfc32(0xbeef);
    const written: { value: number; width: number }[] = [];
    const w = new BitWriter();
    for (let i = 0; i < 10_000; i++) {
      const width = 1 + (rng.nextUint32() % 32);
      const max = width === 32 ? 0xffffffff : (1 << width) - 1;
      const value = rng.nextUint32() % (max + 1);
      w.writeBits(value, width);
      written.push({ value: value >>> 0, width });
    }
    const r = new BitReader(w.toUint8Array());
    for (const { value, width } of written) expect(r.readBits(width)).toBe(value);
  });

  it('round-trips booleans', () => {
    const r = roundTrip((w) => {
      w.writeBool(true);
      w.writeBool(false);
      w.writeBool(true);
    });
    expect([r.readBool(), r.readBool(), r.readBool()]).toEqual([true, false, true]);
  });

  it('round-trips varuints across magnitudes', () => {
    const values = [0, 1, 127, 128, 255, 256, 16383, 16384, 1 << 20, 0x7fffffff];
    const r = roundTrip((w) => values.forEach((v) => w.writeVarUint(v)));
    for (const v of values) expect(r.readVarUint()).toBe(v);
  });

  it('spends fewer bytes on small varuints', () => {
    const small = new BitWriter();
    small.writeVarUint(100);
    const large = new BitWriter();
    large.writeVarUint(100_000);
    expect(small.byteLength).toBeLessThan(large.byteLength);
    expect(small.byteLength).toBe(1);
  });

  it('round-trips float32 within f32 precision', () => {
    const rng = new Sfc32(7);
    for (let i = 0; i < 1000; i++) {
      const v = (rng.next() - 0.5) * 2000;
      const r = roundTrip((w) => w.writeFloat32(v));
      expect(r.readFloat32()).toBeCloseTo(v, 2);
    }
  });

  it('round-trips strings', () => {
    const values = ['', 'a', 'hello world', 'squad: alpha', 'x'.repeat(500)];
    const r = roundTrip((w) => values.forEach((v) => w.writeString(v)));
    for (const v of values) expect(r.readString()).toBe(v);
  });

  it('round-trips every UTF-8 encoding width', () => {
    // One representative per byte-length: 1, 2, 3 and 4 (surrogate pair).
    const oneByte = String.fromCharCode(0x41);
    const twoByte = String.fromCharCode(0x00e9);
    const threeByte = String.fromCharCode(0x4e2d);
    const fourByte = String.fromCharCode(0xd83c, 0xdfdc);
    const boundaries = String.fromCharCode(0x7f, 0x80, 0x7ff, 0x800);
    for (const s of [oneByte, twoByte, threeByte, fourByte, boundaries, oneByte + fourByte + threeByte]) {
      expect(decodeUtf8(encodeUtf8(s))).toBe(s);
      const r = roundTrip((w) => w.writeString(s));
      expect(r.readString()).toBe(s);
    }
  });

  it('grows past its initial capacity without corrupting data', () => {
    const w = new BitWriter(8); // deliberately tiny
    for (let i = 0; i < 5000; i++) w.writeBits(i & 0xff, 8);
    const r = new BitReader(w.toUint8Array());
    for (let i = 0; i < 5000; i++) expect(r.readBits(8)).toBe(i & 0xff);
  });

  it('interleaves types without losing alignment', () => {
    const r = roundTrip((w) => {
      w.writeBool(true);
      w.writeBits(5, 3);
      w.writeVarUint(300);
      w.writeString('mid');
      w.writeBits(0xabcd, 16);
      w.writeBool(false);
    });
    expect(r.readBool()).toBe(true);
    expect(r.readBits(3)).toBe(5);
    expect(r.readVarUint()).toBe(300);
    expect(r.readString()).toBe('mid');
    expect(r.readBits(16)).toBe(0xabcd);
    expect(r.readBool()).toBe(false);
  });

  // The most important behaviour in this file: fail loudly rather than return
  // garbage that silently becomes corrupt simulation state.
  it('THROWS on over-read rather than returning garbage', () => {
    const w = new BitWriter();
    w.writeBits(1, 8);
    const r = new BitReader(w.toUint8Array());
    r.readBits(8);
    expect(() => r.readBits(1)).toThrow(/over-read/);
  });

  it('throws on a truncated stream mid-value', () => {
    const w = new BitWriter();
    w.writeBits(0xffff, 16);
    const r = new BitReader(w.toUint8Array().slice(0, 1));
    expect(() => r.readBits(16)).toThrow(/over-read/);
  });

  it('rejects a corrupt varuint instead of looping forever', () => {
    const w = new BitWriter();
    for (let i = 0; i < 8; i++) w.writeBits(0xff, 8); // continuation bit never clears
    expect(() => new BitReader(w.toUint8Array()).readVarUint()).toThrow(/varuint too long|over-read/);
  });

  it('rejects a string claiming more bytes than remain', () => {
    const w = new BitWriter();
    w.writeVarUint(9999);
    w.writeBits(0x41, 8);
    expect(() => new BitReader(w.toUint8Array()).readString()).toThrow(/exceeds remaining|over-read/);
  });

  it('rejects out-of-range bit counts', () => {
    const w = new BitWriter();
    expect(() => w.writeBits(1, 33)).toThrow(RangeError);
    expect(() => new BitReader(new Uint8Array(4)).readBits(33)).toThrow(RangeError);
  });

  it('rejects negative and non-integer varuints', () => {
    const w = new BitWriter();
    expect(() => w.writeVarUint(-1)).toThrow(RangeError);
    expect(() => w.writeVarUint(1.5)).toThrow(RangeError);
  });

  it('reports byte length as the ceiling of bits written', () => {
    const w = new BitWriter();
    w.writeBits(1, 1);
    expect(w.bitLength).toBe(1);
    expect(w.byteLength).toBe(1);
    w.writeBits(0, 8);
    expect(w.bitLength).toBe(9);
    expect(w.byteLength).toBe(2);
  });
});
