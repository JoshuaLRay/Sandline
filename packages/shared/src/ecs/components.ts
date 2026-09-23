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
export const Health = defineComponent({ current: Types.ui16, max: Types.ui16, state: Types.ui8, timer: Types.ui8 });

/** Which of the six squad slots this entity occupies (ADR-001). */
export const PlayerSlot = defineComponent({ slot: Types.ui8, isBot: Types.ui8 });

/** Whether the authoritative character is currently crouched or prone (T-2.40). */
export const Crouch = defineComponent({ crouched: Types.ui8, prone: Types.ui8 });

/**
 * Network identity, distinct from the bitECS entity id.
 *
 * bitECS recycles entity ids after removal. A recycled id arriving at a client
 * that still holds the old entity would be silently misapplied, so replicated
 * entities carry a NetId that is never reused within a session.
 */
export const NetId = defineComponent({ id: Types.ui32 });

/**
 * A projectile in flight (T-2.31): which kind it is and whose it is. Position
 * and velocity ride the usual `Transform` and `Velocity`; this is the part a
 * renderer cannot derive, and it is also what tells a client that an entity
 * that just spawned is a grenade rather than a soldier.
 */
export const Projectile = defineComponent({ kind: Types.ui8, ownerSlot: Types.ui8 });

/**
 * An enemy (T-3.10): which archetype (an ENEMY_IDS index) and which side.
 * Position, stance and health ride `Transform`, `Velocity`, `Crouch` and
 * `Health` as a soldier's do; this is what tells a client the soldier is the
 * other side's, and never changes for the life of the entity.
 */
export const Enemy = defineComponent({ archetype: Types.ui8, faction: Types.ui8 });

/**
 * How suppressed a soldier is (T-3.16): the level, 0..63 for 0..1
 * (`suppressionToWire`). Sent for the squad's slots, so the page can show it
 * and widen its predicted cone by the same amount the server widens the shot.
 */
export const Suppression = defineComponent({ level: Types.ui8 });

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
  /** Replicated locomotion stance for remote presentation. */
  Crouch: 5,
  /** T-2.21: a vault in progress, enough of it for a predictor to continue it. */
  Vault: 6,
  /** T-2.26: which weapon is in hand and how far through a reload it is, for the body. */
  Weapon: 7,
  /** T-2.31: a projectile in flight — which kind, and whose. */
  Projectile: 8,
  /** T-3.10: an enemy — which archetype, and which side. */
  Enemy: 9,
  /** T-3.16: how suppressed this soldier is. */
  Suppression: 10,
} as const;

export type ComponentName = keyof typeof COMPONENT_IDS;
