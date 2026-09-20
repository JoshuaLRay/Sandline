/**
 * Component definitions and the replication registry (T-0.09, ADR-007).
 *
 * bitECS stores components as typed arrays, which is the whole reason it was
 * chosen: a snapshot serialiser reads contiguous memory instead of walking an
 * object graph, and the ECS layout and the wire layout are the same shape
 * (ADR-009).
 */
import { Types, defineComponent } from 'bitecs';

export const Transform = defineComponent({
  x: Types.f32, y: Types.f32, z: Types.f32,
  yaw: Types.ui16,   // binary angle, wire resolution (T-1.02)
  pitch: Types.i16,
});

export const Velocity = defineComponent({ x: Types.f32, y: Types.f32, z: Types.f32 });

/** `state` is a vitality code (damage.ts), `timer` whole seconds of bleed-out or respawn left (T-2.13). */
export const Health = defineComponent({
  current: Types.ui16,
  max: Types.ui16,
  state: Types.ui8,
  timer: Types.ui8,
  /** T-2.15: revive progress on this soldier (0..15) and the reviver's slot (7 = none). */
  revive: Types.ui8,
  reviver: Types.ui8,
});

/** Which of the six squad slots this entity occupies (ADR-001). */
export const PlayerSlot = defineComponent({ slot: Types.ui8, isBot: Types.ui8 });

/**
 * Network identity, distinct from the bitECS entity id.
 *
 * bitECS recycles entity ids after removal. A recycled id arriving at a client
 * that still holds the old entity would be silently misapplied, so replicated
 * entities carry a NetId that is never reused within a session.
 */
export const NetId = defineComponent({ id: Types.ui32 });

/** Marker: this entity is sent to clients. */
export const Replicated = defineComponent();

/**
 * Stable numeric ids for the wire format.
 *
 * These are part of the protocol. Never renumber an existing entry — append
 * only, and bump the protocol version byte (T-1.05) if the meaning changes.
 */
export const COMPONENT_IDS = {
  Transform: 0,
  Velocity: 1,
  Health: 2,
  PlayerSlot: 3,
  NetId: 4,
} as const;

export type ComponentName = keyof typeof COMPONENT_IDS;
