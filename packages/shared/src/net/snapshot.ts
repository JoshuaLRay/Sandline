/**
 * Full snapshot encoding (T-1.03).
 *
 * Values here are WIRE INTEGERS, not floats — see schema.ts for why.
 */
import type { BitReader, BitWriter } from './BitStream.ts';
import { COMPONENT_MASK_BITS, SCHEMAS, schemaById } from './schema.ts';

/** componentId -> field levels, in schema field order. */
export type ComponentLevels = Record<number, readonly number[]>;

export interface EntitySnapshot {
  netId: number;
  components: ComponentLevels;
}

export interface WorldSnapshot {
  tick: number;
  entities: EntitySnapshot[];
}

export function componentMask(components: ComponentLevels): number {
  let mask = 0;
  for (const s of SCHEMAS) if (components[s.id] !== undefined) mask |= 1 << s.id;
  return mask;
}

export function writeEntity(w: BitWriter, e: EntitySnapshot): void {
  w.writeVarUint(e.netId);
  const mask = componentMask(e.components);
  w.writeBits(mask, COMPONENT_MASK_BITS);
  for (const s of SCHEMAS) {
    if ((mask & (1 << s.id)) === 0) continue;
    const values = e.components[s.id] as readonly number[];
    if (values.length !== s.fields.length) {
      throw new RangeError(`${s.name} expects ${s.fields.length} fields, got ${values.length}`);
    }
    s.fields.forEach((f, i) => w.writeBits(values[i] as number, f.bits));
  }
}

export function readEntity(r: BitReader): EntitySnapshot {
  const netId = r.readVarUint();
  const mask = r.readBits(COMPONENT_MASK_BITS);
  const components: Record<number, number[]> = {};
  for (const s of SCHEMAS) {
    if ((mask & (1 << s.id)) === 0) continue;
    components[s.id] = s.fields.map((f) => r.readBits(f.bits));
  }
  return { netId, components };
}

export function writeSnapshot(w: BitWriter, snap: WorldSnapshot): void {
  w.writeVarUint(snap.tick);
  w.writeVarUint(snap.entities.length);
  for (const e of snap.entities) writeEntity(w, e);
}

export function readSnapshot(r: BitReader): WorldSnapshot {
  const tick = r.readVarUint();
  const count = r.readVarUint();
  const entities: EntitySnapshot[] = [];
  for (let i = 0; i < count; i++) entities.push(readEntity(r));
  return { tick, entities };
}

/** Decode wire levels back to real values for one component. */
export function decodeComponent(componentId: number, levels: readonly number[]): number[] {
  return schemaById(componentId).fields.map((f, i) => f.decode(levels[i] as number));
}

/** Encode real values into wire levels for one component. */
export function encodeComponent(componentId: number, values: readonly number[]): number[] {
  return schemaById(componentId).fields.map((f, i) => f.encode(values[i] as number));
}
