/**
 * Replication schema (T-1.03, ADR-007, ADR-009).
 *
 * Maps each replicated component to an ordered field list, each field carrying
 * its bit width and its quantizer. The wire layer works entirely in INTEGER
 * levels, not floats — conversion happens at the boundary. That is what makes
 * delta change-detection exact rather than approximate: two ticks compare as
 * equal when they are equal *at wire precision*, so a value jittering below the
 * quantization step never looks dirty and never gets resent forever.
 */
import { COMPONENT_IDS, type ComponentName } from '../ecs/components.ts';
import { ANGLE_BITS_WIRE, HEALTH, POSITION, VELOCITY, dequantize, quantize, quantizeAngle } from './quantize.ts';

export interface FieldSpec {
  readonly name: string;
  readonly bits: number;
  /** Real value to wire integer. */
  readonly encode: (value: number) => number;
  /** Wire integer back to real value. */
  readonly decode: (level: number) => number;
}

const pos = (name: string): FieldSpec => ({
  name,
  bits: POSITION.bits,
  encode: (v) => quantize(v, POSITION),
  decode: (l) => dequantize(l, POSITION),
});

const vel = (name: string): FieldSpec => ({
  name,
  bits: VELOCITY.bits,
  encode: (v) => quantize(v, VELOCITY),
  decode: (l) => dequantize(l, VELOCITY),
});

const angle = (name: string): FieldSpec => ({
  name,
  bits: ANGLE_BITS_WIRE,
  encode: quantizeAngle,
  decode: (l) => l,
});

const uint = (name: string, bits: number): FieldSpec => ({
  name,
  bits,
  encode: (v) => {
    const max = (1 << bits) - 1;
    const i = Math.round(v);
    return i < 0 ? 0 : i > max ? max : i;
  },
  decode: (l) => l,
});

export interface ComponentSchema {
  readonly id: number;
  readonly name: ComponentName;
  readonly fields: readonly FieldSpec[];
}

export const SCHEMAS: readonly ComponentSchema[] = [
  {
    id: COMPONENT_IDS.Transform,
    name: 'Transform',
    fields: [pos('x'), pos('y'), pos('z'), angle('yaw'), angle('pitch')],
  },
  {
    id: COMPONENT_IDS.Velocity,
    name: 'Velocity',
    fields: [vel('x'), vel('y'), vel('z')],
  },
  {
    id: COMPONENT_IDS.Health,
    name: 'Health',
    // T-2.13: vitality (alive / downed / dead) and the seconds left in that
    // phase, so a HUD counts down what the server counts, not a local guess.
    fields: [
        uint('current', HEALTH.bits),
        uint('max', HEALTH.bits),
        uint('state', 2),
        uint('timer', 6),
        uint('reviveProgress', 7),
        uint('reviverSlot', 3),
      ],
  },
  {
    id: COMPONENT_IDS.PlayerSlot,
    name: 'PlayerSlot',
    fields: [uint('slot', 3), uint('isBot', 1)],
  },
  {
    id: COMPONENT_IDS.Crouch,
    name: 'Crouch',
    fields: [uint('crouched', 1)],
  },
];

/** Width of the component-presence bitmask. */
export const COMPONENT_MASK_BITS = SCHEMAS.length;

const BY_ID = new Map<number, ComponentSchema>(SCHEMAS.map((s) => [s.id, s]));

export function schemaById(id: number): ComponentSchema {
  const s = BY_ID.get(id);
  if (!s) throw new RangeError(`unknown component id ${id} (corrupt stream or version skew)`);
  return s;
}

/** Bits one entity costs when every component is present. Budget reference. */
export function maxEntityBits(): number {
  return SCHEMAS.reduce((n, s) => n + s.fields.reduce((m, f) => m + f.bits, 0), COMPONENT_MASK_BITS);
}
