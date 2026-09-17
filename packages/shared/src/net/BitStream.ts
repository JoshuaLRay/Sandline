/**
 * Bit-level reader/writer (T-1.01, ADR-009).
 *
 * The bandwidth budget is ~12 bytes per entity at 30 Hz (ADR-012). Reaching it
 * means packing at the bit level — a field with 1024 possible values costs 10
 * bits, not a byte-aligned 16.
 *
 * We own the correctness burden for this, and a bug here produces silently
 * corrupt state rather than an exception, which is the worst failure mode in the
 * system. Hence: reads past the end THROW, and the tests are property-based over
 * random round-trips rather than a handful of examples.
 *
 * Bits are written LSB-first within each byte. Strings are encoded as UTF-8 by
 * hand rather than via TextEncoder, so `shared` needs neither the DOM nor the
 * Node lib to typecheck (ADR-003).
 */

const DEFAULT_CAPACITY = 1024;

export class BitWriter {
  private bytes: Uint8Array;
  private bitPos = 0;

  constructor(capacityBytes = DEFAULT_CAPACITY) {
    this.bytes = new Uint8Array(capacityBytes);
  }

  get bitLength(): number {
    return this.bitPos;
  }

  get byteLength(): number {
    return (this.bitPos + 7) >> 3;
  }

  private ensure(extraBits: number): void {
    const needed = (this.bitPos + extraBits + 7) >> 3;
    if (needed <= this.bytes.length) return;
    let cap = this.bytes.length * 2;
    while (cap < needed) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(this.bytes);
    this.bytes = grown;
  }

  /** Write the low `count` bits of `value` (count 1..32). */
  writeBits(value: number, count: number): void {
    if (count < 0 || count > 32) throw new RangeError(`bit count out of range: ${count}`);
    this.ensure(count);
    const v = value >>> 0;
    for (let i = 0; i < count; i++) {
      if ((v >>> i) & 1) {
        // ensure() above guarantees this index exists.
        const idx = this.bitPos >> 3;
        this.bytes[idx] = (this.bytes[idx] as number) | (1 << (this.bitPos & 7));
      }
      this.bitPos++;
    }
  }

  writeBool(value: boolean): void {
    this.writeBits(value ? 1 : 0, 1);
  }

  /** Unsigned LEB128-style: 7 payload bits per byte, high bit continues. */
  writeVarUint(value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`varuint must be a non-negative integer, got ${value}`);
    }
    let v = value >>> 0;
    do {
      const chunk = v & 0x7f;
      v >>>= 7;
      this.writeBits(chunk | (v > 0 ? 0x80 : 0), 8);
    } while (v > 0);
  }

  /** Full f32 — use quantized integers instead wherever precision allows. */
  writeFloat32(value: number): void {
    const buf = new ArrayBuffer(4);
    new Float32Array(buf)[0] = value;
    this.writeBits(new Uint32Array(buf)[0] as number, 32);
  }

  writeString(value: string): void {
    const utf8 = encodeUtf8(value);
    this.writeVarUint(utf8.length);
    for (const b of utf8) this.writeBits(b, 8);
  }

  /** Copy of the written bytes. Trailing bits in the last byte are zero. */
  toUint8Array(): Uint8Array {
    return this.bytes.slice(0, this.byteLength);
  }
}

export class BitReader {
  private bitPos = 0;
  private readonly bitLimit: number;

  constructor(private readonly bytes: Uint8Array) {
    this.bitLimit = bytes.length * 8;
  }

  get bitsRemaining(): number {
    return this.bitLimit - this.bitPos;
  }

  get bitPosition(): number {
    return this.bitPos;
  }

  readBits(count: number): number {
    if (count < 0 || count > 32) throw new RangeError(`bit count out of range: ${count}`);
    if (this.bitPos + count > this.bitLimit) {
      throw new RangeError(
        `BitReader over-read: wanted ${count} bits at ${this.bitPos}, limit ${this.bitLimit}`,
      );
    }
    let out = 0;
    for (let i = 0; i < count; i++) {
      const byte = this.bytes[this.bitPos >> 3] as number;
      if ((byte >>> (this.bitPos & 7)) & 1) out |= 1 << i;
      this.bitPos++;
    }
    return out >>> 0;
  }

  readBool(): boolean {
    return this.readBits(1) === 1;
  }

  readVarUint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.readBits(8);
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new RangeError('varuint too long (corrupt stream)');
    }
    return result >>> 0;
  }

  readFloat32(): number {
    const buf = new ArrayBuffer(4);
    new Uint32Array(buf)[0] = this.readBits(32);
    return new Float32Array(buf)[0] as number;
  }

  readString(): string {
    const len = this.readVarUint();
    if (len > this.bitsRemaining >> 3) {
      throw new RangeError(`string length ${len} exceeds remaining bytes (corrupt stream)`);
    }
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = this.readBits(8);
    return decodeUtf8(out);
  }
}

/* -- Minimal UTF-8, so `shared` needs neither DOM nor Node typings ---------- */

export function encodeUtf8(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    // Combine a surrogate pair into one code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++] as number;
    let code: number;
    if (b0 < 0x80) code = b0;
    else if ((b0 & 0xe0) === 0xc0) code = ((b0 & 0x1f) << 6) | ((bytes[i++] as number) & 0x3f);
    else if ((b0 & 0xf0) === 0xe0) {
      code = ((b0 & 0x0f) << 12) | (((bytes[i++] as number) & 0x3f) << 6) | ((bytes[i++] as number) & 0x3f);
    } else {
      code =
        ((b0 & 0x07) << 18) |
        (((bytes[i++] as number) & 0x3f) << 12) |
        (((bytes[i++] as number) & 0x3f) << 6) |
        ((bytes[i++] as number) & 0x3f);
    }
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}
