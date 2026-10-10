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
import { ENEMY_ARCHETYPE_BITS, ENEMY_FACTION_BITS } from '../sim/enemies.ts';
import { EMPLACEMENT_HEAT_BITS, EMPLACEMENT_KIND_BITS } from '../sim/emplacement.ts';
import { PICKUP_AMMO_BITS, PICKUP_WEAPON_BITS } from '../sim/pickups.ts';
import { WEAPON_INDEX_BITS } from '../sim/weapons.ts';
import { PROJECTILE_IDS, PROJECTILE_INDEX_BITS } from '../sim/ballistics.ts';
import { SUPPRESSION_BITS } from '../sim/suppression.ts';
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

/** Bits for a pouch count on the wire (U-024): up to 7 of an item. The data is held to it by test. */
export const POUCH_COUNT_BITS = 3;
/** The most of one pouch item the wire carries. */
export const POUCH_COUNT_MAX = (1 << POUCH_COUNT_BITS) - 1;
/** Bits for the rounds in a magazine on the wire (U-028): up to 127. The data is held to it by test. */
export const AMMO_BITS = 7;
export const AMMO_MAX = (1 << AMMO_BITS) - 1;

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
    // T-2.40: prone appended after crouched, never renumbered (ADR-009).
    fields: [uint('crouched', 1), uint('prone', 1)],
  },
  {
    id: COMPONENT_IDS.Vault,
    name: 'Vault',
    // T-2.21. `active` 0 means the rest is meaningless. Elapsed is in
    // milliseconds so a 10-bit field spans a second; a vault is shorter.
    // `vaultToLevels` / `vaultFromLevels` (net/vaultWire.ts) are the ends.
    fields: [uint('active', 1), uint('elapsedMs', 10), angle('yaw'), pos('fromX'), pos('fromY'), pos('fromZ'), pos('topY')],
  },
  {
    id: COMPONENT_IDS.Weapon,
    name: 'Weapon',
    // T-2.26. The weapon in hand (an index into WEAPON_IDS) and the reload in
    // progress as a percentage, so a remote soldier's body can show a reload
    // as a curve of the server's clock, the way the vault is. `pouch` is 0
    // while a gun is in hand and 1 + a PROJECTILE_IDS index while a grenade
    // or a rocket is (an Equip), so the body can hold the right thing.
    // U-024: then how many of each pouch item the soldier has left, in
    // PROJECTILE_IDS order, so the page's pouch follows the server's through
    // resets, respawns, class changes and reconnects. Appended, never
    // renumbered (ADR-009).
    // U-028: then the rounds in the magazine, so the page's count follows the host's.
    // U-018: then the primary (a WEAPON_IDS index) — what key 1 draws, a picked-up gun once one is taken.
    // U-022: then the second primary of a character who carries two (a WEAPON_IDS index), or `NO_SECONDARY` for none.
    // U-047: then the health kits left (0-7) and the percent through applying one (0 when none is being applied).
    // U-048: then the soldier's slot-5 equipment, a PROJECTILE_IDS index plus one (0 for none) — what key 5 draws, a picked-up item once one is taken.
    // U-029: then 1 when the soldier has put its pistol down (a class that lists one), so the page does not offer it.
    fields: [uint('index', WEAPON_INDEX_BITS), uint('reloadProgress', 7), uint('pouch', PROJECTILE_INDEX_BITS), ...PROJECTILE_IDS.map((id) => uint(`left_${id}`, POUCH_COUNT_BITS)), uint('ammo', AMMO_BITS), uint('primary', WEAPON_INDEX_BITS), uint('secondary', WEAPON_INDEX_BITS), uint('noPistol', 1), uint('kits', 3), uint('kitProgress', 7), uint('equipment', PROJECTILE_INDEX_BITS)],
  },
  {
    id: COMPONENT_IDS.Projectile,
    name: 'Projectile',
    // T-2.31. `kind` indexes PROJECTILE_IDS and `ownerSlot` is the squad slot
    // that threw it, both of which a client needs before it can draw the thing
    // — and neither of which changes for the life of the entity, so they cost
    // their bits once on the spawn and nothing per tick after (T-1.04).
    fields: [uint('kind', PROJECTILE_INDEX_BITS), uint('ownerSlot', 3)],
  },
  {
    id: COMPONENT_IDS.Enemy,
    name: 'Enemy',
    // T-3.10. `archetype` indexes ENEMY_IDS and `faction` names the side; like
    // a projectile's identity neither changes for the life of the entity, so
    // they cost their bits once, on the spawn. Widths from enemies.ts.
    // U-066: and `turretYaw` (wire units), a tank's turret facing apart from its hull's (the Transform's); 0 for a soldier.
    // It rides this component, not one of its own, so no entity pays another bit of the presence mask.
    // U-068: and `aiming`, 1 while a tank's cannon is locked on a point and about to fire: the warning and the muzzle flash.
    // U-157: an RPG gunner's wind-up is `aiming` too; and `launcher`, 1 while its launcher (not its rifle) is in its hands.
    fields: [uint('archetype', ENEMY_ARCHETYPE_BITS), uint('faction', ENEMY_FACTION_BITS), uint('turretYaw', ANGLE_BITS_WIRE), uint('aiming', 1), uint('launcher', 1)],
  },
  {
    id: COMPONENT_IDS.Suppression,
    name: 'Suppression',
    // T-3.16. The level in 1/63 steps (`suppressionToWire`). A delta resends it
    // only while it changes: nothing at rest, a few bits a tick while it decays.
    fields: [uint('level', SUPPRESSION_BITS)],
  },
  {
    id: COMPONENT_IDS.Emplacement,
    name: 'Emplacement',
    // T-4.29. `kind` indexes EMPLACEMENT_IDS and never changes; `gunner` is 0
    // for nobody, a squad slot + 1, or 7 for an enemy; `heat` is whole percent
    // and `overheated` the flag the gun will not fire under. The gun's own
    // yaw and pitch are the entity's Transform.
    fields: [uint('kind', EMPLACEMENT_KIND_BITS), uint('gunner', 3), uint('heat', EMPLACEMENT_HEAT_BITS), uint('overheated', 1)],
  },
  {
    id: COMPONENT_IDS.Pickup,
    name: 'Pickup',
    // U-017. `weapon` indexes WEAPON_IDS; `ammo` is the rounds left in its magazine. Its place is the Transform.
    fields: [uint('weapon', PICKUP_WEAPON_BITS), uint('ammo', PICKUP_AMMO_BITS)],
  },
];

/** Width of the component-presence bitmask. */
// Component IDs are protocol IDs and may have gaps; the mask must cover the highest ID.
export const COMPONENT_MASK_BITS = Math.max(...SCHEMAS.map((s) => s.id)) + 1;

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
