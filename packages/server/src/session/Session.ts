/**
 * Authoritative session and tick loop (T-1.13, ADR-012).
 *
 * Fixed 30 Hz: drain inputs, step the simulation, build a per-client delta
 * against that client's last acknowledged tick, broadcast. What each client is
 * sent is the part of the world within its relevance radius (T-3.12,
 * `relevance.ts`), and its baselines are the views it was sent.
 *
 * ADR-001: six slots, always. Unfilled slots are bots, so a joining player
 * takes over an existing entity rather than spawning a new one, and a leaving
 * player hands theirs back. The world never changes shape, which is what makes
 * drop-in/drop-out an entity swap instead of a session rebuild.
 *
 * Time is injected, never read, so the whole loop is testable without timers.
 */
import {
  BitWriter,
  areaContains,
  COMPONENT_IDS,
  DEFAULT_MOVE_CONFIG,
  ESCORT_SPECTATE_SLOT,
  MAX_SLOTS,
  type MoveConfig,
  RANGE_TARGETS,
  type Message,
  type XpEvent,
  type MoveInput,
  type MoveState,
  POSITION,
  type RosterEntry,
  ServerConnection,
  VELOCITY,
  TICK_SECONDS,
  type Transport,
  type WorldSnapshot,
  WEAPON_IDS,
  type WeaponDef,
  type WeaponState,
  type Shot,
  DEFAULT_WORLD_ID,
  type World,
  requireWorld,
  FIRST_PROJECTILE_NET_ID,
  FIRST_PICKUP_NET_ID,
  PICKUPS,
  SUPPLY_RULES,
  transferSupply,
  type SupplyCacheDef,
  type SupplyCacheStock,
  type SupplyStock,
  type SupplyItem,
  PICKUP_AMMO_BITS,
  pickupProjectile,
  PICKUP_NET_ID_LIMIT,
  PROJECTILE_IDS,
  POUCH_COUNT_MAX,
  AMMO_MAX,
  type ProjectileDef,
  type ProjectileState,
  type ProjectileWorld,
  blastDamageOn,
  createProjectileState,
  getProjectile,
  dirFromYawPitch,
  rayWorld,
  projectileByIndex,
  stepProjectile,
  tableToWire,
  WIRE_TO_TABLE_SHIFT,
  type EmplacementDef,
  type HeatState,
  type PlacedEmplacement,
  canFireHot,
  clampPitch,
  clampYawToArc,
  coolHeat,
  createHeat,
  emplacementFacing,
  emplacementIndex,
  getEmplacement,
  gunMuzzle,
  gunnerPlace,
  heatShot,
  heatToWire,
  signedWire,
  withinArc,
  sin,
  cos,
  type HealthState,
  applyDamage,
  vaultToLevels,
  createHealth,
  assignClasses,
  createSlotStats,
  type SlotStats,
  classById,
  classPrimaries,
  orderReach,
  bleedOutRemaining,
  expireBleedOut,
  isDead,
  isDowned,
  vitalTimer,
  vitality,
  DAMAGE,
  RESUME,
  vitalityCode,
  createMoveState,
  createWeaponState,
  blockedAt,
  createDrive,
  vehicleSupport,
  VEHICLE_CLEARANCE_M,
  VEHICLE_STEP_M,
  withdrawDrive,
  driveYawWire,
  stepDrive,
  type EnemyVehicle,
  type VehicleDrive,
  degToWire,
  damageAtDistance,
  decayBloom,
  isAlive,
  readyToRespawn,
  reloadProgress,
  revive,
  respawn,
  spawnFor,
  zoneDamage,
  encodeMessage,
  finishReload,
  DEFAULT_MUZZLE_RIG,
  eyePosition,
  eyeStance,
  canBeDualPrimary,
  canWield,
  getWeapon,
  NO_SECONDARY,
  KIT_EQUIP_ITEM,
  applyKit,
  shotDirections,
  startReload,
  tryFire,
  quantize,
  stepCharacter,
  characterSpace,
  keepCharacterSpace,
  writeDelta,
  type EnemyDef,
  type Encounter,
  type MissionView,
  type MissionDef,
  type UploadLever,
  type EventScript,
  type ScriptBlockerState,
  type WorldBox,
  type GroundArea,
  checkMission,
  missionFor,
  scriptFor,
  resolveArea,
  regionContains,
  regionContainsSegment,
  type NavigationRegion,
  ENEMY_NET_ID_LIMIT,
  FIRST_ENEMY_NET_ID,
  buildTree,
  enemyIndex,
  getEnemy,
  SQUAD as SQUAD_CONFIG,
  ORDERS,
  orderProblem,
  type BotOrder,
  SPREAD_KINDS,
  STANCE_KINDS,
  AGGRESSION_KINDS,
  MEMORY,
  type SquadAggression,
  type SquadSpread,
  type SquadStance,
  type OrderKind,
  type OrderPoint,
  type TargetMark,
  formationBand,
  type Stimulus,
  type TargetMemory,
  type EnemyAccuracy,
  beginThink,
  chooseTarget,
  createTargetMemory,
  forgetTarget,
  hears,
  isDetected,
  rememberHeard,
  rememberSeen,
  sight,
  stepAwareness,
  wireToTable,
  degToAngle,
  type SmokeCloud,
  type SuppressionState,
  SUPPRESSION,
  blastSuppression,
  capsuleGap,
  createSuppression,
  isNearMiss,
  passCapsule,
  raiseSuppression,
  suppressionConeUnits,
  suppressionLevel,
  suppressionToWire,
} from '@sandline/shared';
import { DEFAULT_HITBOX, HitboxHistory, bodyParts, bodyStance, capsuleFor, clampRewindMs, rayBody, rayCapsule, resolveShot, vehicleHitbox } from '../net/lagComp.ts';
import { BRAIN_PERIOD_TICKS, Brain, type BrainTree, createBrainRegistry, defaultBrainTree } from '../ai/Brain.ts';
import { type AiDebugSource, buildAiDebug } from '../ai/debug.ts';
import { aimAngles, aimConeDeg, aimError, aimPoints, aimSeed, lineOfSight, visibleAimPoint } from '../ai/aim.ts';
import { CoverSystem, DEFAULT_COVER_BODY } from '../ai/cover.ts';
import { ARMOUR, shellDanger } from '../ai/armour.ts';
import { EnemyGroup } from '../ai/group.ts';
import type { ArmourView, CombatWorld } from '../ai/actions/combat.ts';
import { stepAuthoredPatrol, type EnemyPosture } from '../ai/actions/posture.ts';
import { BoundedRegion, type RegionPath } from '../ai/nav/BoundedRegion.ts';
import { spawnGround, SPAWN_ON_MESH_M } from '../ai/director/spawnGround.ts';
import { Spawner, type SpawnerCheckpoint, type SpawnerHost } from '../ai/director/spawner.ts';
import {
  CHECKPOINT_WORLD_VERSION,
  type CheckpointWorld,
  type EnemyCheckpoint,
  type GroundCheckpoint,
  type MissionStartCheckpoint,
  type PlacedCheckpoint,
  type SlotCheckpoint,
  parseCheckpointWorld,
  parseMissionStart,
} from './checkpointWorld.ts';
import { Director } from '../ai/director/director.ts';
import { MissionRun } from './mission.ts';
import { EventRun, type EventCheckpoint, type EventHost } from './events.ts';
import type { CampaignState, ReplayPrisoner, RunKind } from '../persistence/CampaignDatabase.ts';
import { CAMPAIGN, type CampaignDef, isOffered, runOptions } from '@sandline/shared';
import { SoldierXp } from '../persistence/xp.ts';
import type { DownedMate, SquadView } from '../ai/actions/friendly.ts';
import type { EscortOrder, EscortView } from '../ai/actions/escort.ts';
import { ESCORT_ARRIVED_M } from '../ai/actions/escort.ts';
import { Formation, type FormationPlace } from '../ai/friendly/formation.ts';
import { standingY, within } from '../ai/floor.ts';
import { type StillWatch, createStillWatch, throwEye, throwLaunch, watchStill } from '../ai/throw.ts';
import type { CoverPoint } from '../ai/nav/baked/types.ts';
import { completePathLength } from '../ai/nav/NavMesh.ts';
import { type FollowIntent, type FollowerStatus, PathFollower } from '../ai/locomotion/followPath.ts';
import { Avoidance, type AvoidanceEntry } from '../ai/locomotion/avoidance.ts';
import type { NavMesh, NavPath, NavPoint } from '../ai/nav/NavMesh.ts';
import { ClientView } from './relevance.ts';

/**
 * Full standing height of a hitbox: cylinder plus both caps. Hit zones are
 * fractions of this, so they track the capsule rather than assuming 1.8 m.
 */
const HITBOX_HEIGHT = 2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius);
const CROUCH_HITBOX_HEIGHT = 2 * ((DEFAULT_HITBOX.crouchHalfHeight ?? DEFAULT_HITBOX.halfHeight) + DEFAULT_HITBOX.radius);
/** T-2.40: prone's own hit-volume height, lower again than crouch's. */
const PRONE_HITBOX_HEIGHT = 2 * ((DEFAULT_HITBOX.proneHalfHeight ?? DEFAULT_HITBOX.halfHeight) + DEFAULT_HITBOX.radius);

/**
 * The side slots are on, for suppression (T-3.16): past every enemy faction
 * (`ENEMY_FACTION_BITS` wide), so no faction is ever mistaken for the squad.
 */
const SQUAD = -1;
/** U-075: the wire faction of an escorted character: a side of his own, not the squad's slots and not the enemy's. */
const ESCORT_FACTION = 3;

/**
 * What the AI's hands and trigger read and write (T-3.26): an enemy, or a
 * friendly bot's slot — the same fields on both, so one path drives both.
 */
interface AiBody {
  readonly netId: number;
  state: MoveState;
  yaw: number;
  pitch: number;
  input: MoveInput;
  weapon: WeaponDef;
  weaponState: WeaponState;
  brain: Brain | null;
  health: HealthState;
  pouch: number[];
  nextThrowAt: number;
  suppression: SuppressionState;
  aim: { netId: number; since: number } | null;
  burst: { rounds: number; pauseUntil: number };
}

/**
 * T-4.29: a placed emplacement on the session — the gun, its gunner and its
 * heat. Static: its place, facing, gunner's place and muzzle are fixed when
 * the session is built. The gun's own `yaw` and `pitch` follow whoever is on
 * it, within the arc; `weaponState` is the belt (the LMG's, through the same
 * `tryFire`), and `heat` what this gun adds to it.
 */
export interface EmplacementEntity {
  readonly netId: number;
  readonly placed: PlacedEmplacement;
  readonly def: EmplacementDef;
  /** Index into EMPLACEMENT_IDS: what goes on the wire. */
  readonly kind: number;
  /** The facing, wire units: the centre of the traverse arc. */
  readonly facing: number;
  /** Where the gunner's feet are held, and where the rounds leave. */
  readonly place: { x: number; y: number; z: number };
  readonly muzzle: { x: number; y: number; z: number };
  readonly weapon: WeaponDef;
  weaponState: WeaponState;
  heat: HeatState;
  /** The gun's own aim, wire units (pitch signed), as the gunner last laid it. */
  yaw: number;
  pitch: number;
  /** Who is on it: a slot's or an enemy's netId, or 0 for nobody. */
  gunnerNetId: number;
  /** An AI gunner's target has been outside the arc since this many seconds, or null. */
  outOfArcSince: number | null;
}

/** T-3.28: how an order ended — finished, failed, or replaced by another (or by a human taking the slot). */
export type OrderOutcome = 'done' | 'failed' | 'replaced';

export interface OrderReport {
  slot: number;
  order: OrderKind;
  outcome: OrderOutcome;
  reason: string;
  tick: number;
}

/** A move's point is reachable when a path ends this near it, metres (T-3.28), and on its floor (U-123, `SAME_FLOOR_M`). */
const ORDER_REACH_M = 1;
/** U-123: how far across an order's point is snapped onto the mesh, metres; never onto another storey. */
const ORDER_SNAP_M = 2;
/** U-018: what the eye must see of a gun on the ground: a point this far over where it lies, metres. */
const PICKUP_AIM_M = 0.1;
/** U-010: a lever user that cannot get there is not sent again for this long, seconds. */
export const LEVER_BAR_SECONDS = 15;
/** U-010: a way to the lever must end this near its foot, metres. */
const LEVER_PATH_END_M = 1;

/** T-3.26: the archetype a friendly bot sees, aims and fires by (`squad.json`'s bot.archetype), with its slot's own gun. */
const BOT_ARCHETYPE = getEnemy(SQUAD_CONFIG.bot.archetype);

/** The aim id suppressive fire is timed on (T-3.21): a point, not a soldier. */
const SUPPRESSIVE_AIM = -1;

/** A soldier's eye where it stands now, in its stance: prone, crouched (the cover body's crouched eye, T-3.19) or standing. */
/** U-066: the point `from` moved `metres` toward `to` (or all the way there, if it is nearer): where a blast meets a tank's hull. */
function towardBy(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, metres: number): { x: number; y: number; z: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d <= 1e-6) return { x: from.x, y: from.y, z: from.z };
  const t = Math.min(d, metres) / d;
  return { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
}

function soldierEye(state: MoveState): { x: number; y: number; z: number } {
  const h = state.prone ? DEFAULT_MUZZLE_RIG.proneEyeHeight : state.crouched ? (DEFAULT_COVER_BODY.crouched[2] as number) : DEFAULT_MUZZLE_RIG.eyeHeight;
  return { x: state.x, y: state.y + h, z: state.z };
}

/** A soldier's capsule where it stands now, as the trace and the near miss both see it. */
function soldierCapsule(state: MoveState): { centre: { x: number; y: number; z: number }; halfHeight: number; radius: number } {
  const { halfHeight, centerOffsetY } = capsuleFor(DEFAULT_HITBOX, state.crouched, state.prone);
  return { centre: { x: state.x, y: state.y + centerOffsetY, z: state.z }, halfHeight, radius: DEFAULT_HITBOX.radius };
}

/** The point `range` metres from `eye` along table-unit yaw and pitch: where a round so aimed is at that range. */
function along(eye: { x: number; y: number; z: number }, aim: { yaw: number; pitch: number }, range: number): { x: number; y: number; z: number } {
  const flat = cos(aim.pitch) * range;
  return { x: eye.x + sin(aim.yaw) * flat, y: eye.y + sin(aim.pitch) * range, z: eye.z + cos(aim.yaw) * flat };
}

/** 128 random bits, hex: a seat's resume token (T-4.18). Web Crypto, so the in-page session has it too. */
function newResumeToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A body's facing and whether it lies downed or dead, as the hitbox history records it. */
function lyingPose(body: { health: HealthState; yaw: number }): { yaw: number; lying: 'downed' | 'dead' | null } {
  const v = vitality(body.health);
  return { yaw: body.yaw, lying: v === 'alive' ? null : v };
}

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const H = COMPONENT_IDS.Health;
const C = COMPONENT_IDS.Crouch;

export interface Slot {
  index: number;
  /** T-3.25: the squad's formation, as a bot's brain reads it (the same view for every slot). */
  readonly squad: SquadView;
  /**
   * T-3.26: a friendly bot's fighting half, what an enemy's leaves read
   * (`CombatBody`): its side (the squad's), what it knows of the enemy and
   * whom it has chosen, when it was last hurt, the squad's view of the world,
   * the still-watch its grenades need, and its aim and burst.
   */
  readonly faction: number;
  target: number | null;
  memory: TargetMemory;
  awareness: Map<number, number>;
  lastDamagedAt: number;
  readonly combat: CombatWorld;
  readonly group: EnemyGroup | null;
  readonly still: StillWatch;
  aim: { netId: number; since: number } | null;
  burst: { rounds: number; pauseUntil: number };
  /** Where a bot's cover must be: its formation place, its formation band round (`formationBand`), or null when it has none. */
  coverNear(): { x: number; z: number; withinM: number } | null;
  netId: number;
  isBot: boolean;
  state: MoveState;
  yaw: number;
  input: MoveInput;
  /** Tick of the newest input actually consumed, echoed back for reconciliation. */
  lastProcessedInputTick: number;
  /** Tick of the input consumed most recently, echoed back for reconciliation. */
  pendingInputTick: number;
  /**
   * Inputs received and not yet consumed, oldest first.
   *
   * A QUEUE rather than a single latest-wins slot. Two reasons, both about
   * smoothness on a poor link: a jittery link delivers in bursts, and a burst
   * of three inputs under latest-wins throws two of them away — the server then
   * simulates one tick of motion where the player made three, and the client's
   * prediction is wrong by the difference. Buffering absorbs the burst instead.
   * And with redundancy in the packets, a lost input arrives in the NEXT packet
   * and slots into its proper place here rather than arriving too late to use.
   */
  queue: { tick: number; input: MoveInput }[];
  /**
   * Newest input tick ever accepted from this client.
   *
   * Separate from `pendingInputTick`, which is consumed each step. This one
   * only ever moves forward, and is what makes the ordering guard work across
   * ticks rather than only within one.
   */
  newestInputTick: number;
  /** Ticks since a real input arrived, for the repeat-then-idle rule. */
  staleTicks: number;
  connection: ServerConnection | null;
  /**
   * T-4.18: the seat's resume token — the current occupant's while a person
   * holds the slot, the dropped one's while their claim lasts — and when the
   * claim ends, session ms (0: no claim). A claim is made only by a dropped
   * socket, never by a player who left.
   */
  resumeToken: string;
  reservedUntilMs: number;
  /**
   * Authoritative weapon state.
   *
   * The server owns cadence and the magazine, not the client. A client that
   * spams Fire faster than the weapon's RPM gets the same treatment as one
   * firing an empty magazine: nothing happens. This is the whole reason the
   * cadence machine (T-1.17) is pure and takes an injected time — the server
   * runs the identical code the client predicts with.
   */
  weapon: WeaponDef;
  weaponState: WeaponState;
  /**
   * U-018: the gun key 1 draws — the class's first, or the carbine on a free
   * loadout — until the soldier takes another off the ground; `pickedUp` says
   * it came from there, so a respawn or a retry gives the class's back.
   */
  primary: string | null;
  pickedUp: boolean;
  /** U-061: held prisoner by the enemy: out of play (as if dead, but no respawn and no mission failure) until freed. */
  captured: boolean;
  /** U-061: where the prisoner is held while `captured`. */
  prisoner: { x: number; y: number; z: number } | null;
  /** U-029: G was pressed on an input the host has just taken; the next mount pass drops the held gun. */
  dropPending: boolean;
  /** U-029: the pistol the class lists has been put down (until a respawn, a retry, or taking one up). */
  noPistol: boolean;
  /** U-047: health kits left. */
  kits: number;
  /** U-048: the pouch item in slot 5 (a PROJECTILE_IDS index), or -1 for an empty slot. Starts as the character's; a pickup can change it. */
  equipment: number;
  /** U-047: seconds into applying one, on `kitTarget` (a slot index; -1 for none). */
  kitProgress: number;
  kitTarget: number;
  /** U-047: this soldier's health as of the last tick, to see damage that interrupts an application. */
  kitHealth: number;
  /** U-046: a grenade with its pin pulled: which projectile, and when (seconds) the fuse started. Goes off in hand if not thrown. */
  cook: { kind: number; since: number } | null;
  /** U-046: right click was held on the newest input, and on the one before (to see a press). */
  cookHeld: boolean;
  cookWasHeld: boolean;
  /**
   * U-022: the second primary of a character who carries two (Preach, once he
   * has taken one; the support from the start), or null.
   */
  secondary: string | null;
  /**
   * U-022: the magazine and clocks of each gun not in hand, so a gun drawn
   * again is as it was left (a reload cancelled, its rounds kept), not fresh.
   */
  stowed: Map<string, WeaponState>;
  /**
   * T-3.16: how suppressed this soldier is. Rounds past it raise it; it
   * widens the weapon cone by `SUPPRESSION.coneDeg` at full, and replicates.
   */
  suppression: SuppressionState;
  /** Aim pitch, in wire units. Movement only replicates yaw; shots need both. */
  pitch: number;
  /**
   * How many of each projectile are left, indexed like PROJECTILE_IDS, and the
   * earliest time the next one may leave the hand (T-2.31). The server's, not
   * the client's: a client that lies about either gets nothing.
   */
  pouch: number[];
  nextThrowAt: number;
  /**
   * The pouch item in hand, as a PROJECTILE_IDS index, or -1 while a gun is.
   * Presentation only: it is replicated so the rest of the squad sees a
   * grenade or a launcher in hand, and it gates nothing — the pouch and the
   * cooldown above decide every Throw, whichever way it was asked for.
   */
  heldProjectile: number;
  health: HealthState;
  /** T-2.15: authoritative revive ownership/progress for this downed soldier. */
  reviveBySlot: number;
  reviveProgressSeconds: number;
  /**
   * Whether the newest REAL input had interact held. Latched here rather
   * than read off `input` each tick, because a tick with nothing buffered
   * runs an idle input (hold-immediately, in `step`) whose interact is
   * false, and an idle tick must PAUSE a revive, not cancel it: on a bursty
   * link the inputs arrive two at a time with a gap between, and a hold that
   * reset on every gap could never finish. The latch drops on a real
   * release, on silence past the repeat window, or when the seat changes.
   */
  interactHeld: boolean;
  /** T-4.29: whether the previous tick's interact was held — the press edge is what mounts and dismounts. */
  interactWasHeld: boolean;
  /** T-4.29: the emplacement this soldier is on, or null. */
  mounted: EmplacementEntity | null;
  /**
   * The bot's brain (T-3.08), or null while a human drives. Owned by the
   * occupant, not the entity: a join stops it, a leave builds a new one.
   */
  brain: Brain | null;
  /** How many brains this slot has had; seeds each new one differently. */
  brainGeneration: number;
}

/** ADR-012: repeat a missing input this many ticks, then treat it as idle. */
export const MAX_INPUT_REPEAT = 5;

/** U-047: `heldProjectile` when the health kits are in hand (one past the last pouch item). */
const KIT_HELD = PROJECTILE_IDS.length;

/** U-048: the frag is slot 4's grenade; slot 5's equipment is any other pouch item. */
/** U-055: the flat unit direction a wire yaw looks along. */
function flatFacing(yaw: number): { x: number; z: number } {
  const d = dirFromYawPitch(yaw, 0);
  const n = Math.sqrt(d.x * d.x + d.z * d.z) || 1;
  return { x: d.x / n, z: d.z / n };
}

/** U-055: cosine of half a cone's full width, degrees. */
function coneHalfCos(coneDeg: number): number {
  return Math.cos((coneDeg / 2) * (Math.PI / 180));
}

/** U-057: a blast this close destroys a placed sensor, metres; a sensor's mark fades this many ticks after its enemy stops. */
const SENSOR_BLAST_KILL_M = 2;
const SENSOR_LINGER_TICKS = 30;

/** U-054: how far from the eye a soldier can put a charge on a surface, metres. */
const PLACE_REACH_M = 2.5;
/** U-058: a smoke cloud thins to nothing over its last seconds. */
const SMOKE_FADE_SECONDS = 4;
const FRAG_INDEX = (PROJECTILE_IDS as readonly string[]).indexOf('frag');
/** The equipment a slot on a free-loadout session (the range) carries: the first pouch item that is not the frag. */
const FIRST_EQUIPMENT = PROJECTILE_IDS.findIndex((id) => id !== 'frag');

/**
 * Deepest the per-slot input buffer may get. Four ticks is ~133 ms of slack —
 * enough to ride out the jitter on a poor link without turning buffering into
 * latency the player can feel.
 */
export const MAX_INPUT_QUEUE = 4;

/**
 * Extra inputs a single tick may drain when the buffer is backed up. Two keeps
 * a stutter from becoming a visible sprint while still clearing a burst in a
 * couple of ticks.
 */
export const MAX_CATCHUP_INPUTS = 2;

const idleInput = (yaw = 0): MoveInput => ({
  moveX: 0,
  moveY: 0,
  yaw,
  jump: false,
  sprint: false,
  crouch: false,
  prone: false,
  interact: false,
  firing: false,
});


/**
 * The squad slot a projectile thrown by an enemy names on the wire (T-3.22):
 * the 3-bit field's top value, which no slot has (six slots, 0..5), so no
 * client takes an enemy's grenade for its own.
 */
const NO_SLOT = 7;

/**
 * Projectiles a session will carry at once.
 *
 * The pouch and the cooldown already bound this far below the cap — six
 * players with three grenades each, and none of them free to throw faster
 * than the data allows — so this is a rail, not a rule: it exists so that a
 * future load-out with a deeper pouch cannot quietly put a session's snapshot
 * over the ADR-012 bandwidth budget, at about a hundred bits per projectile
 * per tick.
 */
export const MAX_PROJECTILES = 24;

/** One projectile the session owns. The state is T-2.30's; the rest is identity. */
interface ActiveProjectile {
  /** The person at launch; a replacement occupant cannot inherit the credit. */
  xpPlayerId: string | null;
  netId: number;
  def: ProjectileDef;
  /** Index into PROJECTILE_IDS: what goes on the wire. */
  kind: number;
  ownerSlot: number;
  ownerNetId: number;
  state: ProjectileState;
  /** U-054: a placed charge that has come to rest or been put on a surface: it no longer flies, and waits for its owner. */
  stuck?: boolean;
  /** U-055: the flat direction a directional device (a claymore) faces, a unit vector on x/z. */
  facing?: { x: number; z: number };
  /** U-057: a blast has destroyed this stuck device; it is dropped at the end of the tick. */
  destroyed?: boolean;
}

/**
 * Enemies a session will carry at once, corpses included (T-3.10).
 *
 * A rail like `MAX_PROJECTILES`, not a design number: E-3.9's spawner caps
 * enemies alive by encounter data, well below this. It exists so that a
 * runaway spawner cannot put a snapshot, the avoidance crowd or the AI budget
 * past what T-3.12 and T-3.35 measure — forty enemies and five bots — by more
 * than a margin.
 */
export const MAX_ENEMIES = 64;

/** T-3.32: a spawn candidate counts as on the navmesh when its nearest mesh point is this near, metres. */
export { SPAWN_ON_MESH_M } from '../ai/director/spawnGround.ts';

/**
 * One enemy the session owns (T-3.10). Shaped like the parts of a `Slot` the
 * shared systems read — a `MoveState`, a yaw in wire units, a `HealthState` —
 * so the same `stepCharacter`, the same hitbox history and the same
 * `applyDamage` serve it, and a `Brain` can drive it as it drives a bot.
 */
export interface EnemyEntity {
  readonly netId: number;
  readonly def: EnemyDef;
  /** Index into ENEMY_IDS: what goes on the wire. */
  readonly archetype: number;
  readonly faction: number;
  state: MoveState;
  /** Facing, wire units, as a slot's. */
  yaw: number;
  pitch: number;
  captive?: boolean;
  /** U-066: a tank's turret facing, wire units, apart from the hull's `yaw`; a soldier's follows its own. */
  turretYaw: number;
  /** U-067: a tank's drive along its path, or null for a soldier and for a tank given no path. */
  drive: VehicleDrive | null;
  /** U-069: a withdrawing tank that has left the map; taken off the list at the end of the step. */
  departed: boolean;
  /** U-068: when a tank's cannon may next begin a tell, seconds. */
  cannonReadyAt: number;
  /** U-068: a tank's cannon locked on a point and about to fire at it, or null: the replicated `aiming`. */
  tell: { until: number; netId: number; point: { x: number; y: number; z: number } } | null;
  input: MoveInput;
  health: HealthState;
  /** U-075: what an escorted character's leaves read (the squad, and his order); absent for every other archetype. */
  escort?: EscortView;
  /** Its brain, stopped on the tick it dies. */
  brain: Brain | null;
  /** Path following for the brain's intent, made on the first one, as a bot's. */
  follower: PathFollower | null;
  /** U-010: what its path following last said — `unreachable` when there is no way to its goal. */
  pathStatus: FollowerStatus;
  /**
   * T-3.14: what it knows about the squad — last known positions, confidence,
   * threats — fed by sight on its think ticks and by every stimulus it hears.
   */
  memory: TargetMemory;
  /** T-3.13 awareness per slot netId, stepped on its think ticks. */
  awareness: Map<number, number>;
  /** The target its memory chose on its latest think, or null (T-3.14). */
  target: number | null;
  /** T-3.15: the archetype's gun, and its magazine, cadence, bloom and reload — a slot's `WeaponState`. */
  readonly weapon: WeaponDef;
  weaponState: WeaponState;
  /**
   * T-3.15: who it is aiming at and since when (seconds), for time on target.
   * Null when it is not aiming, or has lost sight of what it was.
   */
  aim: { netId: number; since: number } | null;
  /** Horizontal speed over its last step, m/s, as `slotSpeed` is a slot's. */
  speed: number;
  /** T-3.16: how suppressed it is — widens its aim, and T-3.20's urge to take cover reads it. */
  suppression: SuppressionState;
  /** T-3.20: when it was last hurt, seconds, or −Infinity — damage pushes a rifleman to cover. */
  lastDamagedAt: number;
  /** T-3.20: the session's world as its fighting leaves see it; the same object for every enemy. */
  readonly combat: CombatWorld;
  /** T-3.21: the group it was spawned into (`EnemySpawn.group`), or null. */
  readonly group: EnemyGroup | null;
  /**
   * T-3.22: its pouch and throw cooldown, a slot's (T-2.31): a full load-out
   * of this session's rows on spawn, spent by the same throw path.
   */
  pouch: number[];
  nextThrowAt: number;
  /** T-3.22: how long its target has been still, as it knows it — fed on its think ticks. */
  readonly still: StillWatch;
  /**
   * T-3.23: since when it has stood still, seconds, or null while it moves —
   * for an archetype that deploys (the MG), which fires only once this is
   * its `deploy.seconds` old. Null for one that does not.
   */
  deployedAt: number | null;
  /** U-017: whether its death has left its weapon on the ground — once, however often the death is seen. */
  dropped: boolean;
  /** T-4.29: the emplacement it is on, or null. */
  mounted: EmplacementEntity | null;
  /** T-3.23: rounds into the current burst, and when a pause after the last one ends (seconds). */
  burst: { rounds: number; pauseUntil: number };
  /** U-130: per-member legal navigation and cost; null bounds retain legacy movement. */
  readonly bounds: BoundedRegion | null;
  canReach(point: NavPoint): boolean;
  movementCost?: (from: NavPoint, to: NavPoint) => number | null;
  readonly spawnId: string | null;
  /** U-131: visible and damageable, with AI and movement held until release. */
  inactive: boolean;
  /** T-3.32: what it does with nothing to fight (`actions/posture.ts`), or null to stand down. */
  readonly posture: EnemyPosture | null;
  /** T-3.32: a garrison fights from inside its area; anyone else may take cover anywhere. */
  coverNear(): { x: number; z: number; withinM: number } | null;
  /** U-010: the lever the session has sent it to, or null. */
  leverJob(): { x: number; y: number; z: number; reachM: number } | null;
  /** U-062: the downed character the session has sent it to take prisoner, or null. */
  captureJob(): { x: number; y: number; z: number; reachM: number } | null;
}

/** U-017: a dead enemy's firearm on the ground. */
export interface PickupEntity {
  readonly netId: number;
  /** A WEAPON_IDS index. */
  readonly weapon: number;
  /** Rounds left in its magazine. */
  readonly ammo: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Which way it lies, wire units: the body's facing. */
  readonly yaw: number;
  /** When it fell, session seconds. */
  readonly droppedAt: number;
}

/** Where and how to spawn an enemy. */
export interface EnemySpawn {
  inactive?: boolean;
  spawnId?: string;
  captive?: boolean;
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  /** Facing, wire units. */
  yaw?: number;
  /** Side, 0 (hostile to the squad) by default. */
  faction?: number;
  /** A tree to run instead of the archetype's own — tests, and later encounters. */
  tree?: BrainTree;
  /**
   * T-3.21: enemies spawned with the same group id share a group — its
   * target, and the suppress and flank roles it hands out.
   */
  group?: number;
  /** T-3.32: the posture it spawns in and returns to (`actions/posture.ts`); none stands down. */
  posture?: EnemyPosture;
  /** U-067: the waypoints a tank drives, in order, from where it stands; without them it stands still. */
  path?: readonly { x: number; y?: number; z: number }[];
  /** U-110: authored y, distinct from the small automatic navmesh surface offset. */
  authoredHeight?: boolean;
}

/** What a session is built with beyond its tuning, room and world. */
export interface SessionOptions {
  /**
   * The navmesh bots walk their brains' intents on (T-3.05, T-3.06). Without
   * one an intent goes unwalked and the bot stands; idle brains never need it.
   */
  navMesh?: NavMesh;
  /** The tree every bot slot's brain runs. The committed `idle` by default. */
  brainTree?: BrainTree;
  /**
   * T-3.20: the world's baked cover points (`bakedCoverFor`, T-3.18), for
   * fighting brains to take. Passed in rather than imported, as the navmesh
   * is, so the in-page session does not load every world's bake. None: no
   * brain finds cover, and a rifleman fights in the open.
   */
  cover?: readonly CoverPoint[];
  /**
   * T-3.32: the encounter the session plays out (`encounterFor(world.id)`):
   * its groups spawned on their triggers by a `Spawner`, out of every
   * human's sight, under its alive cap. None: nothing spawns but what a
   * caller spawns itself.
   */
  encounter?: Encounter;
  /**
   * T-4.14: the mission played with the encounter, its objectives in order.
   * Defaults to the world's committed one (`missionFor(world.id)`); a
   * session with an encounter and neither plays none.
   */
  mission?: MissionDef;
  /** T-4.15: authored mission events; encounter triggers are included automatically. */
  events?: EventScript;
  /**
   * T-3.09: whether clients may ask for AI debug reports (`AI_DEBUG=1 pnpm
   * host`). Off by default: a host that does not allow it sends nothing, and
   * one that does sends only to the clients that asked.
   */
  aiDebug?: boolean;
  /**
   * Drop a player nobody has driven for this long, ms (`IDLE_TIMEOUT_MS`).
   * Unset or zero never does. A deployed host sets it so a forgotten tab
   * cannot keep a machine that stops itself when empty from ever stopping.
   */
  idleTimeoutMs?: number;
  /**
   * Drop any player connected this long, ms (`MAX_SESSION_MS`), active or not.
   * Unset or zero never does. The backstop for a client that fakes activity.
   */
  maxSessionMs?: number;
  /**
   * T-3.35: count this many humans for the director's budget instead of the
   * slots humans hold. The ONE place a bot is counted as a person, and only
   * the headless mission tool (`pnpm sim-run --scenario mission`) sets it, to
   * play the one-human and six-human budgets with six bots. Never set by a
   * host or the page: ADR-001's budget is the humans seated.
   */
  testHumanCount?: number;
  /** T-3.35: time the AI's share of every tick (`Session.aiMs`), for the mission tool's cost measure. Off by default. */
  profileAi?: boolean;
  /** T-4.19: hosted rooms wait for ready-up before gameplay; direct/local sessions start immediately. */
  roomLobby?: boolean;
  /**
   * T-4.27: 'class' makes each slot carry its class's loadout and health
   * and refuses an Equip outside it; 'free' leaves every gun to every slot.
   * Defaults to 'class' with a room lobby and 'free' without one.
   */
  loadouts?: 'class' | 'free';
  /** T-4.23: durable campaign state restored before anyone joins this room. */
  campaign?: CampaignState;
  /** T-4.23: called only at a completed checkpoint or mission end. */
  onCampaignSave?: (state: CampaignState) => void;
  /** U-090: the campaign the host chooses runs from; the committed one by default (a test gives its own). */
  campaignDef?: CampaignDef;
  /** U-090: this room is moving to another mission (the save is written and the clients told): retire it so a rejoin builds the new one. */
  onHandoff?: () => void;
}

export interface SessionStats {
  tick: number;
  players: number;
  bots: number;
  snapshotsSent: number;
  bytesSent: number;
  /** T-3.09: AI debug reports sent, and their bytes — counted apart from snapshots. */
  aiDebugSent: number;
  aiDebugBytesSent: number;
  /** T-4.33: players seated fresh, and resumed into their own slot (T-4.18). */
  joins: number;
  resumes: number;
  /** T-4.33: milliseconds the AI took over every tick, when profiled (`profileAi`); 0 otherwise. */
  aiMs: number;
}

export class Session {
  readonly slots: Slot[] = [];
  private readonly connections = new Set<ServerConnection>();
  /**
   * T-3.12: each client's view of the world — the filtered snapshots it was
   * sent, which are its delta baselines. Keyed weakly so a closed connection
   * takes its history with it.
   */
  private readonly views = new WeakMap<ServerConnection, ClientView>();
  /**
   * Per-entity position history for lag compensation (T-1.18). Written once per
   * tick for every slot, read when a Fire arrives.
   */
  private readonly hitboxes = new HitboxHistory();
  /**
   * Projectiles in flight (T-2.31). A list rather than a slot array: unlike
   * every other entity in this session they come and go, which is what makes
   * them the first real exercise of the delta format's spawns and despawns.
   */
  private readonly projectiles: ActiveProjectile[] = [];
  /** U-058: projectiles a detonation released this tick, added once the projectile pass is done. */
  private readonly released: ActiveProjectile[] = [];
  private nextProjectileNetId = FIRST_PROJECTILE_NET_ID;
  /** U-017: the weapons on the ground, oldest first, and the next pickup netId (never reused). */
  private readonly pickupList: PickupEntity[] = [];
  /** U-052: the netIds of authored loot: it does not despawn and does not count toward the enemy-drop cap. */
  private readonly authoredPickups = new Set<number>();
  private nextPickupNetId = FIRST_PICKUP_NET_ID;
  private readonly supplyDefs: readonly SupplyCacheDef[];
  private readonly supplyStocks = new Map<string, SupplyStock>();
  private readonly supplyUses = new Map<number, { mode: 'self' | 'commander'; phase: 'approach' | 'collect'; connection: ServerConnection; cacheId: string; item: SupplyItem; ticks: number }>();
  private readonly supplyRequestIds = new WeakMap<ServerConnection, number>();
  private readonly commanderSupplyRequestIds = new WeakMap<ServerConnection, number>();
  private lastSupplyProgress = '';
  private lastSupplyUsers = '';
  /**
   * Enemies (T-3.10): the second class of entity that comes and goes. Spawned
   * by `spawnEnemy`, despawned by the session when a corpse's time is up.
   */
  private readonly enemyList: EnemyEntity[] = [];
  private nextEnemyNetId = FIRST_ENEMY_NET_ID;
  /** Archetype trees bound to the server's registry, built once per tree id. */
  private readonly enemyTrees = new Map<string, BrainTree>();
  /**
   * T-3.14: stimuli emitted since the last step — shots and their impacts and
   * near misses between ticks, blasts and sprints inside the last one — heard
   * by every living enemy at the start of the next.
   */
  private readonly stimuli: Stimulus[] = [];
  /** Per slot, the tick it last fired, for perception's `firing` (T-3.13). */
  private readonly lastFiredTick: number[] = [];
  /** Per slot, horizontal speed over its last step, m/s, for perception and sprint. */
  private readonly slotSpeed: number[] = [];
  private currentTick = 0;
  /**
   * Server time at the last tick, in ms. Still injected — the session reads no
   * clock; it only remembers the last time it was handed.
   */
  private nowMs = 0;
  private nextNetId = 1;
  /** T-4.29: the world's emplacements, as entities. */
  private readonly emplacementList: EmplacementEntity[] = [];
  private snapshotsSent = 0;
  private bytesSent = 0;
  /** T-4.33: seatings, fresh and resumed, for the host's metrics. */
  private joinCount = 0;
  private resumeCount = 0;
  private readonly navMesh: NavMesh | null;
  private readonly boundedRegions = new Map<string, BoundedRegion>();
  /** U-010: the enemy sent to the running upload's lever, and how long it has held it. */
  private leverUse: { enemy: EnemyEntity; seconds: number } | null = null;
  /** U-010: enemies that could not get to the lever, and until when they are not sent again (seconds). */
  private readonly leverBarred = new Map<number, number>();
  /** U-062: the capture jobs under way, by the slot index being taken, and how long each capturer has held them (seconds). */
  private readonly captureUse = new Map<number, { enemy: EnemyEntity; seconds: number }>();
  /** U-062: capturers whose job was interrupted or had no way there, and until when they are not sent again (seconds). */
  private readonly captureBarred = new Map<number, number>();
  /** U-064: the slots the squad has been told are being taken, so each capture is announced once and its end said once. */
  private readonly captureAnnounced = new Set<number>();
  /** T-3.19's cover over this world's baked points, or null without any. */
  readonly cover: CoverSystem | null;
  /** T-3.20: what fighting leaves see of the session; every enemy is handed this one. */
  private readonly combatWorld: CombatWorld;
  private readonly brainTree: BrainTree;
  /**
   * Per slot, the path follower walking its brain's intent, made the first
   * time that brain wants to go somewhere and dropped when it stops wanting
   * to. A bot with none has its input left alone, exactly as before brains.
   */
  private readonly followers: (PathFollower | null)[] = [];
  /** Local avoidance, made with the first follower and stepped every tick after. */
  private avoidance: Avoidance | null = null;
  private readonly aiDebugAllowed: boolean;
  private readonly idleTimeoutMs: number;
  private readonly maxSessionMs: number;
  /** Connections that asked for AI debug reports (T-3.09), while the host allows it. */
  private readonly aiDebugClients = new Set<ServerConnection>();
  private readonly spectators = new Map<ServerConnection, number>();

  /** A spectator retains their command seat while its soldier runs on AI. */
  private autonomous(slot: Slot): boolean {
    return slot.isBot || (slot.connection !== null && this.spectators.has(slot.connection));
  }
  private aiDebugSent = 0;
  private aiDebugBytesSent = 0;

  /**
   * `moveConfig` is a REFERENCE, not a copy. The in-page QA server shares one
   * object with the client's predictor so the movement tuning panel moves both
   * at once; tuning one side only would mispredict every tick and read as the
   * netcode being broken rather than as a tuning artefact.
   */
  /**
   * The named world this session collides, shoots and throws against
   * (T-3.02), and names in every `JoinAck`. Fixed for the session's life.
   */
  readonly world: World;
  /** Static world boxes plus every currently active T-4.15 blocker. Mutated in place for all systems holding it. */
  private readonly collisionBoxes: WorldBox[];
  private readonly blockerStates = new Map<string, ScriptBlockerState>();
  private spawnerValue: Spawner | null;
  private directorValue: Director | null;
  /** T-3.34: the mission's objective, whenever the session has an encounter to play. */
  private readonly missionRun: MissionRun | null;
  /** T-4.15: encounter triggers and authored mission events, reset with each attempt. */
  private readonly eventRun: EventRun | null;
  /** T-3.34: the tick the current attempt began on: mission time counts from here. */
  private missionStartTick = 0;
  /** T-4.16: state restored when a failed mission retries its latest completed objective. */
  private missionCheckpointState: {
    /** Preserve restored provenance; never stamp old coordinates with current content. */
    mapRevision?: number;
    spawns: { x: number; y: number; z: number }[];
    completedGroups: string[];
    event: EventCheckpoint | null;
    /** U-052: what each soldier carried, and what lay on the ground, when the objective was completed. */
    slots?: SlotCheckpoint[];
    ground?: GroundCheckpoint[];
    /** U-059: the mission clock, the living enemies, the spawner's progress and the placed devices at that moment. */
    seconds?: number;
    enemies?: EnemyCheckpoint[];
    spawner?: SpawnerCheckpoint;
    placed?: PlacedCheckpoint[];
    caches?: SupplyCacheStock[];
    /** U-061: the slots held prisoner when it was saved (those carried in, and those taken since). */
    captured?: { slot: number; at: { x: number; y: number; z: number } }[];
  } | null = null;
  /** U-063: the prisoner a soldier is holding interact beside, or null. */
  private rescueTarget: number | null = null;
  private rescueEscortTarget: number | null = null;
  /** U-061: the slots that were prisoners when this mission began: a restart goes back to exactly these. */
  private capturedAtStart: { slot: number; at: { x: number; y: number; z: number } }[] = [];
  /**
   * U-059: an objective was completed while a soldier was downed, so its checkpoint is not saved yet (a restored world
   * never holds a downed soldier). It is taken once the squad is up; until then a retry goes back to `previous`.
   */
  private queuedCheckpoint: { previous: { objective: number; elapsed: number; done: readonly number[] } } | null = null;
  private readonly encounter: Encounter | null;
  private readonly testHumanCount: number | null;
  private readonly profileAi: boolean;
  /** T-4.19: hosted-room ready-up state. */
  private readonly roomLobbyEnabled: boolean;
  private roomStarted: boolean;
  private creatorSlot = -1;
  private readonly readySlots: boolean[] = Array.from({ length: MAX_SLOTS }, () => false);
  /** T-4.27, U-021: the character each slot plays — fixed by the slot (`assignClasses`) — what the roster and the room carry. */
  private readonly classSlots: string[] = Array.from({ length: MAX_SLOTS }, () => '');
  /**
   * U-025: the slot of the human in command of each bot slot; -1 for a human's
   * slot, and for every slot while no human is seated.
   */
  private readonly commanders: number[] = Array.from({ length: MAX_SLOTS }, () => -1);
  /** U-025: a human has been seated in the started session: from now on, no human seated means paused. */
  private commandStarted = false;
  /** U-025: wall time the session has spent paused, taken off every `step`'s clock. */
  private pausedMs = 0;
  /** The wall time of the latest `step`, to measure a pause by. */
  private lastWallMs: number | null = null;
  /** T-4.28: the scoreboard's rows, counted here as things happen and sent whole on every change. */
  private readonly slotStats: SlotStats[] = Array.from({ length: MAX_SLOTS }, (_, slot) => createSlotStats(slot));
  /** The mission state and objective the scoreboard was last sent for, so its clock is resent when either moves. */
  private lastStatsKey = '';
  /**
   * T-4.27: whether a slot's class decides what it carries. A hosted room
   * with a lobby plays by its classes; the in-page session and a plain QA
   * host stay free, so the tuning panels and the range keep every gun.
   */
  private readonly classLoadouts: 'class' | 'free';
  /** T-4.23: the durable campaign metadata this room advances. */
  private readonly campaignCompletedMissions: Set<string>;
  /** U-089: the kind of run this room is. */
  private readonly runKind: RunKind;
  /** U-090: the order missions are played in, which decides what the host may choose next. */
  private readonly campaignDef: CampaignDef;
  /** U-090: the offer last sent, so the same one is not sent every time the mission message is. */
  private lastOfferKey = '';
  private readonly onHandoff: (() => void) | null;
  /** U-090: this room has moved on: it offers nothing more while it closes. */
  private handedOff = false;
  /** U-089: the replay pool as the save held it: in play in a replay run, carried through untouched in a campaign run. */
  private readonly replayPoolAtLoad: ReplayPrisoner[];
  /** U-078: a saved checkpoint that is not this run's (another mission or kind), written back as it was until this run makes its own. */
  private carriedCheckpoint: CampaignState['checkpoint'] = null;
  /** U-077: each soldier's loadout at the start of this run (null: the class's), and what they carried when the mission was won. */
  private startLoadout: (SlotCheckpoint | null)[] = [];
  private missionStartState: MissionStartCheckpoint | null = null;
  /** Refused data stays outside the simulation until the host makes a safe choice. */
  private incompatibleCampaign: CampaignState | null = null;
  private lastRestoreGateKey = '';
  private completionLoadout: SlotCheckpoint[] | null = null;
  private readonly campaignSoldiers: CampaignState['soldiers'];
  private readonly xp: SoldierXp;
  /** Local sessions have no identity service; keep a temporary identity across seat resumes. */
  private readonly localPlayers = new Map<number, string>();
  private readonly campaignSave: ((state: CampaignState) => void) | null;
  private readonly missionId: string | null;
  /** T-3.35: milliseconds spent in the AI's share of every tick so far, when `profileAi` is on; 0 otherwise. */
  aiMs = 0;

  constructor(
    private readonly moveConfig: MoveConfig = DEFAULT_MOVE_CONFIG,
    /** The code clients are told they landed in. Empty for a lone session. */
    readonly room = '',
    /** A world id (`WORLD=range pnpm host`), or a built world — tests make their own. */
    world: string | World = DEFAULT_WORLD_ID,
    options: SessionOptions = {},
  ) {
    this.world = typeof world === 'string' ? requireWorld(world) : world;
    this.collisionBoxes = [...this.world.boxes];
    this.navMesh = options.navMesh ?? null;
    // T-3.33: an encounter is paced by the director, from the fight and the humans in it.
    this.encounter = options.encounter ?? null;
    this.testHumanCount = options.testHumanCount ?? null;
    this.profileAi = options.profileAi ?? false;
    this.roomLobbyEnabled = options.roomLobby ?? false;
    this.classLoadouts = options.loadouts ?? (this.roomLobbyEnabled ? 'class' : 'free');
    this.roomStarted = !this.roomLobbyEnabled;
    this.directorValue = null;
    this.spawnerValue = null;
    const missionDef = options.mission ?? missionFor(this.world.id);
    this.missionId = missionDef?.id ?? null;
    this.campaignSave = options.onCampaignSave ?? null;
    this.campaignCompletedMissions = new Set(options.campaign?.completedMissions ?? []);
    this.runKind = options.campaign?.run ?? 'campaign';
    this.campaignDef = options.campaignDef ?? CAMPAIGN;
    this.onHandoff = options.onHandoff ?? null;
    this.replayPoolAtLoad = (options.campaign?.replayPrisoners ?? []).map((p) => ({ slot: p.slot, at: { ...p.at } }));
    this.campaignSoldiers = (options.campaign?.soldiers ?? Array.from({ length: MAX_SLOTS }, (_, slot) => ({ slot, classId: '', rank: 0, xp: 0 })))
      .map((soldier) => ({ ...soldier }));
    this.xp = new SoldierXp(this.campaignSoldiers);
    if (this.encounter && this.world.mission && missionDef) {
      checkMission(missionDef, this.encounter, this.world);
      const encounter = this.encounter;
      this.missionRun = new MissionRun(missionDef, (ref) => resolveArea(ref, encounter, this.world));
    } else {
      this.missionRun = null;
    }
    const saved = options.campaign?.checkpoint;
    const honoured = saved && saved.mission === this.missionId && (saved.run ?? 'campaign') === this.runKind;
    if (honoured && saved.mapRevision !== (this.world.mapRevision ?? 1)) {
      this.incompatibleCampaign = structuredClone(options.campaign!);
      this.roomStarted = false;
    }
    if (this.roomStarted) this.startEncounter();
    const script = options.events ?? this.committedScript(missionDef) ?? { world: this.world.id, blockers: [], events: [] };
    this.supplyDefs = script.supplyCaches ?? [];
    for (const cache of this.supplyDefs) {
      const p = cache.feet;
      const supported = spawnGround(p, p.y, this.collisionBoxes, this.moveConfig,
        this.navMesh ? (point) => this.navMesh!.nearestPoint(point) : undefined);
      if (!supported || blockedAt(p.x, p.z, this.moveConfig.radius, p.y, .05, this.moveConfig.height, this.collisionBoxes)) {
        throw new Error(`supply cache '${cache.id}': unsupported or obstructed authored floor`);
      }
    }
    this.resetSupplies();
    this.eventRun = this.encounter
      ? new EventRun(script, this.encounter, this.world, this.eventHost())
      : null;
    const mesh = this.navMesh;
    this.cover =
      options.cover && options.cover.length > 0
        ? new CoverSystem(
            options.cover,
            this.collisionBoxes,
            mesh
              ? (a, b) => {
                  // An active vault is between nav surfaces; plan from its known takeoff.
                  const vault = (a as Partial<MoveState>).vault;
                  const from = vault ? { x: vault.fromX, y: vault.fromY, z: vault.fromZ } : a;
                  const path = mesh.path(from, b);
                  const cost = completePathLength(path, from, b);
                  return cost === null ? null : cost + Math.hypot(a.x - from.x, a.y - from.y, a.z - from.z);
                }
              : undefined,
          )
        : null;
    this.combatWorld = {
      cover: this.cover,
      boxes: this.collisionBoxes,
      now: () => this.nowMs / 1000,
      eyeOf: (netId) => {
        const s = this.soldier(netId);
        return s && !isDead(s.health) ? soldierEye(s.state) : null;
      },
      friendsOf: (netId, faction) =>
        this.enemyList
          .filter((e) => e.netId !== netId && e.faction === faction && !isDead(e.health))
          .map((e) => ({ x: e.state.x, y: e.state.y, z: e.state.z })),
      projectileDef: (index) => this.projectileDef(index),
      projectileWorld: () => this.projectileWorld(),
      armour: () => this.armourViews(),
      placed: (ownerNetId, kind) => this.projectiles.filter((p) => p.kind === kind && p.stuck === true && p.ownerNetId === ownerNetId).map((p) => ({ x: p.state.x, y: p.state.y, z: p.state.z })),
    };
    this.brainTree = options.brainTree ?? defaultBrainTree();
    this.aiDebugAllowed = options.aiDebug ?? false;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 0;
    this.maxSessionMs = options.maxSessionMs ?? 0;
    // Six slots exist from the moment the session does (ADR-001).
    this.formation = new Formation((p) => (mesh ? (mesh.nearestPoint(p)?.point ?? null) : p));
    const squad: SquadView = {
      place: (index) => this.formation.place(index),
      aggression: (index) => this.aggressionFor(index),
      canEngage: (index, target) => this.canBotEngage(index, target),
      downedNear: (index) => this.downedNear(index),
      hurtNear: (index) => this.hurtNear(index),
      needsKit: (index) => {
        const me = this.slots[index];
        return !!me && isAlive(me.health) && !me.mounted && me.kits > 0 && me.health.current < me.health.max * SQUAD_CONFIG.bot.kitBelowFraction;
      },
      order: (index) => {
        const order = this.orders[index];
        const run = this.orderRuns[index];
        return order && run ? { ...order, status: run.status, anchor: run.anchor } : null;
      },
      report: (index, outcome, reason) => this.orderOutcome(index, outcome, reason),
      terminal: () => {
        const run = this.missionRun;
        const up = run && this.roomStarted ? run.openUpload() : null;
        if (up && up.phase !== 'active') return { ...up.def.terminal, reachM: up.def.reachM };
        const rescue = run?.openObjectives().filter((o) => !o.done).map((o) => o.def).find((o) => o.type === 'rescue');
        if (rescue?.type === 'rescue' && rescue.group) {
          const ids = this.spawnerValue?.spawnedBy(rescue.group) ?? [];
          const pow = this.enemyList.find((e) => ids.includes(e.netId) && e.captive && isAlive(e.health));
          if (pow) return { x: pow.state.x, y: pow.state.y + 1, z: pow.state.z, reachM: rescue.reachM };
        }
        return null;
      },
      reachable: (from, to) => {
        const m = this.navMesh;
        if (!m) return false;
        const path = m.path(from, to);
        const end = path?.points[path.points.length - 1];
        // U-123: a partial corridor ending on the floor beneath (or above) the goal is no way there.
        return !!end && within(end, to, ORDER_REACH_M);
      },
      soldier: (netId) => {
        const slot = this.slots.find((sl) => sl.netId === netId);
        if (slot) return { netId, index: slot.index, x: slot.state.x, y: slot.state.y, z: slot.state.z, downed: isDowned(slot.health), dead: isDead(slot.health) };
        const e = this.enemyList.find((en) => en.netId === netId);
        return e ? { netId, index: -1, x: e.state.x, y: e.state.y, z: e.state.z, downed: false, dead: isDead(e.health) } : null;
      },
    };
    // The squad's side of the world (T-3.26): the same world, with squadmates as the friends.
    this.squadCombat = {
      ...this.combatWorld,
      friendsOf: (netId) => this.slots.filter((s) => s.netId !== netId && !isDead(s.health)).map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z })),
    };
    this.botsDriven = this.brainTree !== defaultBrainTree();
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.slots.push({
        index: i,
        squad,
        faction: SQUAD,
        target: null,
        memory: createTargetMemory(),
        awareness: new Map(),
        lastDamagedAt: -Infinity,
        combat: this.squadCombat,
        group: null,
        still: createStillWatch(),
        aim: null,
        burst: { rounds: 0, pauseUntil: 0 },
        coverNear: () => {
          const place = this.formation.place(i);
          return place ? { x: place.goal.x, z: place.goal.z, withinM: formationBand(place.offset) } : null;
        },
        netId: this.nextNetId++,
        isBot: true,
        state: createMoveState(this.squadStart(i).x, this.squadStart(i).y, this.squadStart(i).z),
        yaw: 0,
        input: idleInput(),
        lastProcessedInputTick: -1,
        pendingInputTick: -1,
        newestInputTick: -1,
        queue: [],
        staleTicks: 0,
        connection: null,
        resumeToken: '',
        reservedUntilMs: 0,
        weapon: getWeapon(WEAPON_IDS[0]),
        weaponState: createWeaponState(getWeapon(WEAPON_IDS[0])),
        primary: WEAPON_IDS[0],
        pickedUp: false,
        captured: false,
        prisoner: null,
        dropPending: false,
        noPistol: false,
        kits: 3,
        equipment: FIRST_EQUIPMENT,
        kitProgress: 0,
        kitTarget: -1,
        kitHealth: 0,
        cook: null,
        cookHeld: false,
        cookWasHeld: false,
        secondary: null,
        stowed: new Map(),
        suppression: createSuppression(),
        pitch: 0,
        pouch: this.fullPouch(),
        nextThrowAt: 0,
        heldProjectile: -1,
        health: createHealth(),
        reviveBySlot: -1,
        reviveProgressSeconds: 0,
        interactHeld: false,
        interactWasHeld: false,
        mounted: null,
        brain: null,
        brainGeneration: 0,
      });
      this.followers.push(null);
      this.lastFiredTick.push(-Infinity);
      this.slotSpeed.push(0);
      this.giveBrain(this.slots[i]!);
    }
    // T-4.29: the level's emplacements, each an entity with a netId after the slots'.
    for (const placed of this.world.emplacements) {
      const def = getEmplacement(placed.kind);
      const weapon = getWeapon(def.weapon);
      const facing = emplacementFacing(placed);
      this.emplacementList.push({
        netId: this.nextNetId++,
        placed,
        def,
        kind: emplacementIndex(placed.kind),
        facing,
        place: gunnerPlace(placed, def),
        muzzle: gunMuzzle(placed, def),
        weapon,
        weaponState: createWeaponState(weapon),
        heat: createHeat(),
        yaw: facing,
        pitch: 0,
        gunnerNetId: 0,
        outOfArcSince: null,
      });
    }
    // T-4.27: every slot plays a class from the start; a bot's is the slot's default.
    this.reassignClasses();
    this.startLoadout = this.campaignSoldiers.map((soldier) => soldier.loadout ?? null);
    for (const slot of this.slots) this.applyStartLoadout(slot);
    // U-061: the prisoners the campaign carries in are out of play from the start.
    // U-089: only the pool of this kind of run is in play: a campaign run holds the campaign pool (the soldier records),
    // a replay run the replay pool; the other is kept for the next run of its kind.
    this.capturedAtStart =
      this.runKind === 'replay'
        ? this.replayPoolAtLoad.map((p) => ({ slot: p.slot, at: { ...p.at } }))
        : this.campaignSoldiers.flatMap((soldier, slot) => (soldier.captured === true && soldier.prisoner ? [{ slot, at: { ...soldier.prisoner } }] : []));
    if (!this.incompatibleCampaign) this.applyCaptured(this.capturedAtStart);
    else {
      // Keep roster membership without giving a prisoner any saved or invented holding coordinates.
      for (const held of this.capturedAtStart) {
        const slot = this.slots[held.slot]!;
        slot.captured = true;
        slot.health.current = 0;
        slot.health.diedAt = 0;
      }
    }
    // U-078: a checkpoint is for the kind of run it was made in; another kind's, or another mission's, is carried through untouched.
    this.carriedCheckpoint = saved && !honoured ? saved : null;
    const baseline = honoured ? parseMissionStart(saved.missionStart) : null;
    if (baseline) {
      this.missionStartState = baseline;
      this.capturedAtStart = structuredClone(baseline.captured);
      // U-143: a newly acknowledged basic start has no spent world yet (notably before lobby ready-up).
      if (!this.incompatibleCampaign && saved?.world == null) for (const slot of this.slots) this.applyStartLoadout(slot);
    } else if (this.roomStarted) {
      this.captureMissionStart();
    }
    if (saved && honoured && this.missionRun && !this.incompatibleCampaign) {
      this.missionRun.restoreCheckpoint(saved.objective, saved.elapsedTicks, saved.done ?? []);
      // U-060: the world the checkpoint saved, if the file has one a session could have written; else the basic checkpoint.
      const world = saved.world == null ? null : parseCheckpointWorld(saved.world);
      if (saved.world != null && world === null) console.warn(`[campaign] the saved checkpoint world for '${saved.mission}' was refused; resuming from the basic checkpoint`);
      this.missionCheckpointState = {
        ...(saved.mapRevision === undefined ? {} : { mapRevision: saved.mapRevision }),
        spawns: saved.spawns.map((point) => ({ ...point })),
        completedGroups: [...saved.completedGroups],
        event: saved.event as EventCheckpoint | null,
        captured: this.capturedList(),
        ...(world
          ? {
              seconds: world.seconds,
              slots: world.slots,
              ground: world.ground,
              enemies: world.enemies,
              placed: world.placed,
              ...(world.caches === undefined ? {} : { caches: world.caches }),
              ...(world.spawner ? { spawner: world.spawner } : {}),
            }
          : {}),
      };
      for (const slot of this.slots) {
        const point = saved.spawns[slot.index] ?? this.squadStart(slot.index);
        slot.state = createMoveState(point.x, point.y, point.z);
      }
      // U-001: a started session's spawner was built before the checkpoint was known.
      if (this.roomStarted) {
        this.startEncounter(this.missionCheckpointState.completedGroups);
        this.restoreEvents(this.missionCheckpointState, this.restoreCheckpointWorld(this.missionCheckpointState));
      }
    }
    if (this.roomStarted) this.initializeEncounter();
  }

  /** U-110: every fresh-start and fallback path uses the same slot-ordered authored feet. */
  private squadStart(index: number): { x: number; y: number; z: number } {
    return this.world.squadStarts?.[index] ?? spawnFor(index);
  }

  /** A fresh brain for a bot slot, starting from the entity as it stands. */
  private giveBrain(slot: Slot): void {
    slot.brain?.stop();
    slot.brain = new Brain(slot, this.brainTree, slot.brainGeneration++);
    this.followers[slot.index] = null;
  }

  /** A human has the slot: the brain stops now, before it produces another input. */
  private takeBrain(slot: Slot): void {
    slot.brain?.stop();
    slot.brain = null;
    this.followers[slot.index] = null;
  }

  get tick(): number {
    return this.currentTick;
  }

  get stats(): SessionStats {
    return {
      tick: this.currentTick,
      players: this.slots.filter((s) => !s.isBot).length,
      bots: this.slots.filter((s) => s.isBot).length,
      snapshotsSent: this.snapshotsSent,
      bytesSent: this.bytesSent,
      aiDebugSent: this.aiDebugSent,
      aiDebugBytesSent: this.aiDebugBytesSent,
      joins: this.joinCount,
      resumes: this.resumeCount,
      aiMs: this.aiMs,
    };
  }

  /** Enemies in the session, living and dead, oldest first (T-3.10). */
  // -------------------------------------------------------------------------
  // T-3.34: the mission
  // -------------------------------------------------------------------------

  /** Where the mission stands, or null for a session with none. */
  get mission(): Readonly<MissionView> | null {
    return this.missionRun?.current ?? null;
  }

  /** A fresh director and spawner for the encounter, counting mission time from now. */
  private startEncounter(completedGroups: readonly string[] = []): void {
    if (!this.encounter) return;
    this.missionStartTick = this.currentTick;
    this.directorValue = new Director();
    this.spawnerValue = new Spawner(this.encounter, this.world, this.spawnerHost(), undefined, this.directorValue, true, completedGroups);
  }

  private initializeEncounter(): void { this.spawnerValue?.initialize(); }

  /** Evaluate the objective, at the end of a tick, and tell everyone when what they see of it changed. */
  private stepMission(): void {
    const run = this.missionRun;
    if (!run) return;
    const beforeDone = new Set(run.doneObjectives);
    const beforeState = run.current.state;
    const beforeCheckpoint = { objective: run.checkpoint, elapsed: run.checkpointElapsed, done: run.checkpointDoneList };
    const inside = (a: GroundArea) => (p: { x: number; y: number; z: number }) => areaContains(a, p);
    const living = this.slots.filter((s) => !isDead(s.health));
    const standing = this.slots.filter((s) => isAlive(s.health));
    const spawner = this.spawnerValue;
    const alive = (netId: number) => this.enemyList.some((e) => e.netId === netId && !isDead(e.health));
    const changed = run.step({
      enemiesIn: (a) => this.enemyList.filter((e) => !e.def.friendly && !isDead(e.health) && inside(a)(e.state)).length,
      squadIn: (a) => living.filter((s) => inside(a)(s.state)).length,
      escortsIn: (a) => {
        const escorts = this.enemyList.filter((e) => e.def.friendly && !isDead(e.health));
        return { total: escorts.length, inside: escorts.filter((e) => inside(a)(e.state)).length };
      },
      standing: () => standing.length,
      squadSize: () => this.slots.length,
      standingIn: (a) => standing.filter((s) => inside(a)(s.state)).length,
      // U-061: a prisoner is not a death: the mission goes on without them.
      soldierDead: () => this.slots.some((s) => isDead(s.health) && !s.captured) || this.enemyList.some((e) => e.def.friendly && isDead(e.health)),
      protectedLost: (id) => {
        if (!spawner || !spawner.fired(id)) return false;
        const placed = spawner.spawnedBy(id);
        return placed.length > 0 && placed.every((n) => !alive(n));
      },
      group: (id) => {
        if (!spawner) return { dead: false, spawned: 0, down: 0 };
        const placed = spawner.spawnedBy(id);
        return { dead: spawner.dead(id), spawned: placed.length, down: placed.filter((n) => !alive(n)).length };
      },
      rescue: (slot, reachM, group) => this.rescueHold(slot, reachM, group),
    });
    // U-074: every objective that finished this tick (a stage can finish several at once).
    const finished = run.doneObjectives.filter((i) => !beforeDone.has(i));
    if (beforeState === 'progress' && finished.length > 0) {
      for (const slot of this.slots) this.awardXp(slot.index, 'objective');
      for (const i of finished) {
        const def = run.objectiveDef(i);
        // U-009: say so — the HUD's line moves straight on to what comes next.
        if (def.type === 'upload') this.eventHost().message(`Upload complete: ${def.label}`);
        // U-063: a rescue finished frees the prisoner it was held over.
        if (def.type === 'rescue') this.completeRescue();
      }
    }
    if (run.current.state === 'progress' && finished.some((i) => run.objectiveDef(i).checkpoint !== false)) this.requestCheckpoint(beforeCheckpoint);
    else if (this.queuedCheckpoint && run.current.state === 'progress') this.takeQueuedCheckpoint();
    if (beforeState === 'progress' && run.current.state === 'complete') {
      // U-089: a replay does not move the campaign on.
      if (this.missionId && this.runKind === 'campaign') this.campaignCompletedMissions.add(this.missionId);
      // U-077: what each soldier carries as the mission is won is what the campaign holds for the next run.
      this.completionLoadout = this.slots.map((slot) => this.checkpointSlot(slot));
      this.missionCheckpointState = null;
      this.queuedCheckpoint = null;
      this.persistCampaign();
    }
    if (beforeState === 'progress' && run.current.state === 'failed') this.persistCampaign();
    if (changed) this.broadcastMission();
  }

  /**
   * U-063: the prisoners a rescue objective could free, and whether a standing soldier is holding interact beside
   * one. A holder must be alive, not downed, within `reachM` of the prisoner with a clear line to them; the nearest
   * prisoner to the first such soldier (in slot order) is the one being freed, and a change of prisoner starts the
   * hold over.
   */
  private rescueHold(slot: number | null, reachM: number, group?: string): { held: number; holding: { scale: number } | null } {
    if (group) {
      const ids = this.spawnerValue?.spawnedBy(group) ?? [];
      const pow = this.enemyList.find((e) => ids.includes(e.netId) && e.def.friendly);
      if (pow && !pow.captive) return { held: 0, holding: null };
      const holder = pow && isAlive(pow.health) ? this.slots.find((s) => {
        if (s.captured || !isAlive(s.health) || s.state.vault || !this.holdingInteract(s)) return false;
        const eye = soldierEye(s.state);
        const at = { x: pow.state.x, y: pow.state.y + 1, z: pow.state.z };
        return Math.sqrt((eye.x - at.x) ** 2 + (eye.y - at.y) ** 2 + (eye.z - at.z) ** 2) <= reachM && lineOfSight(eye, at, this.collisionBoxes);
      }) : undefined;
      const target = holder ? pow!.netId : null;
      if (holder) this.clearSupplyUse(holder.index);
      const changed = target !== this.rescueEscortTarget;
      this.rescueEscortTarget = target;
      return { held: 1, holding: holder && !changed ? { scale: this.interactionScale(holder.index) } : null };
    }
    const held = this.slots.filter((s) => s.captured && s.prisoner && (slot === null || s.index === slot));
    let target: Slot | null = null;
    let holder: Slot | null = null;
    for (const soldier of this.slots) {
      if (soldier.captured || !isAlive(soldier.health) || soldier.state.vault || !this.holdingInteract(soldier)) continue;
      const eye = soldierEye(soldier.state);
      let best: Slot | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const p of held) {
        const at = { x: p.prisoner!.x, y: p.prisoner!.y + 1, z: p.prisoner!.z };
        const d = Math.sqrt((eye.x - at.x) ** 2 + (eye.y - at.y) ** 2 + (eye.z - at.z) ** 2);
        if (d <= reachM && d < bestD && lineOfSight(eye, at, this.collisionBoxes)) {
          best = p;
          bestD = d;
        }
      }
      if (best) {
        target = best;
        holder = soldier;
        break;
      }
    }
    const changed = (target?.index ?? null) !== this.rescueTarget;
    if (holder) this.clearSupplyUse(holder.index);
    this.rescueTarget = target?.index ?? null;
    return { held: held.length, holding: target && holder && !changed ? { scale: this.interactionScale(holder.index) } : null };
  }

  /** U-063: the hold completed (or there was no one to free): free whoever it was held over. */
  private completeRescue(): void {
    const escort = this.enemyList.find((e) => e.netId === this.rescueEscortTarget);
    this.rescueEscortTarget = null;
    if (escort) {
      escort.captive = false;
      this.escortOrder = { kind: 'follow', point: null };
    }
    const target = this.rescueTarget;
    this.rescueTarget = null;
    if (target !== null) this.freeCharacter(target);
  }

  /** U-061: the prisoners held right now. */
  private capturedList(): { slot: number; at: { x: number; y: number; z: number } }[] {
    return this.slots.flatMap((s) => (s.captured && s.prisoner ? [{ slot: s.index, at: { ...s.prisoner } }] : []));
  }

  /** U-061: a slot's character taken out of play, held at `at`: as if dead, but with no respawn and no mission failure. */
  private holdPrisoner(slot: Slot, at: { x: number; y: number; z: number }): void {
    if (slot.mounted) this.dismount(slot);
    this.clearReviveStateForSlot(slot.index);
    slot.captured = true;
    slot.prisoner = { x: at.x, y: at.y, z: at.z };
    slot.state = createMoveState(at.x, at.y, at.z);
    slot.health.current = 0;
    slot.health.downedAt = null;
    slot.health.diedAt = this.nowMs / 1000;
    slot.queue.length = 0;
    slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
    slot.heldProjectile = -1;
    slot.cook = null;
  }

  /** U-061: exactly these slots are prisoners; any other is free (and, when this follows a world reset, already alive). */
  private applyCaptured(list: readonly { slot: number; at: { x: number; y: number; z: number } }[]): void {
    for (const slot of this.slots) {
      const held = list.find((c) => c.slot === slot.index);
      if (held) this.holdPrisoner(slot, held.at);
      else if (slot.captured) {
        slot.captured = false;
        slot.prisoner = null;
      }
    }
    this.broadcastRoster();
  }

  /**
   * U-061: the enemy takes a character prisoner, held at `at`. The eligibility (downed long enough, alone) is the
   * capture behaviour's (U-062) to decide; this only refuses what cannot be taken: no such slot, already a prisoner,
   * or dead. Returns whether it was taken.
   */
  captureCharacter(index: number, at: { x: number; y: number; z: number }): boolean {
    const slot = this.slots[index];
    if (!slot || slot.captured || isDead(slot.health)) return false;
    this.holdPrisoner(slot, at);
    this.captureAnnounced.delete(index);
    this.sayToSquad(`${this.characterName(index)} was taken prisoner`);
    this.broadcastRoster();
    return true;
  }

  /**
   * U-061: a prisoner is freed at the place they were held, back at full class health with their class's kit; rank and
   * XP were never touched. Returns whether anyone was freed.
   */
  freeCharacter(index: number): boolean {
    const slot = this.slots[index];
    if (!slot || !slot.captured || !slot.prisoner) return false;
    const at = slot.prisoner;
    slot.captured = false;
    slot.prisoner = null;
    respawn(slot.health, DAMAGE, this.nowMs / 1000);
    this.applyClassHealth(slot);
    slot.state = createMoveState(at.x, at.y, at.z);
    slot.queue.length = 0;
    slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
    this.restorePrimary(slot);
    slot.weaponState = createWeaponState(slot.weapon);
    slot.suppression = createSuppression();
    slot.pouch = this.pouchFor(slot.index);
    slot.kits = this.kitsFor(slot.index);
    slot.equipment = this.equipmentFor(slot.index);
    slot.nextThrowAt = 0;
    this.sayToSquad(`${this.characterName(index)} was rescued`);
    this.broadcastRoster();
    return true;
  }

  /** U-064: a slot's character as the squad names them: the class's name, or the slot number before one is assigned. */
  private characterName(index: number): string {
    return classById(this.classSlots[index] ?? '')?.name ?? `Soldier ${index + 1}`;
  }

  /** U-064: a line to every seated connection (the client shows it as a notice; no voice is implied, ADR-017). */
  private sayToSquad(text: string): void {
    const msg: Message = { kind: 'ScriptMessage', text };
    for (const conn of this.connections) if (conn.state === 'active') conn.send(msg);
  }

  /**
   * U-064: says, once each, that a capture has begun (the capturer is at the character) and that one was stopped
   * without taking them, and sends the roster when who is being held changed. A capture that completes is said by
   * `captureCharacter`, which takes the slot out of the set.
   */
  private announceCaptures(): void {
    let changed = false;
    for (const [index, job] of this.captureUse) {
      if (job.seconds <= 0 || this.captureAnnounced.has(index)) continue;
      this.captureAnnounced.add(index);
      this.sayToSquad(`${this.characterName(index)} is being taken`);
      changed = true;
    }
    for (const index of [...this.captureAnnounced]) {
      if ((this.captureUse.get(index)?.seconds ?? 0) > 0) continue;
      this.captureAnnounced.delete(index);
      if (!this.slots[index]?.captured) this.sayToSquad(`${this.characterName(index)} was not taken`);
      changed = true;
    }
    if (changed) this.broadcastRoster();
  }

  /** U-059: whether any soldier is downed: no checkpoint is saved while one is (owner, 2026-09-30). */
  private someoneDowned(): boolean {
    return this.slots.some((s) => isDowned(s.health));
  }

  /**
   * U-059: an objective was completed. The checkpoint is saved now, unless a soldier is downed, when it is queued
   * until the squad is up (`previous` is where a retry goes meanwhile: the last checkpoint that was saved).
   */
  private requestCheckpoint(previous: { objective: number; elapsed: number; done: readonly number[] }): void {
    if (this.someoneDowned()) {
      // A second objective completed while still waiting keeps the first previous: it is still the last saved.
      this.queuedCheckpoint ??= { previous };
      this.missionRun?.setCheckpoint(this.queuedCheckpoint.previous.objective, this.queuedCheckpoint.previous.elapsed, this.queuedCheckpoint.previous.done);
      return;
    }
    this.queuedCheckpoint = null;
    this.captureMissionCheckpoint();
  }

  /** U-059: the queued checkpoint, once nobody is downed: taken as of now, at the objective the squad is on. */
  private takeQueuedCheckpoint(): void {
    const run = this.missionRun;
    if (!run || !this.queuedCheckpoint || this.someoneDowned()) return;
    this.queuedCheckpoint = null;
    run.setCheckpoint(run.point.objective, run.elapsed, run.point.done);
    this.captureMissionCheckpoint();
  }

  /** Remember the squad, cleared encounter groups and script state at a completed objective. */
  private captureMissionCheckpoint(): void {
    if (this.incompatibleCampaign) return;
    const spawner = this.spawnerValue;
    const completedGroups =
      // U-001: a group beaten down to stragglers is as good as dead to a retry: it is not sent again.
      spawner && this.encounter ? this.encounter.groups.filter((g) => spawner.broken(g.id)).map((g) => g.id) : [];
    this.missionCheckpointState = {
      mapRevision: this.world.mapRevision ?? 1,
      spawns: this.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z })),
      completedGroups,
      event: this.eventRun?.checkpoint() ?? null,
      captured: this.capturedList(),
      seconds: (this.currentTick - this.missionStartTick) * TICK_SECONDS,
      ...(spawner ? { spawner: spawner.checkpoint() } : {}),
      enemies: this.enemyList
        .filter((e) => !isDead(e.health))
        .map((e) => ({
          netId: e.netId,
          ...(e.spawnId === null ? {} : { spawnId: e.spawnId }),
          ...(e.inactive ? { inactive: true } : {}),
          archetype: e.def.id,
          ...(e.def.friendly ? { captive: e.captive ?? false, escortOrder: structuredClone(this.escortOrder) } : {}),
          faction: e.faction,
          x: e.state.x,
          y: e.state.y,
          z: e.state.z,
          yaw: e.yaw,
          health: e.health.current,
          group: spawner?.groupOfEnemy(e.netId) ?? null,
          posture: e.posture ? structuredClone(e.posture) : null,
          ammo: e.weaponState.ammo,
          pouch: [...e.pouch],
          ...(e.def.vehicle
            ? {
                vehicle: {
                  path: e.drive ? e.drive.path.map((p) => ({ ...p })) : [],
                  next: e.drive?.next ?? 0,
                  heading: e.drive?.heading ?? 0,
                  phase: e.drive?.phase ?? 'arrived',
                  origin: e.drive?.origin ? { ...e.drive.origin } : null,
                  withdrawing: e.drive?.withdrawing ?? false,
                  turretYaw: e.turretYaw,
                  cannonIn: Math.max(0, e.cannonReadyAt - this.nowMs / 1000),
                },
              }
            : {}),
        })),
      placed: this.projectiles
        .filter((p) => p.stuck && !p.destroyed)
        .map((p) => ({ kind: p.kind, ownerSlot: p.ownerSlot, state: { ...p.state }, ...(p.facing ? { facing: { ...p.facing } } : {}) })),
      slots: this.slots.map((slot) => this.checkpointSlot(slot)),
      ground: this.pickupList.map((p) => ({ weapon: p.weapon, ammo: p.ammo, x: p.x, y: p.y, z: p.z, yaw: p.yaw, authored: this.authoredPickups.has(p.netId) })),
      caches: this.supplyCaches.map(({ id, stock }) => ({ id, stock })),
    };
    this.persistCampaign();
  }

  /** U-052: what a soldier carries right now, for a retry to give back. */
  private checkpointSlot(slot: Slot): SlotCheckpoint {
    const ammo: [string, number][] = [[slot.weapon.id, slot.weaponState.ammo]];
    for (const [id, state] of slot.stowed) if (id !== slot.weapon.id) ammo.push([id, state.ammo]);
    return {
      health: isDead(slot.health) ? slot.health.max : slot.health.current,
      weapon: slot.weapon.id,
      primary: slot.primary,
      secondary: slot.secondary,
      noPistol: slot.noPistol,
      pickedUp: slot.pickedUp,
      ammo,
      pouch: [...slot.pouch],
      kits: slot.kits,
      equipment: slot.equipment,
    };
  }

  /** U-052: put a soldier's guns, rounds, pouch, kits and equipment back as a snapshot has them. Health is the caller's. */
  private applySlotLoadout(slot: Slot, snap: SlotCheckpoint): void {
    slot.primary = snap.primary;
    slot.secondary = snap.secondary;
    slot.noPistol = snap.noPistol;
    slot.pickedUp = snap.pickedUp;
    slot.stowed.clear();
    for (const [id, rounds] of snap.ammo) {
      if (id === snap.weapon) continue;
      const state = createWeaponState(getWeapon(id));
      state.ammo = rounds;
      slot.stowed.set(id, state);
    }
    slot.weapon = getWeapon(snap.weapon);
    slot.weaponState = createWeaponState(slot.weapon);
    slot.weaponState.ammo = snap.ammo.find(([id]) => id === snap.weapon)?.[1] ?? slot.weaponState.ammo;
    slot.pouch = [...snap.pouch];
    slot.kits = snap.kits;
    slot.equipment = snap.equipment;
    slot.heldProjectile = -1;
  }

  /**
   * U-077: a campaign run starts each soldier from the loadout the campaign holds (absent: the class's), and a retry
   * or a restart returns to that, never to a half-spent state. A replay run starts from the class's, the mission's default.
   */
  private applyStartLoadout(slot: Slot): void {
    const snap = this.missionStartState?.slots[slot.index] ?? this.startLoadout[slot.index];
    if (!snap || (!this.missionStartState && (this.classLoadouts !== 'class' || this.runKind !== 'campaign'))) return;
    try {
      for (const [id] of snap.ammo) getWeapon(id);
      getWeapon(snap.weapon);
    } catch {
      return;
    }
    this.applySlotLoadout(slot, snap);
  }

  /** Capture at ready-up after loadout setup, before any checkpoint spends stock. */
  private captureMissionStart(): void {
    this.missionStartState = {
      slots: this.slots.map((slot) => this.checkpointSlot(slot)),
      captured: structuredClone(this.capturedAtStart),
    };
  }

  /** U-052: a retry puts the world back as the checkpoint saw it: what each soldier carried, and what lay on the ground. */
  private restoreCheckpointWorld(saved: {
    seconds?: number;
    slots?: SlotCheckpoint[];
    ground?: GroundCheckpoint[];
    enemies?: EnemyCheckpoint[];
    spawner?: SpawnerCheckpoint;
    placed?: PlacedCheckpoint[];
    caches?: SupplyCacheStock[];
  } | null): boolean {
    if (!saved) return false;
    // Validate/apply all cache stock before touching any paired soldier inventory.
    if (saved.caches) this.restoreSupplies(saved.caches);
    else this.clearSupplyUses(); // Legacy checkpoints still cancel transient self/commander uses.
    for (const [i, snap] of (saved.slots ?? []).entries()) {
      const slot = this.slots[i];
      if (!slot) continue;
      // U-059: as hurt as it was when saved (nobody was downed then), never above its maximum.
      if (snap.health > 0) slot.health.current = Math.min(snap.health, slot.health.max);
      this.applySlotLoadout(slot, snap);
    }
    for (const g of saved.ground ?? []) this.placePickupItem(g.weapon, g.ammo, g, g.yaw, g.authored);
    for (const d of saved.placed ?? []) {
      const def = this.projectileDefs[d.kind];
      const owner = this.slots[d.ownerSlot];
      if (!def || !owner) continue;
      this.projectiles.push({
        netId: this.nextProjectileNetId++,
        def,
        kind: d.kind,
        ownerSlot: owner.index,
        ownerNetId: owner.netId,
        xpPlayerId: this.xpPlayer(owner.index),
        state: { ...d.state },
        stuck: true,
        ...(d.facing ? { facing: { ...d.facing } } : {}),
      });
    }
    return this.restoreEnemies(saved);
  }

  /**
   * U-059: the enemies alive at the checkpoint, where they stood and as hurt, back in their groups; and the spawner as
   * it was, so what had been sent stays sent and what was queued still comes. Their minds start fresh: what each
   * knew of the squad is not kept. Returns whether the spawner was restored.
   */
  private restoreEnemies(saved: { seconds?: number; enemies?: EnemyCheckpoint[]; spawner?: SpawnerCheckpoint }): boolean {
    const spawner = this.spawnerValue;
    if (!spawner || !saved.spawner) return false;
    const remap = new Map<number, number>();
    for (const e of saved.enemies ?? []) {
      const group = e.group === null ? undefined : spawner.sessionGroupOf(e.group);
      const restoredPosture = e.posture ? structuredClone(e.posture) : null;
      if (restoredPosture?.patrol) restoredPosture.patrol.active = false;
      const netId = this.spawnEnemy(e.archetype, {
        x: e.x,
        y: e.y,
        z: e.z,
        yaw: e.yaw,
        faction: e.faction,
        ...(e.spawnId === undefined ? {} : { spawnId: e.spawnId }),
        inactive: e.inactive ?? false,
        captive: e.captive ?? false,
        ...(restoredPosture ? { posture: restoredPosture } : {}),
        ...(group !== undefined ? { group } : {}),
      });
      if (netId === null) continue;
      const enemy = this.enemyList.find((x) => x.netId === netId)!;
      if (enemy.def.friendly && e.escortOrder) this.escortOrder = structuredClone(e.escortOrder);
      enemy.health.current = Math.min(e.health, enemy.health.max);
      enemy.weaponState.ammo = e.ammo;
      enemy.pouch = [...e.pouch];
      // U-069: a tank goes on from where it was: its place on the road, its heading, its turret and its next shell.
      if (e.vehicle && enemy.def.vehicle) {
        enemy.drive =
          e.vehicle.path.length > 0
            ? {
                path: e.vehicle.path.map((p) => ({ ...p })),
                next: e.vehicle.next,
                heading: e.vehicle.heading,
                phase: e.vehicle.phase,
                origin: e.vehicle.origin ? { ...e.vehicle.origin } : null,
                withdrawing: e.vehicle.withdrawing,
              }
            : null;
        enemy.turretYaw = e.vehicle.turretYaw;
        enemy.cannonReadyAt = this.nowMs / 1000 + e.vehicle.cannonIn;
      }
      remap.set(e.netId, netId);
    }
    spawner.restore(saved.spawner, remap);
    // The mission clock goes on from the checkpoint, so the times the spawner and the script kept still mean something.
    if (saved.seconds !== undefined) this.missionStartTick = this.currentTick - Math.round(saved.seconds / TICK_SECONDS);
    return true;
  }

  /** U-060: the saved checkpoint's world as the campaign file keeps it, or null for a checkpoint that has none. */
  private checkpointWorldOf(saved: NonNullable<Session['missionCheckpointState']>): CheckpointWorld | null {
    if (saved.seconds === undefined || !saved.slots || !saved.ground || !saved.enemies || !saved.placed) return null;
    return {
      version: CHECKPOINT_WORLD_VERSION,
      seconds: saved.seconds,
      slots: saved.slots,
      ground: saved.ground,
      enemies: saved.enemies,
      spawner: saved.spawner ?? null,
      placed: saved.placed,
      ...(saved.caches === undefined ? {} : { caches: saved.caches }),
    };
  }

  /** T-4.23: checkpoint/mission-end persistence; never called from the tick hot path otherwise. */
  private persistCampaign(): void {
    const state = this.campaignSnapshot();
    if (state) this.campaignSave?.(state);
  }

  /** The campaign file as this room would save it now, or null for a room with no campaign. */
  private campaignSnapshot(): CampaignState | null {
    if (!this.campaignSave) return null;
    // Mission select must retain the refused checkpoint and both pools byte-for-byte as data.
    if (this.incompatibleCampaign) return structuredClone(this.incompatibleCampaign);
    const saved = this.missionCheckpointState;
    const run = this.missionRun;
    const checkpoint = saved && this.missionId
      ? {
          mission: this.missionId,
          ...(saved.mapRevision === undefined ? {} : { mapRevision: saved.mapRevision }),
          ...(this.missionStartState ? { missionStart: structuredClone(this.missionStartState) } : {}),
          ...(this.runKind === 'replay' ? { run: 'replay' as const } : {}),
          objective: run?.checkpoint ?? 0,
          elapsedTicks: run?.checkpointElapsed ?? 0,
          done: [...(run?.checkpointDoneList ?? [])],
          spawns: saved.spawns.map((point) => ({ ...point })),
          completedGroups: [...saved.completedGroups],
          event: saved.event,
          world: this.checkpointWorldOf(saved),
        }
      : this.carriedCheckpoint;
    // U-061: prisoners are saved as they stood at the checkpoint, or as they stand when the mission is won; a failed attempt's captures are undone by the retry and so are not kept.
    const held = this.missionRun?.current.state === 'complete' ? this.capturedList() : (saved?.captured ?? this.capturedAtStart);
    // U-089: this run's prisoners go in this run's pool; the other pool is written as it was loaded.
    const campaignRun = this.runKind === 'campaign';
    const soldiers = this.campaignSoldiers.map((saved, slot) => {
      let soldier = saved;
      const classId = this.classSlots[slot] || soldier.classId;
      // U-077: a won mission's end loadout is the campaign's; a replay's only if the campaign keeps it. Until then, the loadout it began with.
      const kept = this.completionLoadout && (campaignRun || this.campaignDef.replayKeepsLoadout) ? this.completionLoadout[slot] : undefined;
      if (kept) soldier = { ...soldier, loadout: kept };
      if (!campaignRun) return { ...soldier, classId };
      const { captured: _captured, prisoner: _prisoner, ...rest } = soldier;
      const prisoner = held.find((c) => c.slot === slot);
      return { ...rest, classId, ...(prisoner ? { captured: true, prisoner: { ...prisoner.at } } : {}) };
    });
    const replayPrisoners = (campaignRun ? this.replayPoolAtLoad : held).map((p) => ({ slot: p.slot, at: { ...p.at } }));
    return {
      formatVersion: 1,
      world: this.world.id,
      completedMissions: [...this.campaignCompletedMissions],
      checkpoint,
      soldiers,
      ...(this.runKind === 'replay' ? { run: 'replay' as const } : {}),
      ...(replayPrisoners.length > 0 ? { replayPrisoners } : {}),
    };
  }

  /**
   * U-090: who may choose the next run: the host, the lowest-numbered seated human (design doc Q2: the host, not
   * slot 0 as such; the same rule as who commands the bots, U-025). Stable across a handoff, when everyone rejoins in
   * no particular order, where "whoever created the room" would go to whoever reconnects first. -1 when nobody is seated.
   */
  private hostSlot(): number {
    return this.slots.findIndex((s) => !s.isBot && s.connection !== null);
  }

  /** U-090: what the host may choose now (U-078: also while the mission is on), or null in a room with no campaign to move through. */
  private runOffer(): Extract<Message, { kind: 'RunOffer' }> | null {
    const state = this.missionRun?.current.state;
    if (this.handedOff || !this.campaignSave || !this.missionId || (!this.roomStarted && !this.incompatibleCampaign) || (state === undefined && !this.incompatibleCampaign)) return null;
    const options = runOptions(this.campaignCompletedMissions, this.campaignDef);
    // U-078: while the mission is on, the offer is the host's way out: the in-mission menu's "choose another mission".
    return { kind: 'RunOffer', mission: this.missionId, result: state === 'complete' ? 'complete' : state === 'failed' ? 'failed' : 'progress', host: Math.max(0, this.hostSlot()), campaign: options.campaign ?? '', replay: options.replay };
  }

  /** U-090: tell everyone what the host may choose, once per ending (and again if the host changes). */
  private broadcastRunOffer(): void {
    const offer = this.runOffer();
    const key = offer ? `${offer.result}:${this.missionRun?.current.attempt}:${offer.host}` : '';
    if (key === this.lastOfferKey) return;
    this.lastOfferKey = key;
    if (!offer) return;
    for (const c of this.connections) if (c.state === 'active') c.send(offer);
  }

  private restoreGate(): Extract<Message, { kind: 'RestoreGate' }> {
    return { kind: 'RestoreGate', choice: this.incompatibleCampaign && this.missionId ? {
      mission: this.missionId,
      host: Math.max(0, this.hostSlot()),
      restart: this.capturedAtStart.length > 0 ? 'prisoner-placement' : this.missionStartState ? 'original' : 'legacy',
    } : null };
  }

  private broadcastRestoreGate(): void {
    const gate = this.restoreGate();
    const key = gate.choice ? JSON.stringify(gate.choice) : '';
    if (key === this.lastRestoreGateKey) return;
    this.lastRestoreGateKey = key;
    for (const c of this.connections) if (c.state === 'active') c.send(gate);
  }

  private restartIncompatibleMission(): void {
    if (!this.incompatibleCampaign || this.capturedAtStart.length > 0) return;
    this.incompatibleCampaign = null;
    this.roomStarted = !this.roomLobbyEnabled;
    this.restartMission();
    if (!this.missionStartState) this.captureMissionStart();
    // A lobby keeps ready-up. Save a current basic start now; fresh encounter initialization waits for ready-up.
    if (!this.roomStarted) {
      this.missionCheckpointState = {
        mapRevision: this.world.mapRevision ?? 1,
        spawns: this.slots.map((slot) => ({ x: slot.state.x, y: slot.state.y, z: slot.state.z })),
        completedGroups: [], event: null, captured: [],
      };
      this.persistCampaign();
    } else this.captureMissionCheckpoint();
    this.broadcastRestoreGate();
    this.broadcastRoomState();
  }

  /**
   * U-090: the host's choice. Only the host, only once the mission is over, only what was offered (never a mission
   * beyond the newest). Choosing the mission just failed as the same kind of run is the existing retry; anything else
   * writes the new world and kind into the campaign file, tells the room, and retires it: the clients rejoin the
   * same code and a room is built from the file.
   */
  private applyRunChoice(conn: ServerConnection, msg: Extract<Message, { kind: 'RoomCommand' }>): void {
    const slot = this.slots.find((candidate) => candidate.connection === conn && !candidate.isBot);
    const offer = this.runOffer();
    if (!slot || !offer || slot.index !== this.hostSlot()) return;
    const run: RunKind = msg.run === 'replay' ? 'replay' : 'campaign';
    const mission = msg.mission ?? '';
    if (!isOffered(run, mission, this.campaignCompletedMissions, this.campaignDef)) return;
    if (mission === this.missionId && run === this.runKind) {
      if (this.incompatibleCampaign) { this.restartIncompatibleMission(); return; }
      // The mission just failed: the existing retry. While it is on, or after a win: this is where we are.
      if (offer.result === 'failed') this.retryMission();
      return;
    }
    this.handOff(mission, run);
  }

  private handOff(mission: string, run: RunKind): void {
    const state = this.campaignSnapshot();
    if (!state || !this.campaignSave) return;
    // U-078: the checkpoint of the run being left is kept, tagged with its mission and kind, for a retry of that run;
    // leaving is not a completion (`completedMissions` is as the snapshot has it).
    const { run: _was, ...rest } = state;
    this.campaignSave({ ...rest, world: mission, ...(run === 'replay' ? { run } : {}) });
    this.handedOff = true;
    const handoff: Message = { kind: 'Handoff', mission, run };
    for (const c of this.connections) if (c.state === 'active') c.send(handoff);
    this.onHandoff?.();
    this.close('moving to the next mission');
  }

  private broadcastMission(): void {
    if (!this.missionRun) return;
    const msg = { kind: 'Mission', ...this.missionRun.current } as const;
    for (const c of this.connections) if (c.state === 'active') c.send(msg);
    this.broadcastRunOffer();
    // T-4.28: the scoreboard's clock and objectives move with the state and the objective, not with every tick of progress.
    const key = `${msg.state}:${msg.objective}:${this.missionRun.doneCount}`;
    if (key !== this.lastStatsKey) {
      this.lastStatsKey = key;
      this.broadcastStats();
    }
  }

  /** T-4.28: the scoreboard as data — six rows whole, the mission clock, the objectives done. */
  get scoreboard(): Extract<Message, { kind: 'Stats' }> {
    const view = this.missionRun?.current ?? null;
    return {
      kind: 'Stats',
      slots: this.slotStats.map((row) => ({ ...row })),
      elapsedTicks: this.missionRun?.elapsed ?? 0,
      objectivesDone: view ? (view.state === 'complete' ? view.objectives : (this.missionRun?.doneCount ?? view.objective)) : 0,
      objectives: view?.objectives ?? 0,
    };
  }

  private bumpStat(slot: number, key: Exclude<keyof SlotStats, 'slot'>): void {
    const row = this.slotStats[slot];
    if (!row) return;
    row[key] += 1;
    this.broadcastStats();
  }

  private sendStats(conn: ServerConnection): void {
    conn.send(this.scoreboard);
  }

  private broadcastStats(): void {
    const msg = this.scoreboard;
    for (const c of this.connections) if (c.state === 'active') c.send(msg);
  }

  private xpPlayer(slotIndex: number): string | null {
    const slot = this.slots[slotIndex];
    if (!slot || slot.isBot || slot.connection?.state !== 'active') return null;
    return slot.connection.playerId || this.localPlayers.get(slotIndex) || null;
  }

  private awardXp(slotIndex: number, event: XpEvent, actor = this.xpPlayer(slotIndex)): void {
    // No mission-end farming, bots, or credit transferred to a new occupant.
    if (this.missionRun && this.missionRun.current.state !== 'progress' && event !== 'objective') return;
    if (actor !== this.xpPlayer(slotIndex)) return;
    if (this.xp.award(slotIndex, actor, event)) this.broadcastProgression();
  }

  private sendProgression(conn: ServerConnection): void {
    conn.send({ kind: 'Progression', soldiers: this.xp.view(this.xpPlayer(conn.slot) ?? '') });
  }

  private broadcastProgression(): void {
    for (const conn of this.connections) if (conn.state === 'active') this.sendProgression(conn);
  }

  /** A seated human asked to start again: failed missions retry their checkpoint; completed missions start over. */
  private requestRestart(conn: ServerConnection, full = false): void {
    const human = this.humanFor(conn);
    if (!human) return;
    if (this.incompatibleCampaign) {
      if (full && human.index === this.hostSlot()) this.restartIncompatibleMission();
      return;
    }
    if (!this.missionRun) return;
    if (this.missionRun.current.state === 'progress') {
      // U-078: mid-mission, the room's host may go back to the last checkpoint or to the start.
      if (!this.campaignSave || human.index !== this.hostSlot()) return;
      if (full) this.restartMission();
      else this.retryMission(true);
      return;
    }
    if (this.missionRun.current.state === 'failed' && !full) this.retryMission();
    else this.restartMission();
  }

  /** Clear transient mission state and restore a fresh squad at the supplied spawn positions. */
  private resetMissionWorld(spawns: readonly { x: number; y: number; z: number }[], completedGroups: readonly string[]): void {
    this.resetSupplies();
    for (const enemy of this.enemyList) {
      this.killEnemy(enemy);
      this.hitboxes.forget(enemy.netId);
    }
    this.enemyList.length = 0;
    this.escortOrder = { kind: 'follow', point: null };
    this.groups.clear();
    // U-010: nobody at the lever, nobody barred from it.
    this.leverUse = null;
    this.leverBarred.clear();
    // U-062: no capture in progress, nobody barred from one.
    this.captureUse.clear();
    this.captureBarred.clear();
    this.captureAnnounced.clear();
    // U-017: the retried world starts with nothing on the ground (its ids are not handed out again).
    this.pickupList.length = 0;
    this.authoredPickups.clear();
    this.projectiles.length = 0;
    // T-4.29: every gun free, cold and belted again.
    for (const gun of this.emplacementList) this.resetEmplacement(gun);
    for (const slot of this.slots) {
      respawn(slot.health);
      this.applyClassHealth(slot);
      const point = spawns[slot.index] ?? this.squadStart(slot.index);
      slot.state = createMoveState(point.x, point.y, point.z);
      slot.queue.length = 0;
      slot.input = idleInput(slot.yaw);
      slot.interactHeld = false;
      slot.interactWasHeld = false;
      slot.mounted = null;
      // U-018: nor through a retry: the class's primary again.
      this.restorePrimary(slot);
      slot.weaponState = createWeaponState(slot.weapon);
      slot.suppression = createSuppression();
      slot.pouch = this.pouchFor(slot.index);
      slot.kits = this.kitsFor(slot.index);
      slot.equipment = this.equipmentFor(slot.index);
      this.applyStartLoadout(slot);
      slot.nextThrowAt = 0;
      this.orders[slot.index] = null;
      this.orderRuns[slot.index] = null;
    }
    this.marks = [];
    this.sensorMarks.clear();
    this.broadcastOrders();
    this.broadcastMarks();
    if (this.roomStarted) this.startEncounter(completedGroups);
  }

  /**
   * U-001: the event script back where a checkpoint left it (or from the
   * start without one), and every group it had sent that the checkpoint did
   * not count beaten sent again, from its first wave, into the fresh spawner
   * `startEncounter` just built. Without this a retry left those groups
   * "sent" to the script and never spawned by the spawner — the garrison
   * gone, and the counterattack waiting on its death for ever.
   */
  private restoreEvents(saved: { completedGroups: readonly string[]; event: EventCheckpoint | null } | null, spawnerRestored = false): void {
    if (!this.eventRun) return;
    if (!saved?.event) {
      this.eventRun.reset();
      return;
    }
    this.eventRun.restore(saved.event);
    // U-059: the spawner already stands as the checkpoint left it: nothing is sent again.
    if (spawnerRestored) return;
    const { sent, stopped } = this.eventRun.groups();
    for (const id of stopped) this.spawnerValue?.stop(id, 0);
    for (const id of sent) if (!saved.completedGroups.includes(id)) this.spawnerValue?.activate(id, 0);
  }

  /**
   * U-026: a seated human taking control of a bot they command — atomically,
   * inside one message, so no tick sees two controllers or none. The soldier
   * they leave is a bot again, under their command; the one they take stops
   * its brain and loses its order, as a join does. Both keep everything they
   * are — position, health, weapon and magazine, pouch, class, the campaign
   * soldier in that slot — because only the controller moves: the connection,
   * its reconnect claim and its player identity. Every bot the human
   * commanded follows them to their new slot. Refused (nothing changes, and
   * nothing is sent) when the session has not started or is paused, when the
   * target is not a bot this human commands (another's, a human's, their own
   * soldier, no slot), or when it is a dropped player's seat still held for
   * their return (T-4.18).
   */
  private applySwitchCharacter(conn: ServerConnection, msg: Extract<Message, { kind: 'SwitchCharacter' }>): void {
    const from = this.slots.find((s) => s.connection === conn && !s.isBot);
    if (from && msg.spectate && msg.slot === ESCORT_SPECTATE_SLOT && this.roomStarted && !this.paused) {
      // U-091: the escorted character is watched, not a slot: no takeover, no command, nothing changes about the seat.
      if (!this.escort()) return;
      this.cancelCommanderSupplies(conn);
      this.spectators.set(conn, ESCORT_SPECTATE_SLOT);
      if (from.mounted) this.dismount(from);
      from.input = idleInput(from.yaw);
      from.queue.length = 0;
      from.interactHeld = false;
      if (!from.brain) this.giveBrain(from);
      conn.send({ kind: 'Spectating', slot: ESCORT_SPECTATE_SLOT });
      if (this.clearSupplyUse(from.index)) this.broadcastSupplyProgress();
      return;
    }
    const to = this.slots[msg.slot];
    if (!from || !to || !this.roomStarted || this.paused) return;
    if (msg.spectate) {
      this.cancelCommanderSupplies(conn);
      this.spectators.set(conn, to.index);
      if (from.mounted) this.dismount(from);
      from.input = idleInput(from.yaw);
      from.queue.length = 0;
      from.interactHeld = false;
      if (!from.brain) this.giveBrain(from);
      conn.send({ kind: 'Spectating', slot: to.index });
      if (this.clearSupplyUse(from.index)) this.broadcastSupplyProgress();
      return;
    }
    if (to === from || !to.isBot || to.captured || (this.spectators.has(conn) ? this.spectators.get(conn) !== to.index : this.commanders[to.index] !== from.index)) return;
    if (to.reservedUntilMs > 0 && to.reservedUntilMs >= this.nowMs) return;
    this.cancelCommanderSupplies(conn);

    // The soldier left behind: a bot again, as on a leave, but claimed by nobody.
    this.clearReviveStateForSlot(from.index);
    if (from.mounted) this.dismount(from);
    from.isBot = true;
    from.connection = null;
    from.resumeToken = '';
    from.reservedUntilMs = 0;
    from.input = idleInput(from.yaw);
    from.interactHeld = false;
    from.heldProjectile = -1;
    from.queue.length = 0;
    if (!from.brain) this.giveBrain(from);

    // The soldier taken: the human's, as on a join, with the client's tick count carried over.
    this.clearReviveStateForSlot(to.index);
    this.takeBrain(to);
    to.isBot = false;
    to.connection = conn;
    to.staleTicks = 0;
    to.newestInputTick = from.newestInputTick;
    to.lastProcessedInputTick = -1;
    to.pendingInputTick = -1;
    to.queue.length = 0;
    to.input = idleInput(to.yaw);
    to.interactHeld = false;
    to.resumeToken = newResumeToken();
    to.reservedUntilMs = 0;
    const local = this.localPlayers.get(from.index);
    this.localPlayers.delete(from.index);
    if (local !== undefined) this.localPlayers.set(to.index, local);
    conn.netId = to.netId;
    conn.slot = to.index;

    // Command follows the human; a spectated bot under another commander changes hands on takeover.
    for (const slot of this.slots) if (this.commanders[slot.index] === from.index) this.commanders[slot.index] = to.index;
    this.commanders[from.index] = to.index;
    this.commanders[to.index] = -1;
    this.spectators.delete(conn);

    const gun = WEAPON_IDS.indexOf(to.weapon.id as (typeof WEAPON_IDS)[number]);
    conn.send({ kind: 'Possessed', netId: to.netId, slot: to.index, resume: to.resumeToken, weapon: gun < 0 ? 0 : gun, ammo: to.weaponState.ammo, pouch: [...to.pouch] });
    this.sendProgression(conn);
    this.broadcastRoster();
    if (this.orders[to.index]) this.endOrder(to.index, 'replaced', 'a human took the slot');
  }

  /** Retry a failed mission from the latest completed-objective checkpoint. */
  retryMission(midMission = false): void {
    if (this.incompatibleCampaign) return;
    const run = this.missionRun;
    if (!run || (run.current.state !== 'failed' && !midMission)) return;
    const saved = this.missionCheckpointState;
    if (!saved && this.world.squadStarts) for (const slot of this.slots) slot.yaw = 0;
    const spawns = saved?.spawns ?? this.slots.map((slot) => {
      const point = this.squadStart(slot.index);
      return { x: point.x, y: point.y, z: point.z };
    });
    this.resetMissionWorld(spawns, saved?.completedGroups ?? []);
    // U-059: a checkpoint still queued was never saved: the retry point was put back to the last one that was.
    this.queuedCheckpoint = null;
    const worldRestored = this.restoreCheckpointWorld(saved);
    // U-061: captures made since the checkpoint are undone; those it had stand.
    this.applyCaptured(saved?.captured ?? this.capturedAtStart);
    this.rescueTarget = null;
    this.rescueEscortTarget = null;
    run.retry();
    this.restoreEvents(saved, worldRestored);
    this.spawnerValue?.initialize();
    this.broadcastMission();
    this.broadcastScriptState();
    this.broadcastSupplies();
  }

  /**
   * Full restart: every enemy and projectile gone, every order and mark with
   * them, every slot alive on its original spawn point, and objective zero.
   */
  restartMission(): void {
    if (this.incompatibleCampaign) return;
    this.xp.restart();
    this.broadcastProgression();
    for (const row of this.slotStats) Object.assign(row, createSlotStats(row.slot));
    this.broadcastStats();
    const spawns = this.slots.map((slot) => {
      if (this.world.squadStarts) slot.yaw = 0;
      const point = this.squadStart(slot.index);
      return { x: point.x, y: point.y, z: point.z };
    });
    this.missionCheckpointState = null;
    this.queuedCheckpoint = null;
    this.resetMissionWorld(spawns, []);
    // U-061: back to the prisoners the mission began with.
    this.applyCaptured(this.capturedAtStart);
    this.rescueTarget = null;
    this.rescueEscortTarget = null;
    this.missionRun?.reset();
    this.eventRun?.reset();
    this.spawnerValue?.initialize();
    this.broadcastMission();
    this.broadcastScriptState();
    this.broadcastSupplies();
  }

  /** T-3.33: the director pacing the encounter, when the session was given one. */
  get director(): Director | null {
    return this.directorValue;
  }

  /** T-3.32: the encounter's spawner, when the session was given one. */
  get spawner(): Spawner | null {
    return this.spawnerValue;
  }

  /** The session as the spawner sees it. */
  private spawnerHost(): SpawnerHost {
    const living = (h: HealthState) => !isDead(h);
    return {
      humanEyes: () =>
        this.slots
          .filter((s) => !s.isBot && living(s.health))
          .map((s) => eyePosition(s.state.x, s.state.y, s.state.z, DEFAULT_MUZZLE_RIG, eyeStance(false, s.state.prone))),
      squadFeet: () => [...this.slots.filter((s) => living(s.health)).map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z })), ...this.enemyList.filter((e) => e.def.friendly && !e.captive && living(e.health)).map((e) => ({ x: e.state.x, y: e.state.y, z: e.state.z }))],
      enemyFeet: () => this.enemyList.filter((e) => living(e.health)).map((e) => ({ x: e.state.x, y: e.state.y, z: e.state.z })),
      isAlive: (netId) => {
        const e = this.enemyList.find((x) => x.netId === netId);
        return e !== undefined && living(e.health);
      },
      spawn: (archetype, at) => this.spawnEnemy(archetype, at),
      release: (netId) => {
        const enemy = this.enemyList.find((e) => e.netId === netId);
        if (!enemy || isDead(enemy.health) || !enemy.inactive) return;
        enemy.inactive = false;
        if (enemy.def.vehicle) enemy.cannonReadyAt = this.nowMs / 1000 + enemy.def.vehicle.cannon.intervalSeconds / 2;
      },
      ground: (p, authoredY) => spawnGround(p, authoredY, this.collisionBoxes, this.moveConfig,
        this.navMesh ? (point) => this.navMesh!.nearestPoint(point) : undefined),
      validateSocket: (socket) => {
        const bounds = socket.combatRegion ? this.boundedRegion(this.encounter!.regions![socket.combatRegion]!) : null;
        if (bounds && bounds.path(socket.feet, socket.feet) === null) throw new Error(`member '${socket.id}': socket outside navigable region`);
        const route = socket.advance ?? socket.patrol?.route;
        if (!route) return;
        if (!this.navMesh) throw new Error(`member '${socket.id}': authored patrol requires a navmesh`);
        for (let i = 0; i < route.length; i++) {
          const p = route[i]!;
          if (!spawnGround(p, p.y, this.collisionBoxes, this.moveConfig, (q) => this.navMesh!.nearestPoint(q))) throw new Error(`member '${socket.id}': patrol point off authored nav floor`);
          if (i === 0) continue;
          for (const [a, b] of socket.advance ? [[route[i - 1]!, p]] : [[route[i - 1]!, p], [p, route[i - 1]!]]) {
            const path = bounds ? bounds.path(a!, b!) : this.navMesh!.path(a!, b!);
            if (completePathLength(path, a!, b!) === null) throw new Error(`member '${socket.id}': incomplete or out-of-region patrol leg ${i}`);
          }
        }
      },
    };
  }

  /** The session as T-4.15's event runner sees it. */
  private eventHost(): EventHost {
    return {
      squadFeet: () => this.slots.filter((s) => !isDead(s.health)).map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z })),
      // U-001: a group down to stragglers long enough counts, so one hidden survivor holds nothing back.
      groupDead: (id) => this.spawnerValue?.broken(id) ?? false,
      spawnGroup: (id, seconds) => this.spawnerValue?.activate(id, seconds) ?? false,
      stopGroup: (id, seconds) => this.spawnerValue?.stop(id, seconds) ?? false,
      objectives: () => {
        const run = this.missionRun;
        if (!run) return null;
        return { state: run.current.state, active: run.openObjectives().filter((o) => !o.done).map((o) => ({ index: o.index, phase: o.phase })) };
      },
      setObjective: (index) => {
        const changed = this.missionRun?.setObjective(index) ?? false;
        if (changed) this.broadcastMission();
        return changed;
      },
      interruptUpload: () => {
        const changed = this.missionRun?.interruptUpload() ?? false;
        if (changed) this.broadcastMission();
        return changed;
      },
      setBlocker: (blocker) => this.setBlocker(blocker),
      message: (text) => {
        const msg: Message = { kind: 'ScriptMessage', text };
        for (const conn of this.connections) if (conn.state === 'active') conn.send(msg);
      },
      callout: (id) => {
        const msg: Message = { kind: 'ScriptCallout', id };
        for (const conn of this.connections) if (conn.state === 'active') conn.send(msg);
      },
      placeLoot: (weapon, ammo, at, yawDeg) => {
        this.placePickupItem((WEAPON_IDS as readonly string[]).indexOf(weapon), ammo, at, degToWire(yawDeg), true);
      },
      spawnVehicle: (vehicle, at, yawDeg, path) => {
        this.spawnEnemy(vehicle, { x: at.x, y: at.y ?? this.moveConfig.groundY, z: at.z, yaw: degToWire(yawDeg), path, authoredHeight: at.y !== undefined || path.some((p) => p.y !== undefined) });
      },
      withdrawVehicles: () => {
        for (const enemy of this.enemyList) if (enemy.drive && !isDead(enemy.health)) withdrawDrive(enemy.drive, enemy.drive.origin?.y !== undefined || enemy.drive.path.some((p) => p.y !== undefined) ? enemy.state : undefined);
      },
    };
  }

  private scriptBlockers(): ScriptBlockerState[] {
    return [...this.blockerStates.values()].map((b) => ({ id: b.id, active: b.active, boxes: b.boxes }));
  }

  /** One blocker changed: collision, nav and every client change together. */
  private setBlocker(blocker: ScriptBlockerState): void {
    this.blockerStates.set(blocker.id, blocker);
    this.collisionBoxes.splice(
      0,
      this.collisionBoxes.length,
      ...this.world.boxes,
      ...[...this.blockerStates.values()].filter((b) => b.active).flatMap((b) => b.boxes),
    );
    this.navMesh?.setBlocker(blocker.id, blocker.boxes, blocker.active);
    this.cover?.invalidateGeometry();
    this.broadcastScriptState();
  }

  private broadcastScriptState(): void {
    const msg: Message = { kind: 'ScriptState', blockers: this.scriptBlockers() };
    for (const conn of this.connections) if (conn.state === 'active') conn.send(msg);
  }

  get enemies(): readonly EnemyEntity[] {
    return this.enemyList;
  }

  /**
   * Put an enemy into the world (T-3.10): a fresh netId from the enemy band,
   * full health from its archetype, and a brain of its own running the
   * archetype's tree. Returns its netId, or null when the session is at
   * `MAX_ENEMIES` or has spent the band. It is stepped, recorded and sent from
   * the next tick on.
   */
  /**
   * This session's projectile rows, indexed like PROJECTILE_IDS: the shipped
   * data unless the QA page has retuned one (`tuneProjectile`). Per session,
   * so tuning the in-page range never changes what a host's rooms throw.
   */
  private readonly projectileDefs: ProjectileDef[] = PROJECTILE_IDS.map((id) => ({ ...getProjectile(id) }));

  /** A full load-out of every projectile, as this session's rows say it is carried. */
  /** T-4.27: the class a slot plays, as the room and the roster carry it. */
  classOf(slot: number): string {
    return this.classSlots[slot] ?? '';
  }

  /** T-4.27: what a slot carries and its health, for a test to read. */
  loadoutOf(slot: number): { weapon: string; primary: string | null; secondary: string | null; ammo: number; pouch: number[]; health: number; maxHealth: number } {
    const s = this.slots[slot];
    if (!s) throw new Error(`no slot ${slot}`);
    return { weapon: s.weapon.id, primary: s.primary, secondary: s.secondary, ammo: s.weaponState.ammo, pouch: [...s.pouch], health: s.health.current, maxHealth: s.health.max };
  }

  /**
   * U-021: who plays what is the slot's: a character is bound to its slot for
   * good (`assignClasses`), whoever or whatever occupies it, so a join, a
   * leave, a drop and a resume never change it. Only the first call, which
   * sets each slot's character, applies a loadout.
   */
  private reassignClasses(): void {
    const assigned = assignClasses();
    for (const slot of this.slots) {
      const id = assigned[slot.index] ?? '';
      if (this.classSlots[slot.index] === id) continue;
      this.classSlots[slot.index] = id;
      this.applyLoadout(slot);
    }
  }

  /** U-021: whether the slot's character may aim down the sight; the support may not, whatever its page sends. */
  private mayAim(slot: Slot): boolean {
    if (this.classLoadouts !== 'class') return true;
    return classById(this.classSlots[slot.index] ?? '')?.ads ?? true;
  }

  /** The class's first gun in hand, its pouch, and its health. */
  private applyLoadout(slot: Slot): void {
    if (this.classLoadouts !== 'class') return;
    const def = classById(this.classSlots[slot.index] ?? '');
    if (!def) return;
    const gun = def.guns[0] ?? slot.weapon.id;
    if (slot.weapon.id !== gun) {
      slot.weapon = getWeapon(gun);
      slot.weaponState = createWeaponState(slot.weapon);
    }
    // U-018: a new class is its own primary again.
    slot.primary = def.guns.find((g) => g !== 'sidearm') ?? gun;
    slot.secondary = classPrimaries(def)[1] ?? null;
    slot.noPistol = false;
    slot.stowed.clear();
    slot.pickedUp = false;
    slot.pouch = [...def.pouch];
    slot.kits = def.healthKits;
    slot.equipment = def.equipment === null ? -1 : (PROJECTILE_IDS as readonly string[]).indexOf(def.equipment);
    slot.heldProjectile = -1;
    this.applyClassHealth(slot);
  }

  /** Full to the class's health before the mission and on a respawn; mid-mission a switch only caps what is left. */
  private applyClassHealth(slot: Slot): void {
    if (this.classLoadouts !== 'class') return;
    const def = classById(this.classSlots[slot.index] ?? '');
    if (!def) return;
    slot.health.max = def.health;
    if (!this.roomStarted || slot.health.current > def.health) slot.health.current = def.health;
  }

  /**
   * Put a slot's pouch back to what it spawns with (U-024): the in-page
   * range's reset key, which is explicitly the range's and not a hosted
   * room's. The count reaches the page on the next snapshot.
   */
  refillPouch(slot: number): void {
    const s = this.slots[slot];
    if (!s) return;
    s.pouch = this.pouchFor(slot);
    s.kits = this.kitsFor(slot);
    s.equipment = this.equipmentFor(slot);
    s.nextThrowAt = 0;
  }

  /** A slot's pouch at spawn: its class's, or the data's full pouch on a free session. */
  private pouchFor(slot: number): number[] {
    if (this.classLoadouts !== 'class') return this.fullPouch();
    const def = classById(this.classSlots[slot] ?? '');
    return def ? [...def.pouch] : this.fullPouch();
  }

  /** U-048: a slot's slot-5 equipment at spawn: its character's, or the first non-frag pouch item on a free session. */
  private equipmentFor(slot: number): number {
    if (this.classLoadouts !== 'class') return FIRST_EQUIPMENT;
    const def = classById(this.classSlots[slot] ?? '');
    return def && def.equipment !== null ? (PROJECTILE_IDS as readonly string[]).indexOf(def.equipment) : -1;
  }

  /** U-047: a slot's health kits at spawn: its character's, or 3 on a free session. */
  private kitsFor(slot: number): number {
    if (this.classLoadouts !== 'class') return 3;
    return classById(this.classSlots[slot] ?? '')?.healthKits ?? 3;
  }

  private fullPouch(): number[] {
    return this.projectileDefs.map((def) => def.carried);
  }

  /** The projectile row a wire index throws in this session, or null. */
  projectileDef(index: number): Readonly<ProjectileDef> | null {
    return this.projectileDefs[index] ?? null;
  }

  /**
   * Retune one projectile for this session from now on (the in-page
   * projectile panel). Out-of-range indices are ignored. What is already in
   * the air flies the row it was thrown with.
   */
  tuneProjectile(index: number, def: Readonly<ProjectileDef>): void {
    if (index < 0 || index >= this.projectileDefs.length) return;
    this.projectileDefs[index] = { ...def };
  }

  /** U-075: the order the squad last gave the escorted character (all of them, there is one at a time in practice). */
  private escortOrder: EscortOrder = { kind: 'follow', point: null };

  /** U-091: the escorted character, or undefined when the mission has none. */
  private escort(): EnemyEntity | undefined {
    return this.enemyList.find((e) => e.def.friendly);
  }

  private escortView(enemy: EnemyEntity): EscortView {
    return {
      order: () => enemy.captive ? { kind: 'stay', point: null } : this.escortOrder,
      nearestSquad: () => {
        let best: { x: number; y: number; z: number } | null = null;
        let bestD = Infinity;
        for (const slot of this.slots) {
          if (isDead(slot.health)) continue;
          // U-123: nearest in three dimensions, so the one on his own floor beats one straight overhead.
          const d = (slot.state.x - enemy.state.x) ** 2 + (slot.state.y - enemy.state.y) ** 2 + (slot.state.z - enemy.state.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = slot.state;
          }
        }
        return best;
      },
    };
  }

  /**
   * U-075: an order addressed to the whole squad also reaches the escorted character: hold is stay, move is go to the
   * point, regroup is follow. Others (attack, revive...) mean nothing to an unarmed civilian.
   */
  private orderEscort(msg: Omit<Extract<Message, { kind: 'Order' }>, 'kind'>, point: OrderPoint | null): void {
    if (msg.address.to !== 'all') return;
    if (msg.order === 'hold') this.escortOrder = { kind: 'stay', point: null };
    else if (msg.order === 'move' && point) this.escortOrder = { kind: 'go', point: { ...point } };
    else if (msg.order === 'regroup') this.escortOrder = { kind: 'follow', point: null };
  }

  private boundedRegion(volumes: NavigationRegion): BoundedRegion {
    if (!this.navMesh) throw new Error('authored combat regions require a navmesh');
    const key = JSON.stringify(volumes);
    let bounds = this.boundedRegions.get(key);
    if (!bounds) { bounds = new BoundedRegion(volumes, this.navMesh); this.boundedRegions.set(key, bounds); }
    return bounds;
  }

  private enemyInteractionGoal(enemy: EnemyEntity, at: NavPoint): NavPoint | null {
    if (!enemy.bounds) return at;
    const near = this.navMesh!.nearestPoint(at);
    if (!near || Math.hypot(near.point.x - at.x, near.point.z - at.z) > SPAWN_ON_MESH_M) return null;
    return enemy.canReach(near.point) ? near.point : null;
  }

  private enemyPath(enemy: EnemyEntity, to: NavPoint, searchM?: number, pathOf?: RegionPath): NavPath | null {
    return enemy.bounds ? enemy.bounds.path(enemy.state, to, searchM, pathOf) : (pathOf ? pathOf(enemy.state, to, searchM) : this.navMesh?.path(enemy.state, to, searchM) ?? null);
  }

  spawnEnemy(archetype: string, at: EnemySpawn): number | null {
    const def = getEnemy(archetype);
    if (this.enemyList.length >= MAX_ENEMIES || this.nextEnemyNetId >= ENEMY_NET_ID_LIMIT) return null;
    if (at.spawnId !== undefined && this.enemyList.some((e) => e.spawnId === at.spawnId)) throw new Error(`duplicate enemy spawnId '${at.spawnId}'`);
    const yaw = at.yaw ?? 0;
    const authoredHeight = at.authoredHeight ?? (Math.abs(at.y - this.moveConfig.groundY) > SPAWN_ON_MESH_M || at.path?.some((p) => p.y !== undefined) === true);
    const enemy: EnemyEntity = {
      netId: this.nextEnemyNetId++,
      inactive: at.inactive ?? false,
      captive: at.captive ?? false,
      def,
      archetype: enemyIndex(def.id),
      faction: at.faction ?? (def.friendly ? ESCORT_FACTION : 0),
      state: createMoveState(at.x, at.y, at.z),
      yaw,
      pitch: 0,
      turretYaw: yaw,
      drive: def.vehicle && at.path && at.path.length > 0 ? createDrive(at.path, yaw, { x: at.x, z: at.z, ...(authoredHeight ? { y: at.y } : {}) }) : null,
      // The first shell waits half an interval, so a tank that has just come into view is not already firing.
      cannonReadyAt: this.nowMs / 1000 + (def.vehicle ? def.vehicle.cannon.intervalSeconds / 2 : 0),
      tell: null,
      departed: false,
      input: idleInput(yaw),
      health: { current: def.health, max: def.health, downedAt: null, diedAt: null },
      brain: null,
      follower: null,
      pathStatus: 'idle',
      memory: createTargetMemory(),
      awareness: new Map(),
      target: null,
      weapon: getWeapon(def.weapon),
      weaponState: createWeaponState(getWeapon(def.weapon)),
      aim: null,
      speed: 0,
      suppression: createSuppression(),
      lastDamagedAt: -Infinity,
      combat: this.combatWorld,
      group: at.group === undefined ? null : this.groupFor(at.group),
      pouch: this.fullPouch(),
      nextThrowAt: 0,
      still: createStillWatch(),
      deployedAt: null,
      dropped: false,
      mounted: null,
      burst: { rounds: 0, pauseUntil: 0 },
      bounds: at.posture?.region ? this.boundedRegion(at.posture.region) : null,
      canReach: (to) => !enemy.bounds || enemy.bounds.path(enemy.state, to) !== null,
      ...(at.posture?.region ? { movementCost: (from: NavPoint, to: NavPoint) => completePathLength(enemy.bounds!.path(from, to), from, to) } : {}),
      spawnId: at.spawnId ?? null,
      posture: at.posture ?? null,
      coverNear: () => {
        // U-011: the lever's user, fired on, takes cover where it is — not back inside its garrison's area, through the fire.
        if (this.leverUse?.enemy === enemy) return null;
        const area = at.posture?.kind === 'garrison' ? at.posture.area : null;
        return area ? { x: area.x, z: area.z, withinM: area.radius } : null;
      },
      leverJob: () => {
        const lever = this.leverUse?.enemy === enemy ? this.activeLever() : null;
        const goal = lever ? this.enemyInteractionGoal(enemy, lever.at) : null;
        return lever && goal ? { ...goal, reachM: lever.reachM } : null;
      },
      captureJob: () => {
        for (const [index, job] of this.captureUse) {
          if (job.enemy !== enemy) continue;
          const held = this.slots[index];
          return held ? { x: held.state.x, y: held.state.y, z: held.state.z, reachM: DAMAGE.capture.reachM } : null;
        }
        return null;
      },
    };
    enemy.group?.add(enemy.netId);
    if (def.friendly) enemy.escort = this.escortView(enemy);
    enemy.brain = new Brain(enemy, at.tree ?? this.enemyTree(def.tree));
    this.enemyList.push(enemy);
    // U-066: a tank is shot at in its own shape — a hull and a turret — not as a soldier.
    if (def.vehicle) this.hitboxes.setShape(enemy.netId, vehicleHitbox(def.vehicle));
    return enemy.netId;
  }

  /** T-3.25: the squad's fireteams following their leads, fed every tick. */
  private readonly formation: Formation;
  /** T-3.26: the squad's side of the world, as a friendly bot's leaves read it. */
  private readonly squadCombat: CombatWorld;
  /**
   * T-3.26: bot slots run a tree that fights (anything but the default idle
   * one), so the session perceives for them and applies their hands. With the
   * default a bot slot is exactly what it always was.
   */
  private readonly botsDriven: boolean;
  /** Rounds fired by a slot that hurt a slot (T-3.26): what the squad scenario holds at zero. */
  private friendlyHitCount = 0;
  /** When each enemy last fired, ticks: a friendly bot sees a firing soldier sooner, as an enemy does. */
  private readonly enemyFiredTick = new Map<number, number>();

  get friendlyHits(): number {
    return this.friendlyHitCount;
  }

  /**
   * T-3.28: whom a bot fights. The enemy its attack order names, while that
   * one lives; else a marked enemy it knows of, the nearest; else its own
   * choice by memory. A mark outranks nearness: every bot takes a marked
   * enemy over a closer unmarked one.
   */
  private botTarget(slot: Slot, nowSeconds: number): number | null {
    const order = this.orders[slot.index];
    if (order?.order === 'attack' && order.target !== null && this.enemyList.some((e) => e.netId === order.target && !isDead(e.health))) return order.target;
    const aggression = this.aggressionFor(slot.index);
    if (aggression === 'hold-fire') return null;
    if (aggression === 'defensive') return chooseTarget({ entries: new Map([...slot.memory.entries].filter(([, entry]) => entry.visible && entry.threatAt !== null && nowSeconds - entry.threatAt <= MEMORY.threatSeconds)) }, slot.state, nowSeconds);
    // U-062: someone taking a squadmate prisoner, if the bot knows of them, comes before any other target.
    let taker: number | null = null;
    let takerD = Infinity;
    for (const job of this.captureUse.values()) {
      if (job.seconds <= 0) continue;
      const entry = slot.memory.entries.get(job.enemy.netId);
      if (!entry) continue;
      const d = (entry.x - slot.state.x) ** 2 + (entry.z - slot.state.z) ** 2;
      if (d < takerD) {
        takerD = d;
        taker = job.enemy.netId;
      }
    }
    if (taker !== null) return taker;
    let best: number | null = null;
    let bestD = Infinity;
    for (const mark of this.marks) {
      if (mark.target === null) continue;
      const entry = slot.memory.entries.get(mark.target);
      if (!entry) continue;
      const d = (entry.x - slot.state.x) ** 2 + (entry.z - slot.state.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = mark.target;
      }
    }
    return best ?? chooseTarget(slot.memory, slot.state, nowSeconds);
  }

  /** T-3.26: the nearest downed squadmate within `bot.reviveSeekM` of a slot that nobody else is reviving. */
  private downedNear(index: number): DownedMate | null {
    const me = this.slots[index];
    if (!me || !isAlive(me.health)) return null;
    let best: DownedMate | null = null;
    let bestD = SQUAD_CONFIG.bot.reviveSeekM;
    let bestTaken = false;
    for (const s of this.slots) {
      if (s === me || !isDowned(s.health)) continue;
      if (s.reviveBySlot >= 0 && s.reviveBySlot !== index) continue;
      const d = Math.sqrt((s.state.x - me.state.x) ** 2 + (s.state.z - me.state.z) ** 2);
      // U-062: a squadmate being taken prisoner is a priority, from wherever the bot is, over any other revive.
      const taken = (this.captureUse.get(s.index)?.seconds ?? 0) > 0;
      const better = taken ? !bestTaken || d < bestD : !bestTaken && d <= bestD;
      if (better) {
        bestD = d;
        bestTaken = taken;
        best = { index: s.index, x: s.state.x, y: s.state.y, z: s.state.z, reachM: DAMAGE.downed.reviveRangeM };
      }
    }
    return best;
  }

  /**
   * U-053: the nearest hurt (alive, not downed) squadmate below `bot.kitBelowFraction` of their health within
   * `bot.reviveSeekM` of a bot slot that still has health kits, that no one else is already healing.
   */
  private hurtNear(index: number): DownedMate | null {
    const me = this.slots[index];
    if (!me || !isAlive(me.health) || me.kits <= 0) return null;
    let best: DownedMate | null = null;
    let bestD = SQUAD_CONFIG.bot.reviveSeekM;
    for (const s of this.slots) {
      if (s === me || !isAlive(s.health) || s.mounted) continue;
      if (s.health.current >= s.health.max * SQUAD_CONFIG.bot.kitBelowFraction) continue;
      if (this.slots.some((o) => o !== me && o.kitTarget === s.index)) continue;
      const d = Math.sqrt((s.state.x - me.state.x) ** 2 + (s.state.z - me.state.z) ** 2);
      if (d <= bestD) {
        bestD = d;
        best = { index: s.index, x: s.state.x, y: s.state.y, z: s.state.z, reachM: DAMAGE.kit.reachM };
      }
    }
    return best;
  }

  /** Where a slot's formation puts it this tick, or null (a human, a lead, nowhere to stand): for tests and the page. */
  formationPlace(slotIndex: number): FormationPlace | null {
    return this.formation.place(slotIndex);
  }

  /** The slot a slot follows: its fireteam's lead (T-3.25). */
  leadFor(slotIndex: number): number {
    return this.formation.leadFor(slotIndex);
  }

  /** T-3.21: enemy groups by the id they were spawned with. */
  private readonly groups = new Map<number, EnemyGroup>();

  private groupFor(id: number): EnemyGroup {
    let group = this.groups.get(id);
    if (!group) {
      group = new EnemyGroup(id);
      this.groups.set(id, group);
    }
    return group;
  }

  /** A group by id, for tests and the scenario. */
  group(id: number): EnemyGroup | null {
    return this.groups.get(id) ?? null;
  }

  /**
   * Groups think at the brains' 10 Hz, on the tick before the first phase,
   * so every member thinks on what its group decided (T-3.21).
   */
  private thinkGroups(nowSeconds: number): void {
    if (this.groups.size === 0 || this.currentTick % BRAIN_PERIOD_TICKS !== 0) return;
    const world = { cover: this.cover, boxes: this.collisionBoxes, mesh: this.navMesh };
    for (const group of this.groups.values()) {
      const members = group.members.flatMap((id) => {
        const e = this.enemyList.find((x) => x.netId === id);
        return e ? [{ netId: e.netId, state: e.state, alive: !e.inactive && !isDead(e.health), memory: e.memory, target: e.target, prefers: e.def.prefersRole, ...(e.bounds ? { canReach: (p: NavPoint) => e.canReach(p), pathWithin: (from: NavPoint, to: NavPoint, pathOf?: RegionPath) => e.bounds!.path(from, to, 4, pathOf) } : {}) }] : [];
      });
      group.think(members, world, nowSeconds);
    }
  }

  private enemyTree(id: string): BrainTree {
    let tree = this.enemyTrees.get(id);
    if (!tree) {
      tree = buildTree(id, createBrainRegistry());
      this.enemyTrees.set(id, tree);
    }
    return tree;
  }

  /**
   * An enemy has died: its brain stops and it produces no more input, from
   * this moment. Called wherever the killing damage lands — a shot between
   * ticks or a blast inside one — so no later step can move it.
   */
  private killEnemy(enemy: EnemyEntity): void {
    // U-017: a death — not a retry clearing the living — leaves its firearm, once.
    if (isDead(enemy.health) && !enemy.dropped) {
      enemy.dropped = true;
      this.dropWeapon(enemy);
    }
    if (enemy.mounted) this.dismountEnemy(enemy);
    this.cover?.release(enemy.netId);
    enemy.brain?.stop();
    enemy.follower = null;
    enemy.input = idleInput(enemy.yaw);
  }

  /**
   * U-018: whether a soldier carries `gun`: on a class loadout, the class's
   * guns with its primary the one in hand now (a picked-up gun replaces the
   * class's first); on a free loadout (the range), anything, and a picked-up
   * gun too.
   */
  private carries(slot: Slot, gun: string): boolean {
    if (gun === 'knife') return true;
    if (gun === slot.primary || gun === slot.secondary) return true;
    if (this.classLoadouts !== 'class') return true;
    const def = classById(this.classSlots[slot.index] ?? '');
    if (!def) return true;
    // Anything else on the class's list is the pistol; its other guns are the primary and the second primary, held above.
    // With a second primary in hand-reach there is no pistol (Preach, like the support): it goes with the second gun.
    return gun === 'sidearm' && def.guns.includes('sidearm') && slot.secondary === null && !slot.noPistol;
  }

  /**
   * U-022: put the gun in hand away and take `gun` out. A gun keeps its
   * magazine and clocks while away (a reload in progress is cancelled, since
   * the hands left it), so a soldier with two primaries has two magazines.
   */
  private drawGun(slot: Slot, gun: string): void {
    if (gun === slot.weapon.id) return;
    const nowSeconds = this.nowMs / 1000;
    finishReload(slot.weapon, slot.weaponState, nowSeconds);
    slot.weaponState.reloadEndsAt = 0;
    slot.stowed.set(slot.weapon.id, slot.weaponState);
    slot.weapon = getWeapon(gun);
    slot.weaponState = slot.stowed.get(gun) ?? createWeaponState(slot.weapon);
    slot.stowed.delete(gun);
  }

  /** U-018: the class's own primary, or the carbine on a free loadout. */
  private classPrimary(slot: Slot): string {
    const def = this.classLoadouts === 'class' ? classById(this.classSlots[slot.index] ?? '') : undefined;
    return def?.guns.find((g) => g !== 'sidearm') ?? WEAPON_IDS[0];
  }

  /**
   * U-018: a respawn or a retry — a picked-up gun does not come back with the
   * soldier: the class's primary does, in hand if the primary was.
   */
  private restorePrimary(slot: Slot): void {
    // Every gun comes back fresh with the soldier (U-022).
    slot.stowed.clear();
    slot.cook = null;
    if (!slot.pickedUp) return;
    const def = this.classLoadouts === 'class' ? classById(this.classSlots[slot.index] ?? '') : undefined;
    // U-029: a soldier who put every primary down gets the class's back in hand.
    const dropped = slot.primary === null;
    slot.primary = this.classPrimary(slot);
    slot.noPistol = false;
    slot.secondary = def ? (classPrimaries(def)[1] ?? null) : null;
    slot.pickedUp = false;
    // If the gun in hand was one that only a pickup had given, the primary is drawn instead.
    if (!this.carries(slot, slot.weapon.id)) {
      slot.weapon = getWeapon(slot.primary);
      slot.weaponState = createWeaponState(slot.weapon);
    } else if (dropped || slot.weapon.id === slot.primary) {
      slot.weapon = getWeapon(slot.primary);
      slot.weaponState = createWeaponState(slot.weapon);
    }
  }

  /** U-029: a pistol on the ground is taken only by a character whose class lists one, who has put it down and holds one primary at most. */
  private canTakePistol(slot: Slot): boolean {
    if (this.classLoadouts !== 'class') return false;
    const def = classById(this.classSlots[slot.index] ?? '');
    return !!def?.guns.includes('sidearm') && slot.noPistol && slot.secondary === null;
  }

  /** U-048: the slot-5 equipment, all of it, on the ground where the soldier stands; the slot is left empty. */
  private putDownEquipment(slot: Slot): void {
    const item = slot.equipment;
    if (item < 0) return;
    const count = slot.pouch[item] ?? 0;
    slot.pouch[item] = 0;
    slot.equipment = -1;
    if (slot.heldProjectile === item) slot.heldProjectile = -1;
    slot.cook = null;
    if (count > 0) this.placePickupItem(WEAPON_IDS.length + item, count, slot.state, slot.yaw);
  }

  /** U-029: a character whose own gun is left-handed (the slot-4 sniper) — he takes only left-handed guns. */
  private leftHandedShooter(slot: Slot): boolean {
    if (this.classLoadouts !== 'class') return false;
    const def = classById(this.classSlots[slot.index] ?? '');
    const own = def ? classPrimaries(def)[0] : undefined;
    return own !== undefined && getWeapon(own).handedness === 'left';
  }

  /**
   * U-029: G puts the gun in hand on the ground where the soldier stands, with the rounds it has (a reload in
   * progress is cancelled). The other primary, if there is one, becomes the primary and is drawn; else the pistol
   * the class lists, else the knife. Only a primary or the pistol can be put down: the knife stays. The host judges
   * the press; nothing the page sends names a gun or its rounds. Returns whether one was dropped.
   */
  private dropHeld(slot: Slot): boolean {
    if (!isAlive(slot.health) || isDowned(slot.health) || slot.state.vault || slot.mounted) return false;
    // U-048: the equipment in hand goes down whole, its count with it.
    if (slot.equipment >= 0 && slot.heldProjectile === slot.equipment) {
      this.putDownEquipment(slot);
      return true;
    }
    const gun = slot.weapon.id;
    const isPistol = gun === 'sidearm' && this.classLoadouts === 'class' && this.carries(slot, 'sidearm');
    if (gun !== slot.primary && gun !== slot.secondary && !isPistol) return false;
    slot.weaponState.reloadEndsAt = 0;
    this.placePickup(gun, slot.weaponState.ammo, slot.state, slot.yaw);
    if (isPistol) {
      slot.noPistol = true;
    } else if (gun === slot.primary) {
      slot.primary = slot.secondary;
      slot.secondary = null;
    } else {
      slot.secondary = null;
    }
    slot.pickedUp = true;
    const def = this.classLoadouts === 'class' ? classById(this.classSlots[slot.index] ?? '') : undefined;
    const next = slot.primary ?? (def?.guns.includes('sidearm') && !slot.noPistol && slot.secondary === null ? 'sidearm' : 'knife');
    slot.weapon = getWeapon(next);
    slot.weaponState = slot.stowed.get(next) ?? createWeaponState(slot.weapon);
    slot.stowed.delete(next);
    slot.heldProjectile = -1;
    return true;
  }

  /**
   * U-018: a soldier's interact press at a weapon on the ground (not already
   * a revive or a gun). The host judges it, as it does the terminal: alive,
   * not vaulting or mounted, the nearest pickup within `PICKUPS.reachM` of
   * the eye with a clear line to it. Nothing the page sends names a pickup
   * or its rounds — the press is all — so a stale id or a forged magazine
   * has nothing to ride on. Taken whole on one tick: the pickup leaves the
   * ground, its gun becomes the primary, in hand with its rounds, and the
   * primary it replaces goes down in its place as a pickup of its own (with
   * its rounds when it was in hand; a full magazine when it was stowed, as
   * every stowed gun is drawn). Two soldiers pressing on the same tick: the
   * first in slot order takes it and the second finds nothing there.
   * Returns whether it took one.
   */
  private takePickupAt(slot: Slot): boolean {
    if (!isAlive(slot.health) || slot.state.vault || slot.mounted) return false;
    // U-021/U-029, owner 2026-09-27: a left-handed shooter (the slot-4 sniper) takes no gun a squadmate or an enemy
    // left (all right-handed); only a left-handed gun — authored loot, or his own put down — is his to take.
    const lefty = this.leftHandedShooter(slot);
    const eye = soldierEye(slot.state);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [i, p] of this.pickupList.entries()) {
      const at = { x: p.x, y: p.y + PICKUP_AIM_M, z: p.z };
      const d = Math.hypot(eye.x - at.x, eye.y - at.y, eye.z - at.z);
      const isGun = pickupProjectile(p.weapon) < 0;
      if (isGun && WEAPON_IDS[p.weapon] === 'sidearm' && !this.canTakePistol(slot)) continue;
      if (isGun && lefty && !canWield(getWeapon(WEAPON_IDS[p.weapon]!), true)) continue;
      // U-052, owner 2026-09-30: a left-handed gun is the left-handed sniper's alone; nobody else takes one.
      if (isGun && !lefty && getWeapon(WEAPON_IDS[p.weapon]!).handedness === 'left') continue;
      if (d <= PICKUPS.reachM && d < bestD && lineOfSight(eye, at, this.collisionBoxes)) {
        best = i;
        bestD = d;
      }
    }
    if (best < 0) return false;
    const target = this.pickupList[best]!;
    // U-048: a piece of equipment on the ground. A soldier carries one kind in slot 5: taking another puts the first down.
    const item = pickupProjectile(target.weapon);
    if (item >= 0) {
      // Slot 4's frag is never on the ground as equipment; a malformed item is left where it lies.
      if (item === FRAG_INDEX || item >= PROJECTILE_IDS.length) return false;
      this.pickupList.splice(best, 1);
      if (slot.equipment >= 0 && slot.equipment !== item) this.putDownEquipment(slot);
      slot.equipment = item;
      slot.pouch[item] = Math.min(POUCH_COUNT_MAX, (slot.pouch[item] ?? 0) + target.ammo);
      return true;
    }
    const gun = WEAPON_IDS[target.weapon]!;
    if (gun === 'sidearm') {
      // U-029: a pistol put down comes back as the pistol, never as a primary; the gun in hand is put away with its rounds.
      this.pickupList.splice(best, 1);
      finishReload(slot.weapon, slot.weaponState, this.nowMs / 1000);
      slot.weaponState.reloadEndsAt = 0;
      slot.stowed.set(slot.weapon.id, slot.weaponState);
      slot.noPistol = false;
      slot.weapon = getWeapon('sidearm');
      slot.stowed.delete('sidearm');
      slot.weaponState = createWeaponState(slot.weapon);
      slot.weaponState.ammo = Math.min(target.ammo, slot.weapon.magSize);
      slot.heldProjectile = -1;
      return true;
    }
    // U-022: which of the soldier's primaries it becomes. Everyone has one, and takes the gun as it. Preach and the
    // support may carry two: the second is an AR, SMG or shotgun beside a first that is one too — never an LMG, a
    // marksman rifle or a sniper rifle beside another primary.
    let into: 'primary' | 'secondary' = 'primary';
    const def = this.classLoadouts === 'class' ? classById(this.classSlots[slot.index] ?? '') : undefined;
    if (def?.dualPrimary) {
      const eligible = canBeDualPrimary(getWeapon(gun));
      if (gun === slot.primary) into = 'primary';
      else if (gun === slot.secondary) into = 'secondary';
      else if (slot.secondary === null) {
        if (eligible && slot.primary !== null && canBeDualPrimary(getWeapon(slot.primary))) into = 'secondary';
      } else {
        // Both hands' worth are full: an ineligible gun would sit beside a second primary, so it is left where it lies.
        if (!eligible) return false;
        into = slot.weapon.id === slot.secondary ? 'secondary' : 'primary';
      }
    }
    this.pickupList.splice(best, 1);
    const replaced: string | null = into === 'primary' ? slot.primary : slot.secondary;
    const nowSeconds = this.nowMs / 1000;
    if (replaced !== null) {
      // It goes down where the soldier stands, with the rounds it had (in hand or stowed).
      const inHand = slot.weapon.id === replaced;
      const oldAmmo = inHand ? slot.weaponState.ammo : (slot.stowed.get(replaced)?.ammo ?? getWeapon(replaced).magSize);
      slot.stowed.delete(replaced);
      // Every squad gun is on the wire now (U-041), so none vanishes: the LMG, the SMG and the rest go down like a carbine does.
      this.placePickup(replaced, oldAmmo, slot.state, slot.yaw);
    }
    if (slot.weapon.id !== replaced) {
      // The gun in hand is put away, keeping its rounds.
      finishReload(slot.weapon, slot.weaponState, nowSeconds);
      slot.weaponState.reloadEndsAt = 0;
      slot.stowed.set(slot.weapon.id, slot.weaponState);
    }
    if (into === 'primary') slot.primary = gun;
    else slot.secondary = gun;
    // Two primaries and a pistol do not go together (U-022): taking the second gives the pistol up.
    if (slot.secondary !== null) slot.stowed.delete('sidearm');
    slot.pickedUp = true;
    slot.weapon = getWeapon(gun);
    slot.stowed.delete(gun);
    slot.weaponState = createWeaponState(slot.weapon);
    slot.weaponState.ammo = Math.min(target.ammo, slot.weapon.magSize);
    slot.heldProjectile = -1;
    return true;
  }

  /**
   * U-017: a dead enemy's firearm, on the ground where it fell (`PICKUPS`):
   * only a weapon the rules list — its own, never an emplacement's gun it
   * was on — with the rounds left in its magazine, under a netId never used
   * before. Past the cap the oldest goes; with the band spent, nothing more
   * drops.
   */
  private dropWeapon(enemy: EnemyEntity): void {
    if (!PICKUPS.weapons.includes(enemy.def.weapon)) return;
    this.placePickup(enemy.def.weapon, enemy.weaponState.ammo, enemy.state, enemy.yaw);
  }

  /** U-017/U-018: a gun on the ground, under a netId never used before; past the cap the oldest goes. */
  private placePickup(id: string, ammo: number, at: { x: number; y: number; z: number }, yaw: number): void {
    this.placePickupItem((WEAPON_IDS as readonly string[]).indexOf(id), ammo, at, yaw);
  }

  /** U-048: as `placePickup`, by wire item: a WEAPON_IDS index, or WEAPON_IDS.length plus a PROJECTILE_IDS index for equipment (its amount a count). */
  private placePickupItem(weapon: number, ammo: number, at: { x: number; y: number; z: number }, yaw: number, authored = false): void {
    if (weapon < 0 || this.nextPickupNetId >= PICKUP_NET_ID_LIMIT) return;
    // U-052: authored loot is outside the cap: only the enemy drops and put-down guns count, and the oldest of those goes.
    if (!authored) {
      while (this.pickupList.filter((p) => !this.authoredPickups.has(p.netId)).length >= PICKUPS.max) {
        this.pickupList.splice(this.pickupList.findIndex((p) => !this.authoredPickups.has(p.netId)), 1);
      }
    }
    if (authored) this.authoredPickups.add(this.nextPickupNetId);
    this.pickupList.push({
      netId: this.nextPickupNetId++,
      weapon,
      ammo: Math.max(0, Math.min(ammo, (1 << PICKUP_AMMO_BITS) - 1)),
      x: at.x,
      y: at.y,
      z: at.z,
      yaw,
      droppedAt: this.nowMs / 1000,
    });
  }

  /** U-017: pickups past their time go. */
  private expirePickups(nowSeconds: number): void {
    for (let i = this.pickupList.length - 1; i >= 0; i--) {
      const p = this.pickupList[i]!;
      if (!this.authoredPickups.has(p.netId) && nowSeconds - p.droppedAt >= PICKUPS.despawnSeconds) this.pickupList.splice(i, 1);
    }
  }

  /** U-017: the pickups on the ground, oldest first — for tests and U-018's taking of one. */
  get pickups(): readonly Readonly<PickupEntity>[] {
    return this.pickupList;
  }

  /** U-133: exhausted caches retain their identity/feet; readers receive detached stock. */
  get supplyCaches(): readonly SupplyCacheDef[] {
    return this.supplyDefs.map((def) => ({ ...def, feet: { ...def.feet }, stock: structuredClone(this.supplyStocks.get(def.id)!) }));
  }

  private resetSupplies(): void {
    this.clearSupplyUses();
    this.supplyStocks.clear();
    for (const def of this.supplyDefs) this.supplyStocks.set(def.id, structuredClone(def.stock));
  }

  private restoreSupplies(saved: readonly SupplyCacheStock[]): void {
    const stocks = new Map(saved.map((cache) => [cache.id, cache.stock]));
    if (saved.length !== this.supplyDefs.length || stocks.size !== saved.length || this.supplyDefs.some((def) => {
      const stock = stocks.get(def.id);
      return !stock || stock.healthKits > def.stock.healthKits || stock.primaryAmmoUnits > def.stock.primaryAmmoUnits ||
        PROJECTILE_IDS.some((id) => id !== 'smokecloud' && (stock.projectiles[id] ?? 0) > (def.stock.projectiles[id] ?? 0));
    })) throw new Error('checkpoint supply stock does not match authored caches');
    for (const [id, stock] of stocks) this.supplyStocks.set(id, structuredClone(stock));
    this.clearSupplyUses();
  }

  private supplyTransfer(slot: Slot, cache: SupplyCacheDef, item: SupplyItem) {
    return transferSupply(this.supplyStocks.get(cache.id)!, {
      primary: slot.primary, secondary: slot.secondary,
      heldWeapon: slot.heldProjectile < 0 ? slot.weapon.id : '', ammo: slot.weaponState.ammo,
      equipment: slot.equipment, pouch: slot.pouch, kits: slot.kits,
    }, { pouch: this.pouchFor(slot.index), healthKits: this.kitsFor(slot.index) }, item);
  }

  /** Availability is separate from arrival: a legitimate route may be mid-vault. */
  private supplyAvailable(slot: Slot, commander = false): boolean {
    return this.roomStarted && !this.paused && !this.incompatibleCampaign && !this.handedOff &&
      (!this.missionRun || this.missionRun.current.state === 'progress') &&
      (commander || (!slot.isBot && !!slot.connection && slot.connection.state === 'active' && !this.spectators.has(slot.connection))) &&
      isAlive(slot.health) && !slot.captured && !slot.mounted && slot.kitProgress === 0;
  }

  private canUseSupply(slot: Slot, cache: SupplyCacheDef, commander = false): boolean {
    if (!this.supplyAvailable(slot, commander) || slot.state.vault) return false;
    const p = cache.feet;
    return within(slot.state, p, SUPPLY_RULES.reachM) &&
      (slot.state.x - p.x) ** 2 + (slot.state.y - p.y) ** 2 + (slot.state.z - p.z) ** 2 <= SUPPLY_RULES.reachM ** 2 &&
      lineOfSight(soldierEye(slot.state), { ...p, y: p.y + .5 }, this.collisionBoxes);
  }

  /** Do not suspend shell evasion, under-fire defense or a traveller's needed healing. */
  private supplyUnsafe(slot: Slot, travelling: boolean): boolean {
    const now = this.nowMs / 1000;
    const dodge = slot.brain?.read('dodge');
    return suppressionLevel(slot.suppression, now) >= SQUAD_CONFIG.bot.underFire.suppression ||
      now - slot.lastDamagedAt < SQUAD_CONFIG.bot.underFire.hurtSeconds ||
      (!!dodge && now < dodge.until + ARMOUR.dodgeHoldSeconds) ||
      this.armourViews().some((view) => view.tell && now < view.tell.until && shellDanger(view, this.collisionBoxes)?.(slot.state)) ||
      (travelling && slot.kits > 0 && slot.health.current < slot.health.max * SQUAD_CONFIG.bot.kitBelowFraction);
  }

  /** Every exit releases the owned locomotion, including cancellation between brain ticks. */
  private clearSupplyUse(index: number): boolean {
    const use = this.supplyUses.get(index);
    if (use?.mode === 'commander') {
      this.followers[index] = null;
      const slot = this.slots[index]!;
      slot.input = idleInput(slot.yaw);
    }
    return this.supplyUses.delete(index);
  }

  private clearSupplyUses(): void {
    for (const index of this.supplyUses.keys()) this.clearSupplyUse(index);
  }

  /** Reuse the existing navigation failure cue; no ordinary move order is installed. */
  private failCommanderSupply(slot: Slot, reason: string): void {
    this.clearSupplyUse(slot.index);
    this.orderReports.push({ slot: slot.index, order: 'move', outcome: 'failed', reason: `supply: ${reason}`, tick: this.currentTick });
    if (this.orderReports.length > 64) this.orderReports.shift();
    for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'OrderFailed', slot: slot.index, order: 'move' });
  }

  /** Cache feet already passed authored support checks; never accept a snapped/partial endpoint. */
  private supplyPath(from: NavPoint, to: NavPoint): NavPath | null {
    const path = this.navMesh?.path(from, to);
    const end = path?.points.at(-1);
    return end && Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z) <= SPAWN_ON_MESH_M ? path! : null;
  }

  /** Run before brains/movement so a failed request yields to defensive AI on this tick. */
  private validateCommanderSupplies(): void {
    let changed = false;
    for (const slot of this.slots) {
      const use = this.supplyUses.get(slot.index);
      if (use?.mode !== 'commander') continue;
      const cache = this.supplyDefs.find((c) => c.id === use.cacheId)!;
      if (!this.canCommandSupply(use.connection, slot) || !this.supplyAvailable(slot, true) ||
        this.supplyTransfer(slot, cache, use.item).status !== 'transferred' || this.supplyUnsafe(slot, use.phase === 'approach') ||
        (use.phase === 'collect' && !this.canUseSupply(slot, cache, true))) changed = this.clearSupplyUse(slot.index) || changed;
    }
    if (changed) this.broadcastSupplyProgress();
  }

  private applySupplySelect(conn: ServerConnection, msg: Extract<Message, { kind: 'SupplySelect' }>): void {
    const slot = this.slots[conn.slot];
    if (!slot || slot.connection !== conn || msg.requestId <= (this.supplyRequestIds.get(conn) ?? -1)) return;
    this.supplyRequestIds.set(conn, msg.requestId);
    this.clearSupplyUse(slot.index);
    const cache = this.supplyDefs.find((cache) => cache.id === msg.cacheId);
    if (cache && msg.item && this.canUseSupply(slot, cache) && this.supplyTransfer(slot, cache, msg.item).status === 'transferred') {
      this.supplyUses.set(slot.index, { mode: 'self', phase: 'collect', connection: conn, cacheId: cache.id, item: msg.item, ticks: 0 });
    }
    this.broadcastSupplyProgress();
  }

  /** Command authority follows the seated issuer, never the soldier being watched. */
  private canCommandSupply(conn: ServerConnection, slot: Slot): boolean {
    const from = this.humanFor(conn);
    return conn.state === 'active' && from !== null && this.autonomous(slot) &&
      orderReach(this.classSlots[from.index] ?? '', from.index, [slot.index], SQUAD_CONFIG.fireteams).includes(slot.index) &&
      (this.commanders[slot.index] === from.index || (slot === from && this.spectators.has(conn)));
  }

  private commanderUsingSupply(slot: Slot): boolean {
    return this.supplyUses.get(slot.index)?.mode === 'commander';
  }

  /** A connection's commands lapse on controller/view changes and disconnect, not on reconnect. */
  private cancelCommanderSupplies(conn: ServerConnection): void {
    let changed = false;
    for (const [index, use] of this.supplyUses) {
      if (use.mode === 'commander' && use.connection === conn) {
        this.clearSupplyUse(index);
        changed = true;
      }
    }
    if (changed) this.broadcastSupplyProgress();
  }

  private applyCommanderSupplySelect(conn: ServerConnection, msg: Extract<Message, { kind: 'CommanderSupplySelect' }>): void {
    if (!this.humanFor(conn) || conn.state !== 'active' || msg.requestId <= (this.commanderSupplyRequestIds.get(conn) ?? -1)) return;
    this.commanderSupplyRequestIds.set(conn, msg.requestId);
    const slot = this.slots[msg.slot];
    const prior = this.supplyUses.get(msg.slot);
    // A stale commander may cancel its own request, but cannot touch a new owner's use.
    if (prior?.mode === 'commander' && prior.connection === conn) this.clearSupplyUse(msg.slot);
    const cache = this.supplyDefs.find((cache) => cache.id === msg.cacheId);
    if (slot && cache && msg.item && this.canCommandSupply(conn, slot) && this.supplyAvailable(slot, true) && !slot.state.vault &&
      this.supplyTransfer(slot, cache, msg.item).status === 'transferred') {
      const phase = this.canUseSupply(slot, cache, true) ? 'collect' : 'approach';
      if (!this.supplyUnsafe(slot, phase === 'approach')) {
        if (phase === 'approach' && !this.supplyPath(slot.state, cache.feet)) this.failCommanderSupply(slot, 'unreachable cache');
        else {
          this.endOrder(slot.index, 'replaced', 'commander supply request');
          // The request owns hands and feet; no generic revive/upload press is synthesized.
          this.giveBrain(slot);
          slot.input = idleInput(slot.yaw);
          this.supplyUses.set(slot.index, { mode: 'commander', phase, connection: conn, cacheId: cache.id, item: msg.item, ticks: 0 });
        }
      }
    }
    this.broadcastSupplyProgress();
  }

  private supplyProgress(): Extract<Message, { kind: 'SupplyProgress' }> {
    return { kind: 'SupplyProgress', uses: this.slots.flatMap((slot) => {
      const use = this.supplyUses.get(slot.index);
      return use ? [{ slot: slot.index, cacheId: use.cacheId, item: use.item,
        percent: Math.min(100, Math.floor(100 * use.ticks * TICK_SECONDS / (SUPPLY_RULES.useSeconds * this.interactionScale(slot.index)))) }] : [];
    }) };
  }

  private broadcastSupplyProgress(force = false, timed = false): void {
    if (this.supplyDefs.length === 0) return;
    const msg = this.supplyProgress();
    const key = JSON.stringify(msg.uses);
    const users = JSON.stringify(msg.uses.map((use) => [use.slot, use.cacheId, use.item]));
    // 10 Hz for the clock; selections, cancellations and completions travel immediately.
    if (timed && this.currentTick % 3 !== 0 && users === this.lastSupplyUsers) return;
    if (!force && key === this.lastSupplyProgress) return;
    this.lastSupplyProgress = key;
    this.lastSupplyUsers = users;
    for (const c of this.connections) if (c.state === 'active') c.send(msg);
  }

  private broadcastSupplies(): void {
    if (this.supplyDefs.length === 0) return;
    const msg = { kind: 'Supplies', full: true, caches: this.supplyCaches } as const;
    for (const c of this.connections) if (c.state === 'active') c.send(msg);
    this.broadcastSupplyProgress(true);
  }

  /** Stable slot order serializes completion. Every preview is recomputed, never reserved. */
  private updateSupplies(): void {
    const changed: SupplyCacheDef[] = [];
    for (const slot of this.slots) {
      const use = this.supplyUses.get(slot.index);
      if (!use) continue;
      const cache = this.supplyDefs.find((cache) => cache.id === use.cacheId)!;
      const transfer = this.supplyTransfer(slot, cache, use.item);
      const commander = use.mode === 'commander';
      const authorized = commander ? this.canCommandSupply(use.connection, slot) : slot.connection === use.connection;
      if (!authorized || !this.supplyAvailable(slot, commander) || transfer.status !== 'transferred' ||
        (commander && this.supplyUnsafe(slot, use.phase === 'approach')) ||
        (!commander && !this.holdingInteract(slot) && use.ticks > 0)) {
        this.clearSupplyUse(slot.index);
        continue;
      }
      if (use.phase === 'approach') {
        if (!this.canUseSupply(slot, cache, true)) continue;
        use.phase = 'collect';
        slot.input = idleInput(slot.yaw);
        this.followers[slot.index] = null;
      }
      if (!this.canUseSupply(slot, cache, commander)) { this.clearSupplyUse(slot.index); continue; }
      if (!commander && !this.holdingInteract(slot)) continue;
      use.ticks++;
      if (use.ticks * TICK_SECONDS + 1e-9 < SUPPLY_RULES.useSeconds * this.interactionScale(slot.index)) continue;
      this.supplyStocks.set(cache.id, transfer.stock);
      slot.pouch = [...transfer.inventory.pouch];
      slot.kits = transfer.inventory.kits;
      slot.weaponState.ammo = transfer.inventory.ammo;
      this.clearSupplyUse(slot.index);
      // Only the changed caches travel; progress never resends stock or scenery.
      const prior = changed.findIndex((c) => c.id === cache.id);
      const state = { ...cache, stock: transfer.stock };
      if (prior < 0) changed.push(state);
      else changed[prior] = state;
    }
    if (changed.length) for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'Supplies', full: false, caches: changed });
    this.broadcastSupplyProgress(false, true);
  }

  /** Projectiles in the air right now. The harness HUD reads it (T-2.32). */
  get projectilesInFlight(): number {
    return this.projectiles.length;
  }

  /** Who threw each projectile in the air and where it is now: the tests' view of a throw (T-3.22). */
  projectilesNow(): { netId: number; kind: number; ownerNetId: number; x: number; y: number; z: number }[] {
    return this.projectiles.map((p) => ({ netId: p.netId, kind: p.kind, ownerNetId: p.ownerNetId, x: p.state.x, y: p.state.y, z: p.state.z }));
  }

  /** T-4.19: false only while a hosted room is waiting for ready-up. */
  get started(): boolean {
    return this.roomStarted;
  }

  /** Humans seated right now. What a registry reclaims on (T-1.5.05). */
  get players(): number {
    return this.slots.filter((s) => !s.isBot).length;
  }

  /** Six rows, always: who is driving each slot (T-1.5.04). */
  get roster(): RosterEntry[] {
    return this.slots.map((s) => ({
      human: !s.isBot,
      name: s.connection?.name ?? '',
      classId: this.classSlots[s.index] ?? '',
      commander: this.commanders[s.index] ?? -1,
      captured: s.captured,
      // U-064: the capturer, once the hold has begun.
      takenBy: (this.captureUse.get(s.index)?.seconds ?? 0) > 0 ? this.captureUse.get(s.index)!.enemy.netId : -1,
    }));
  }

  /** U-025: the slot of the human in command of a bot slot, or -1 (a human's slot, or no human seated). */
  commanderOf(slot: number): number {
    return this.commanders[slot] ?? -1;
  }

  /**
   * U-025: a started session a human has been seated in, with nobody seated
   * now. Bots cannot go on without a human in command, so the session's
   * clock stops — no tick, no AI, no mission time — until one returns.
   */
  get paused(): boolean {
    return this.commandStarted && this.roomStarted && !this.slots.some((s) => !s.isBot);
  }

  /**
   * U-025: every bot under a seated human. A bot whose commander is still a
   * seated human keeps them (unless `fresh`, the campaign's start); any
   * other — its commander gone, the slot just handed back — goes to the
   * lowest-numbered seated human. A human's slot has none, and with no human
   * seated neither has anyone. Returns whether anything changed.
   */
  private reconcileCommanders(fresh = false): boolean {
    const humans = this.slots.filter((s) => !s.isBot).map((s) => s.index);
    if (this.roomStarted && humans.length > 0) this.commandStarted = true;
    const lowest = humans.length > 0 ? Math.min(...humans) : -1;
    let changed = false;
    for (const slot of this.slots) {
      const was = this.commanders[slot.index] ?? -1;
      const next = !slot.isBot ? -1 : !fresh && humans.includes(was) ? was : lowest;
      if (next !== was) {
        this.commanders[slot.index] = next;
        changed = true;
      }
    }
    for (const [index, use] of this.supplyUses) {
      if (use.mode === 'commander' && !this.canCommandSupply(use.connection, this.slots[index]!)) this.clearSupplyUse(index);
    }
    this.broadcastSupplyProgress();
    return changed;
  }

  /**
   * U-025: a seated human putting a bot under a seated human — any bot, any
   * human, themselves included. Refused, the state unchanged and the asker
   * sent the roster as it stands: before the campaign starts, a slot that is
   * not a bot, a commander who is not a seated, connected human.
   */
  private applyAssignCommander(conn: ServerConnection, msg: Extract<Message, { kind: 'AssignCommander' }>): void {
    const asker = this.slots.find((s) => s.connection === conn && !s.isBot);
    if (!asker) return;
    const bot = this.slots[msg.bot];
    const commander = this.slots[msg.commander];
    const valid = this.roomStarted && bot !== undefined && bot.isBot && commander !== undefined && !commander.isBot && commander.connection?.state === 'active';
    if (!valid) {
      conn.sendRoster(this.roster);
      return;
    }
    if (this.commanders[bot.index] === commander.index) return;
    this.commanders[bot.index] = commander.index;
    const use = this.supplyUses.get(bot.index);
    if (use?.mode === 'commander' && !this.canCommandSupply(use.connection, bot)) {
      this.clearSupplyUse(bot.index);
      this.broadcastSupplyProgress();
    }
    this.broadcastRoster();
  }

  /**
   * Attach a transport. The connection handshakes before taking a slot.
   *
   * This is the single-session path — the in-page harness and every test that
   * wants one session and nothing else. Whatever room code the client sends
   * is accepted: there is only one place to be. A host holding many rooms
   * handshakes the connection itself and calls `admit` on the room it chose.
   */
  addConnection(transport: Transport, now: number): ServerConnection {
    const conn = new ServerConnection(
      transport,
      {
        onJoined: (c) => this.admit(c),
        // Tracked from the start so a peer that never finishes its handshake
        // is still timed out by `step`, and forgotten if it drops before then.
        onClosed: (c) => this.connections.delete(c),
      },
      now,
    );
    this.connections.add(conn);
    return conn;
  }

  /**
   * Seat a handshaked connection, or refuse it with `room full`.
   *
   * From here on the connection's events are this session's, whoever built it.
   * The caller owns the connection's CLOCK: a host handing a connection to a
   * room restarts it on the room's time first (`ServerConnection.resetClock`),
   * because a room's clock is its own; the single-session path built the
   * connection on this session's clock to begin with.
   */
  admit(conn: ServerConnection): boolean {
    conn.rebind({
      onInput: (c, msg) => { if (this.roomStarted && !this.spectators.has(c)) this.applyInput(c, msg); },
      // NOT the `now` this connection was opened at: that value is frozen
      // forever. Fire resolves against the session's current time.
      onFire: (c, msg) => { if (this.roomStarted && !this.spectators.has(c)) this.applyFire(c, msg); },
      onThrow: (c, msg) => { if (this.roomStarted && !this.spectators.has(c)) this.applyThrow(c, msg); },
      onEquip: (c, msg) => { if (this.roomStarted && !this.spectators.has(c)) this.applyEquip(c, msg); },
      onSupplySelect: (c, msg) => { if (this.roomStarted && !this.spectators.has(c)) this.applySupplySelect(c, msg); },
      onCommanderSupplySelect: (c, msg) => this.applyCommanderSupplySelect(c, msg),
      onReload: (c) => { if (this.roomStarted && !this.spectators.has(c)) this.applyReload(c); },
      onAiDebugRequest: (c, on) => this.applyAiDebugRequest(c, on),
      onAggression: (c, msg) => this.applyAggression(c, msg),
      onSpread: (c, msg) => this.applySpread(c, msg),
      onStance: (c, msg) => this.applyStance(c, msg),
      onOrder: (c, msg) => { if (this.roomStarted) this.applyOrder(c, msg); },
      onMark: (c, msg) => { if (this.roomStarted) this.applyMark(c, msg); },
      onMissionRestart: (c, full) => { if (this.roomStarted || this.incompatibleCampaign) this.requestRestart(c, full); },
      onRoomCommand: (c, msg) => this.applyRoomCommand(c, msg),
      onAssignCommander: (c, msg) => this.applyAssignCommander(c, msg),
      onSwitchCharacter: (c, msg) => this.applySwitchCharacter(c, msg),
      onClosed: (c, reason) => this.releaseSlot(c, reason),
    });
    if (conn.state === 'closed') return false;
    this.connections.add(conn);
    return this.assignSlot(conn);
  }

  private assignSlot(conn: ServerConnection): boolean {
    const resumed = this.resumeSlot(conn);
    const slot = resumed ?? this.wantedSlot(conn) ?? this.freeSlot();
    if (!slot) {
      conn.reject('room full');
      return false;
    }
    // Take over the bot's entity in place: same netId, no spawn, no despawn.
    // Revive ownership belongs to the connection occupying a slot, not to the persistent entity.
    this.clearReviveStateForSlot(slot.index);
    this.takeBrain(slot);
    slot.isBot = false;
    slot.connection = conn;
    slot.staleTicks = 0;
    this.readySlots[slot.index] = false;
    if (!this.roomStarted && this.creatorSlot < 0) this.creatorSlot = slot.index;

    /**
     * Clear the PREVIOUS occupant's input bookkeeping (T-1.5.02).
     *
     * Entity state — position, health, weapon — deliberately survives the swap:
     * that is ADR-001's whole point, and it is why a join is not a spawn. Input
     * bookkeeping is the opposite. Tick numbers belong to a CLIENT, not to a
     * soldier: each one counts from its own page load, so the next person to
     * sit here starts again from 1.
     *
     * Leaving them was a bug that only a long-lived host could show, which is
     * why it survived all of M1. Every in-page session began fresh, so no slot
     * was ever reused by a different client. On a `SessionHost` (T-1.5.01)
     * every slot is reused, and the ordering guard in `applyInput` — drop
     * anything at or below `newestInputTick` — then discarded EVERY input from
     * the new client until their tick counter climbed past whatever the last
     * person reached. Symptoms, all at once and none of them pointing here:
     * the player moves perfectly on their own screen and not at all on anyone
     * else's, stands frozen at the previous occupant's last position, sees no
     * corrections and a prediction error of exactly zero, because the server
     * never acknowledged an input for them to reconcile against.
     *
     * `lastProcessedInputTick` matters just as much as `newestInputTick`: it is
     * echoed in every delta, so a stale one asks the new client to reconcile
     * against a tick it never predicted — the unmatched-reconcile path, which
     * snaps and throws away every pending prediction.
     */
    slot.newestInputTick = -1;
    slot.lastProcessedInputTick = -1;
    slot.pendingInputTick = -1;
    slot.queue.length = 0;
    slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;

    // A fresh token for every seating: one that has been used cannot be used again.
    slot.resumeToken = newResumeToken();
    if (!resumed) this.localPlayers.set(slot.index, slot.resumeToken);
    slot.reservedUntilMs = 0;
    if (resumed) this.resumeCount += 1;
    else this.joinCount += 1;
    conn.accept(slot.netId, slot.index, this.currentTick, this.room, this.world.id, slot.resumeToken, resumed !== null);
    this.sendProgression(conn);
    this.sendStats(conn);
    // U-025: the slot is a human's now; a first human puts every bot under them.
    this.reconcileCommanders();
    this.broadcastRoster();
    this.broadcastRoomState();
    this.broadcastRestoreGate();
    if (this.incompatibleCampaign) this.broadcastRunOffer();
    // T-3.27: a human is nobody's to order, so whatever this slot's bot was told
    // lapses; and the newcomer is shown the squad's orders and marks as they stand.
    if (this.orders[slot.index]) {
      this.endOrder(slot.index, 'replaced', 'a human took the slot');
    } else {
      conn.send({ kind: 'Orders', orders: this.currentOrders() });
    }
    conn.send({ kind: 'Aggressions', aggressions: this.aggressions });
    conn.send({ kind: 'Spreads', spreads: this.spreads });
    conn.send({ kind: 'Stances', stances: this.stances });
    conn.send({ kind: 'Marks', marks: [...this.marks] });
    if (this.missionRun && this.roomStarted) conn.send({ kind: 'Mission', ...this.missionRun.current });
    // U-090: someone who joins after the mission has ended is shown what the host may choose.
    const offer = this.runOffer();
    if (offer) conn.send(offer);
    conn.send(this.restoreGate());
    conn.send({ kind: 'ScriptState', blockers: this.scriptBlockers() });
    if (this.supplyDefs.length) {
      conn.send({ kind: 'Supplies', full: true, caches: this.supplyCaches });
      conn.send(this.supplyProgress());
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // T-3.27: orders and marks
  // -------------------------------------------------------------------------

  /** Each slot's current order, or null: only ever a bot's. */
  private readonly aggressions: SquadAggression[] = Array.from({ length: MAX_SLOTS }, () => 'aggressive');
  aggressionFor(slot: number): SquadAggression { return this.aggressions[slot] ?? 'aggressive'; }

  private canBotEngage(index: number, target: number | null): boolean {
    const slot = this.slots[index];
    if (!slot) return false;
    const order = this.orders[index];
    if (order?.order === 'attack') return target !== null && order.target === target;
    const aggression = this.aggressionFor(index);
    if (aggression === 'aggressive') return true;
    if (aggression === 'hold-fire' || target === null) return false;
    const entry = slot.memory.entries.get(target);
    return !!entry?.visible && entry.threatAt !== null && this.nowMs / 1000 - entry.threatAt <= MEMORY.threatSeconds;
  }

  private applyAggression(conn: ServerConnection, msg: Extract<Message, { kind: 'Aggression' }>): void {
    const from = this.humanFor(conn);
    if (!from || !AGGRESSION_KINDS.includes(msg.aggression)) return;
    const a = msg.address;
    const addressed = a.to === 'all' ? this.slots.map((s) => s.index) : a.to === 'fireteam' ? SQUAD_CONFIG.fireteams[a.index]?.slots ?? [] : [a.index];
    for (const i of addressed) {
      const slot = this.slots[i];
      if (!slot || (i !== from.index && (!this.autonomous(slot) || this.commanders[i] !== from.index))) continue;
      this.aggressions[i] = msg.aggression;
      slot.target = this.botTarget(slot, this.nowMs / 1000);
      slot.brain?.take('fireAt'); slot.brain?.take('suppressAt'); slot.brain?.take('throwAt'); slot.brain?.take('detonate'); slot.brain?.take('intent'); slot.brain?.take('phase');
    }
    for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'Aggressions', aggressions: this.aggressions });
  }

  /**
   * U-153: the stance each slot's bot is held in — a character's setting, like its aggression (U-101): it stays with
   * the slot through join, leave, switch, reconnect and retry, and moves only a bot (`holdStances`).
   */
  private readonly stances: SquadStance[] = Array.from({ length: MAX_SLOTS }, () => 'auto');
  stanceFor(slot: number): SquadStance { return this.stances[slot] ?? 'auto'; }

  /** U-153: a player holding the bots they command (and their own character, for when it is a bot) in a stance. */
  private applyStance(conn: ServerConnection, msg: Extract<Message, { kind: 'Stance' }>): void {
    const from = this.humanFor(conn);
    if (!from || !STANCE_KINDS.includes(msg.stance)) return;
    const a = msg.address;
    const addressed = a.to === 'all' ? this.slots.map((s) => s.index) : a.to === 'fireteam' ? SQUAD_CONFIG.fireteams[a.index]?.slots ?? [] : [a.index];
    for (const i of addressed) {
      const slot = this.slots[i];
      if (!slot || (i !== from.index && (!this.autonomous(slot) || this.commanders[i] !== from.index))) continue;
      const was = this.stanceFor(i);
      this.stances[i] = msg.stance;
      // A bot standing idle keeps its last input: let go of a held stance; `holdStances` sets the new one.
      if (was !== 'auto' && this.autonomous(slot)) slot.input = { ...slot.input, crouch: false, prone: false };
    }
    for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'Stances', stances: this.stances });
  }

  /**
   * U-153: whether a bot must be up whatever stance it is held in — its brain is off to revive or heal a squadmate
   * or use a kit, or it is collecting from a supply cache for its commander. A vault is the controller's: the
   * path follower walks a vault leg standing (`holdStances`).
   */
  private mustRise(slot: Slot): boolean {
    return (slot.brain?.read('rise') ?? false) || this.supplyUses.get(slot.index)?.mode === 'commander';
  }

  /** U-153: the pace a bot walks its brain's intent at, in the stance it is held in. */
  private heldPace(slot: Slot, intent: FollowIntent | null): FollowIntent | null {
    const stance = this.stanceFor(slot.index);
    if (!intent || stance === 'auto' || this.mustRise(slot)) return intent;
    return { goal: intent.goal, pace: stance };
  }

  /**
   * U-153: every bot held in Crouch or Prone keeps that stance on its input, after its brain's hands (`aiHands`)
   * and before it steps — holding, moving or firing. Not on a vault leg or mid-vault (the controller vaults only a
   * standing soldier), not a prisoner, not on a gun (`pinGunner`), not while it must rise (`mustRise`); a human is
   * never moved.
   */
  private holdStances(): void {
    for (const slot of this.slots) {
      const stance = this.stanceFor(slot.index);
      if (stance === 'auto' || !this.autonomous(slot) || !isAlive(slot.health) || slot.captured || slot.mounted || this.mustRise(slot)) continue;
      if (slot.state.vault || this.followers[slot.index]?.onVault) continue;
      slot.input.prone = stance === 'prone';
      slot.input.crouch = stance === 'crouch';
      slot.input.sprint = false;
    }
  }

  private readonly spreads: SquadSpread[] = Array.from({ length: MAX_SLOTS }, () => 'standard');

  spreadFor(slot: number): SquadSpread { return this.spreads[slot] ?? 'standard'; }

  private applySpread(conn: ServerConnection, msg: Extract<Message, { kind: 'Spread' }>): void {
    const from = this.humanFor(conn);
    if (!from || !SPREAD_KINDS.includes(msg.spread)) return;
    const a = msg.address;
    const addressed = a.to === 'all' ? this.slots.map((s) => s.index) : a.to === 'fireteam' ? SQUAD_CONFIG.fireteams[a.index]?.slots ?? [] : [a.index];
    for (const i of addressed) if (this.slots[i] && this.autonomous(this.slots[i]!) && this.commanders[i] === from.index) this.spreads[i] = msg.spread;
    for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'Spreads', spreads: this.spreads });
  }

  private readonly orders: (BotOrder | null)[] = Array.from({ length: MAX_SLOTS }, () => null);
  /**
   * T-3.28: how each standing order is going — active, or done and still
   * standing (a move that has arrived holds there until told otherwise) —
   * and its anchor: a hold's point, or where the bot stood when told.
   */
  private readonly orderRuns: ({ status: 'active' | 'done'; anchor: OrderPoint; xpPlayerId: string | null } | null)[] = Array.from({ length: MAX_SLOTS }, () => null);
  /** T-3.28: what became of each order — finished, failed, or replaced — newest last, the last 64. */
  readonly orderReports: OrderReport[] = [];

  /** Record an order's outcome (T-3.28). */
  private reportOrder(slot: number, outcome: OrderOutcome, reason: string): void {
    const order = this.orders[slot];
    if (!order) return;
    this.orderReports.push({ slot, order: order.order, outcome, reason, tick: this.currentTick });
    if (this.orderReports.length > 64) this.orderReports.shift();
  }

  /** An order is over: reported, taken off the bot, and every client told. */
  private endOrder(slot: number, outcome: OrderOutcome, reason: string): void {
    if (!this.orders[slot]) return;
    this.reportOrder(slot, outcome, reason);
    this.orders[slot] = null;
    this.orderRuns[slot] = null;
    this.broadcastOrders();
  }

  /**
   * A bot's brain saying how its order went (T-3.28). Done: a move stays,
   * holding where it arrived, until replaced; the others are over. Failed:
   * over. Said once — a second "done" for a move that has arrived is nothing.
   */
  private orderOutcome(slot: number, outcome: 'done' | 'failed', reason: string): void {
    const order = this.orders[slot];
    const run = this.orderRuns[slot];
    if (!order || !run || run.status === 'done') return;
    if (outcome === 'done') {
      this.awardXp(order.from, 'order', run.xpPlayerId);
      this.bumpStat(slot, 'ordersCarried');
    }
    if (outcome === 'done' && (order.order === 'move' || order.order === 'hold')) {
      this.reportOrder(slot, 'done', reason);
      run.status = 'done';
      return;
    }
    // T-2.49: a failure is told, so the bot can say it could not get there.
    if (outcome === 'failed') for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'OrderFailed', slot, order: order.order });
    this.endOrder(slot, outcome, reason);
  }
  private marks: TargetMark[] = [];
  /** U-057: the marks the placed sensors hold (by enemy), the last tick each was sensed, and each enemy's last horizontal position. */
  private sensorMarks = new Map<number, { mark: TargetMark; lastTick: number }>();
  private sensorPositions = new Map<number, { x: number; z: number }>();
  private marksChanged = false;
  private nextMarkId = 1;

  /**
   * T-5.01: the mission's committed event script, when it has one and it is
   * the mission as committed — a test's own mission under the same id is not
   * handed a script written for other objectives.
   */
  private committedScript(mission: MissionDef | undefined): EventScript | undefined {
    if (!mission || mission !== missionFor(this.world.id)) return undefined;
    const script = scriptFor(mission.id);
    return script && script.world === this.world.id ? script : undefined;
  }

  /** The order a slot's bot is under, or null (T-3.27). */
  orderFor(slotIndex: number): BotOrder | null {
    return this.orders[slotIndex] ?? null;
  }

  /** Every standing mark (T-3.27). */
  get currentMarks(): readonly TargetMark[] {
    return this.marks;
  }

  private currentOrders(): BotOrder[] {
    return this.orders.filter((o): o is BotOrder => o !== null);
  }

  private broadcastOrders(): void {
    const orders = this.currentOrders();
    for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'Orders', orders });
  }

  private broadcastMarks(): void {
    const marks = [...this.marks];
    for (const c of this.connections) if (c.state === 'active') c.send({ kind: 'Marks', marks });
  }

  /** The human seated on a connection, or null: only a human may order or mark. */
  private humanFor(conn: ServerConnection): Slot | null {
    const slot = this.slots.find((s) => s.connection === conn);
    return slot && !slot.isBot ? slot : null;
  }

  /** Whether a netId is someone in this session now: a slot, or a living enemy. */
  private exists(netId: number): boolean {
    return this.slots.some((s) => s.netId === netId) || this.enemyList.some((e) => e.netId === netId && !isDead(e.health));
  }

  /**
   * An order from a player (T-3.27), untrusted: a well-formed order
   * (`orderProblem`), from a human seated here, at a target that exists — an
   * attack at a living enemy, a revive at a squadmate — to addressees of whom
   * only bots commanded by the issuing player take it. Every client is sent
   * the squad's orders whole.
   */
  private applyOrder(conn: ServerConnection, msg: Extract<Message, { kind: 'Order' }>): void {
    const from = this.humanFor(conn);
    if (!from) return;
    this.orderFrom(from.index, msg, true);
  }

  /**
   * An order given as slot `fromIndex`, with every check `applyOrder` makes
   * but who may give it. A client's orders come through `applyOrder`, which
   * lets only a seated human give one; T-3.35's headless mission tool plays
   * the squad leader with six bots, and gives its orders here.
   */
  orderFrom(fromIndex: number, msg: Omit<Extract<Message, { kind: 'Order' }>, 'kind'>, commanderOnly = false): void {
    const from = this.slots[fromIndex];
    if (!from) return;
    if (orderProblem(msg, SQUAD_CONFIG.fireteams.length) !== null) return;
    if (msg.target !== null) {
      const wanted = msg.order === 'revive' ? this.slots.some((s) => s.netId === msg.target) : this.enemyList.some((e) => e.netId === msg.target && !isDead(e.health));
      if (!wanted) return;
    }
    const a = msg.address;
    const addressed = a.to === 'slot' ? [a.index] : a.to === 'fireteam' ? [...SQUAD_CONFIG.fireteams[a.index]!.slots] : this.slots.map((s) => s.index);
    // T-4.27: a class's orders reach the whole squad or only the giver's own fireteam.
    const reach = orderReach(this.classSlots[from.index] ?? '', from.index, addressed, SQUAD_CONFIG.fireteams);
    // A spectator's own seat retains its human connection for command authority,
    // but its brain drives it. It can receive that player's orders like any bot.
    const bots = reach.filter((i) => {
      const slot = this.slots[i];
      if (!slot || !this.autonomous(slot)) return false;
      return !commanderOnly || this.commanders[i] === from.index ||
        (i === from.index && from.connection !== null && this.spectators.has(from.connection));
    });
    // U-123: the point on the floor it names (`orderGoal`): what every bot, the escort and every client are given.
    const asked = msg.point ? this.orderGoal(msg.point) : null;
    this.orderEscort(msg, asked);
    if (bots.length === 0) return;
    this.bumpStat(from.index, 'ordersGiven');
    const destinations: { x: number; y: number; z: number }[] = [];
    for (const i of bots) {
      if (this.commanderUsingSupply(this.slots[i]!)) this.clearSupplyUse(i);
      let point = asked;
      if (asked && msg.address.to !== 'slot') {
        let spaced: OrderPoint = asked;
        const gap = Math.max(2 * this.moveConfig.radius + 0.001, (2 * this.moveConfig.radius + 0.1) * SQUAD_CONFIG.spreadScales[this.spreadFor(i)]);
        const offsets = msg.order === 'move' ? [[-1, -1], [1, -1], [-1, -2], [1, -2], [-1, -3], [1, -3]] : [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [0, 2]];
        const centre = bots.reduce((p, index) => ({ x: p.x + this.slots[index]!.state.x / bots.length, z: p.z + this.slots[index]!.state.z / bots.length }), { x: 0, z: 0 });
        const length = Math.hypot(asked.x - centre.x, asked.z - centre.z);
        const fx = length > 0.01 ? (asked.x - centre.x) / length : 0;
        const fz = length > 0.01 ? (asked.z - centre.z) / length : 1;
        for (let n = 0; n < offsets.length; n++) {
          const offset = offsets[(i + n) % offsets.length]!;
          const escort = msg.order === 'move' && this.enemyList.some((e) => e.def.friendly && !e.captive && isAlive(e.health));
          const back = offset[1]! * gap - (escort ? ESCORT_ARRIVED_M : 0);
          // Each place at the goal's height, so it is projected onto the goal's floor only.
          const place = { x: asked.x + offset[0]! * fz * gap + back * fx, y: asked.y, z: asked.z - offset[0]! * fx * gap + back * fz };
          const projected = this.navMesh?.nearestPoint(place)?.point ?? place;
          if (destinations.every((p) => Math.hypot(p.x - projected.x, p.z - projected.z) >= gap)) { spaced = projected; break; }
        }
        destinations.push(spaced);
        point = spaced;
      }
      // T-3.28: the order it was under, if it had not finished, is replaced; either way it is reported.
      if (this.orders[i]) this.reportOrder(i, this.orderRuns[i]?.status === 'done' ? 'done' : 'replaced', `${msg.order} from slot ${from.index}`);
      // U-154: every addressee watches the one way the giver was looking, wherever its spaced place is.
      this.orders[i] = { slot: i, order: msg.order, point: point ? { ...point } : null, target: msg.target, from: from.index, ...(msg.facing !== undefined ? { facing: msg.facing } : {}) };
      const at = this.slots[i]!.state;
      this.orderRuns[i] = { status: 'active', anchor: point ? { ...point } : { x: at.x, y: at.y, z: at.z }, xpPlayerId: this.xpPlayer(from.index) };
    }
    this.broadcastSupplyProgress();
    this.broadcastOrders();
  }

  /**
   * U-123: an order's point on the floor it names. A point already standing on
   * the mesh there is kept exactly as asked, its feet height and all. One off
   * it (a crate top nobody can stand on, a foot of wall) is moved to the
   * nearest place on the mesh within `ORDER_SNAP_M` across — and only within
   * the mesh's fixed vertical reach, so a basement point never becomes the roof
   * above it. As asked where there is no mesh near: the bot then finds no way
   * there and says so.
   */
  private orderGoal(p: OrderPoint): OrderPoint {
    const hit = this.navMesh?.resolvePoint(p, ORDER_SNAP_M);
    if (!hit || within(hit.point, p, ORDER_REACH_M)) return { x: p.x, y: p.y, z: p.z };
    return { x: hit.point.x, y: hit.point.y, z: hit.point.z };
  }

  /**
   * A mark from a player (T-3.27): a point, and a target at it if that target
   * exists. It stands for `ORDERS.markSeconds`; a player past
   * `ORDERS.marksPerPlayer` loses their oldest.
   */
  private applyMark(conn: ServerConnection, msg: Extract<Message, { kind: 'Mark' }>): void {
    const from = this.humanFor(conn);
    if (!from) return;
    if (![msg.point.x, msg.point.y, msg.point.z].every(Number.isFinite)) return;
    if (msg.target !== null && !this.exists(msg.target)) return;
    const mine = this.marks.filter((m) => m.from === from.index);
    if (mine.length >= ORDERS.marksPerPlayer) {
      const oldest = mine[0]!;
      this.marks = this.marks.filter((m) => m !== oldest);
    }
    this.marks.push({
      id: this.nextMarkId++,
      from: from.index,
      point: { ...msg.point },
      target: msg.target,
      expiresTick: this.currentTick + Math.round(ORDERS.markSeconds / TICK_SECONDS),
    });
    this.broadcastMarks();
  }

  /** Marks whose time is up go, and everyone is told (T-3.27). */
  private expireMarks(): void {
    const kept = this.marks.filter((m) => m.expiresTick > this.currentTick);
    if (kept.length === this.marks.length) return;
    this.marks = kept;
    this.broadcastMarks();
  }

  /**
   * T-4.18: the slot a returning player's token claims, or null. The claim
   * holds while its grace lasts and its bot still has the slot. A token that
   * names a slot a connection still holds is the same player back before the
   * host noticed the old socket die (a dead link is only seen at the
   * heartbeat timeout): the token proves the seat, so the stale connection is
   * closed and its slot taken.
   */
  private resumeSlot(conn: ServerConnection): Slot | null {
    const token = conn.resume;
    if (token === '') return null;
    const slot = this.slots.find((s) => s.resumeToken === token);
    if (!slot) return null;
    if (!slot.isBot && slot.connection && slot.connection !== conn) {
      slot.connection.reject('other', 'resumed on a new connection');
    }
    if (!slot.isBot || slot.reservedUntilMs < this.nowMs) return null;
    return slot;
  }

  /**
   * U-051: the slot a newcomer asked for, if a bot holds it and nobody has a claim on it (a dropped player's
   * reserved seat is not given away); null otherwise, and the newcomer gets the lowest free one. Two asking
   * for the same slot are seated one after the other, so the second finds it taken.
   */
  private wantedSlot(conn: ServerConnection): Slot | null {
    const want = conn.wantedSlot;
    if (want < 0) return null;
    const slot = this.slots[want];
    return slot && slot.isBot && !slot.captured && slot.reservedUntilMs <= this.nowMs ? slot : null;
  }

  /**
   * A bot's slot for a newcomer: one nobody has a claim on first; failing
   * that, rather than refuse a player, the claim that ends soonest is given up.
   */
  private freeSlot(): Slot | null {
    // U-061: a prisoner's slot is nobody's to take.
    const bots = this.slots.filter((s) => s.isBot && !s.captured);
    const unclaimed = bots.find((s) => s.reservedUntilMs < this.nowMs);
    if (unclaimed) return unclaimed;
    return bots.sort((a, b) => a.reservedUntilMs - b.reservedUntilMs)[0] ?? null;
  }

  /** T-4.29: the world's emplacements — their guns, gunners and heat. */
  get emplacements(): readonly EmplacementEntity[] {
    return this.emplacementList;
  }

  /** T-4.29: the emplacement a slot is on, or null. */
  mountOf(slotIndex: number): EmplacementEntity | null {
    return this.slots[slotIndex]?.mounted ?? null;
  }

  /**
   * T-4.29: the nearest empty gun whose gunner's place is within its
   * `withinM` of `at` (horizontally), firing `weapon` when one is named, or
   * null. Distance is to where the gunner stands, not to the gun.
   */
  private emptyGunNear(at: { x: number; z: number }, withinM: (def: EmplacementDef) => number, weapon?: string): EmplacementEntity | null {
    let best: EmplacementEntity | null = null;
    let bestSq = Number.POSITIVE_INFINITY;
    for (const gun of this.emplacementList) {
      if (gun.gunnerNetId !== 0) continue;
      if (weapon !== undefined && gun.def.weapon !== weapon) continue;
      const range = withinM(gun.def);
      const dx = at.x - gun.place.x;
      const dz = at.z - gun.place.z;
      const sq = dx * dx + dz * dz;
      if (sq <= range * range && sq < bestSq) {
        best = gun;
        bestSq = sq;
      }
    }
    return best;
  }

  /** Put a human on a gun: at the gunner's place, crouched, looking within the arc, hands off whatever they carried. */
  private mount(slot: Slot, gun: EmplacementEntity): void {
    gun.gunnerNetId = slot.netId;
    gun.outOfArcSince = null;
    slot.mounted = gun;
    slot.state = createMoveState(gun.place.x, gun.place.y, gun.place.z);
    slot.queue.length = 0;
    slot.yaw = clampYawToArc(gun.facing, slot.yaw, gun.def.traverseDeg);
    slot.pitch = clampPitch(slot.pitch, gun.def) & 0x3ff;
    slot.input = { ...idleInput(slot.yaw), crouch: true };
    slot.heldProjectile = -1;
    gun.yaw = slot.yaw;
    gun.pitch = slot.pitch;
  }

  /** Take a human off a gun. They stay where they stood, crouched until their next input says otherwise. */
  private dismount(slot: Slot): void {
    const gun = slot.mounted;
    if (!gun) return;
    gun.gunnerNetId = 0;
    gun.outOfArcSince = null;
    slot.mounted = null;
  }

  /** Put an enemy on a gun: as a human, and deployed at once — the gun is already on its mount. */
  private mountEnemy(enemy: EnemyEntity, gun: EmplacementEntity, nowSeconds: number): void {
    gun.gunnerNetId = enemy.netId;
    gun.outOfArcSince = null;
    enemy.mounted = gun;
    enemy.state = createMoveState(gun.place.x, gun.place.y, gun.place.z);
    enemy.follower = null;
    enemy.yaw = clampYawToArc(gun.facing, enemy.yaw, gun.def.traverseDeg);
    enemy.input = { ...idleInput(enemy.yaw), crouch: true };
    if (enemy.def.deploy) enemy.deployedAt = nowSeconds - enemy.def.deploy.seconds;
    gun.yaw = enemy.yaw;
    gun.pitch = 0;
  }

  private dismountEnemy(enemy: EnemyEntity): void {
    const gun = enemy.mounted;
    if (!gun) return;
    gun.gunnerNetId = 0;
    gun.outOfArcSince = null;
    enemy.mounted = null;
  }

  /** A gun as the session was built with it: nobody on it, cold, a full belt, laid on its facing. */
  private resetEmplacement(gun: EmplacementEntity): void {
    gun.gunnerNetId = 0;
    gun.outOfArcSince = null;
    gun.weaponState = createWeaponState(gun.weapon);
    gun.heat = createHeat();
    gun.yaw = gun.facing;
    gun.pitch = 0;
  }

  /** A gunner's input this tick: no movement, crouched, and a yaw the gun can traverse to. The gun follows. */
  private pinGunner(slot: Slot, gun: EmplacementEntity): void {
    const yaw = clampYawToArc(gun.facing, slot.input.yaw, gun.def.traverseDeg);
    slot.input = { ...slot.input, moveX: 0, moveY: 0, jump: false, sprint: false, crouch: true, prone: false, yaw };
    gun.yaw = yaw;
  }

  /**
   * T-4.29: the guns cool and settle, and mounting is resolved. A human's
   * interact PRESS (not hold) mounts the nearest empty gun within its mount
   * range, or dismounts; the revive (`updateRevives`, before this) has first
   * claim on the same press, so a medic's E next to a downed mate and a gun
   * revives. A downed, dead or departed gunner is off the gun. An enemy that
   * carries a gun's weapon takes an empty gun within `ai.takeWithinM` when
   * the gun can bear on what it is fighting, and holds it until its target
   * stays outside the arc (`aiShoot`) or it dies (`killEnemy`).
   */
  private updateMounts(nowSeconds: number): void {
    for (const gun of this.emplacementList) {
      decayBloom(gun.weapon, gun.weaponState, TICK_SECONDS);
      coolHeat(gun.def, gun.heat, TICK_SECONDS);
    }
    for (const slot of this.slots) {
      if (slot.mounted && (this.autonomous(slot) || !isAlive(slot.health))) this.dismount(slot);
      if (this.autonomous(slot)) {
        slot.interactWasHeld = false;
        slot.dropPending = false;
        // U-011: a bot holding at a waiting upload's terminal starts it, through the same checks as a player's press —
        // unless the hands it holds out are a revive's.
        if (this.holdingInteract(slot) && !this.slots.some((t) => t.reviveBySlot === slot.index)) this.startUploadAt(slot);
        continue;
      }
      if (slot.dropPending) {
        slot.dropPending = false;
        this.dropHeld(slot);
      }
      const held = this.holdingInteract(slot);
      const pressed = held && !slot.interactWasHeld;
      slot.interactWasHeld = held;
      if (!pressed) continue;
      if (slot.mounted) {
        this.clearSupplyUse(slot.index);
        this.dismount(slot);
        continue;
      }
      if (!isAlive(slot.health) || slot.state.vault) continue;
      if (this.slots.some((t) => t.reviveBySlot === slot.index)) continue;
      const gun = this.emptyGunNear(slot.state, (def) => def.mountRangeM);
      if (gun) {
        this.clearSupplyUse(slot.index);
        this.mount(slot, gun);
      }
      // U-018: a weapon on the ground within reach; U-009: else the press may be for an upload terminal.
      else if (this.takeOwnCharge(slot) || this.takePickupAt(slot) || this.startUploadAt(slot)) this.clearSupplyUse(slot.index);
    }
    for (const enemy of this.enemyList) {
      if (enemy.inactive || enemy.mounted || isDead(enemy.health) || enemy.state.vault || enemy.def.friendly) continue;
      const gun = this.emptyGunNear(enemy.state, (def) => def.ai.takeWithinM, enemy.def.weapon);
      if (!gun || !enemy.canReach(gun.place)) continue;
      const targetId = enemy.brain?.fireAt ?? null;
      const target = targetId === null ? null : this.soldier(targetId);
      if (target && !withinArc(gun.facing, tableToWire(aimAngles(gun.muzzle, target.state).yaw), gun.def.traverseDeg)) continue;
      this.mountEnemy(enemy, gun, nowSeconds);
    }
  }

  /** U-010: who is at (or on the way to) the lever, and how long they have held it — for tests and the QA readout. */
  get lever(): { netId: number; seconds: number } | null {
    return this.leverUse ? { netId: this.leverUse.enemy.netId, seconds: this.leverUse.seconds } : null;
  }

  /** U-010: the running upload's lever, or null — no upload running, or one with no lever. */
  private activeLever(): UploadLever | null {
    const run = this.missionRun;
    const up = run && this.roomStarted ? run.openUpload() : null;
    return up && up.phase === 'active' ? (up.def.lever ?? null) : null;
  }

  /** U-010: how far the lever's user is through its pull, percent. */
  private leverPercent(): number {
    const lever = this.activeLever();
    if (!this.leverUse || !lever) return 0;
    return Math.min(100, Math.floor((100 * this.leverUse.seconds) / lever.useSeconds));
  }

  /**
   * U-010: the lever, a tick at a time. While an upload with a lever runs,
   * one enemy of its group is sent to it — the nearest living one the nav
   * mesh can take there, not on a gun and not barred — and the session, not
   * the brain, times the pull: it counts while that enemy is alive, holds
   * the lever (its brain's `interact`) within `reachM` of its eye with a
   * clear line to it, the same checks a soldier's press at the terminal
   * meets. Anything else — shot, pushed off, out of reach, blocked — sets
   * the pull back to nothing. The user is released when it dies, when its
   * way there turns out not to exist (barred for `LEVER_BAR_SECONDS`, so the
   * next nearest is tried and nobody waits on it forever), or when the
   * upload stops running. A pull that lands cuts the upload once
   * (`interruptUpload`, which does nothing to one already stopped), tells
   * everyone, and frees the lever until the upload runs again.
   */
  private updateLever(nowSeconds: number): void {
    const lever = this.activeLever();
    if (!lever) {
      this.leverUse = null;
      return;
    }
    for (const [netId, until] of this.leverBarred) if (until <= nowSeconds) this.leverBarred.delete(netId);
    const use = this.leverUse;
    if (use) {
      const e = use.enemy;
      const gone = isDead(e.health) || !this.enemyList.includes(e) || e.mounted !== null || !e.brain || e.brain.isStopped;
      if (gone || (e.pathStatus === 'unreachable' && !this.atLever(e, lever))) {
        if (!gone) this.leverBarred.set(e.netId, nowSeconds + LEVER_BAR_SECONDS);
        this.leverUse = null;
      }
    }
    if (!this.leverUse) {
      const members = new Set(this.spawnerValue?.spawnedBy(lever.group) ?? []);
      const candidates = this.enemyList
        .filter((e) => members.has(e.netId) && !e.inactive && !isDead(e.health) && !e.mounted && e.brain && !e.brain.isStopped && !this.leverBarred.has(e.netId))
        .sort((a, b) => Math.hypot(a.state.x - lever.at.x, a.state.z - lever.at.z) - Math.hypot(b.state.x - lever.at.x, b.state.z - lever.at.z));
      for (const e of candidates) {
        if (this.enemyInteractionGoal(e, lever.at) && this.canWalkTo(e.state, lever.at)) {
          this.leverUse = { enemy: e, seconds: 0 };
          break;
        }
        // No way there from where it stands: not this one, for a while.
        this.leverBarred.set(e.netId, nowSeconds + LEVER_BAR_SECONDS);
      }
      if (!this.leverUse) return;
    }
    const current = this.leverUse!;
    if (!this.atLever(current.enemy, lever) || !current.enemy.brain!.read('interact')) {
      current.seconds = 0;
      return;
    }
    current.seconds += TICK_SECONDS;
    if (current.seconds < lever.useSeconds) return;
    this.leverUse = null;
    if (this.missionRun!.interruptUpload()) {
      this.broadcastMission();
      this.eventHost().message('The upload was cut at the lever');
    }
  }

  /** U-062: the capture jobs under way — slot index, capturer and seconds held — for tests and the QA readout. */
  get captures(): { slot: number; netId: number; seconds: number }[] {
    return [...this.captureUse].map(([slot, job]) => ({ slot, netId: job.enemy.netId, seconds: job.seconds }));
  }

  /**
   * U-062: whether a downed character may be taken prisoner now: downed at least `downedMinSeconds`, no squadmate who is
   * up within `squadmateRadiusM`, and at least one squadmate up anywhere (a wipe is a failure, not a capture).
   */
  private captureEligible(slot: Slot, nowSeconds: number): boolean {
    const cfg = DAMAGE.capture;
    if (slot.captured || !isDowned(slot.health) || slot.health.downedAt === null) return false;
    if (nowSeconds - slot.health.downedAt < cfg.downedMinSeconds) return false;
    let someoneUp = false;
    for (const other of this.slots) {
      if (other === slot || other.captured || !isAlive(other.health)) continue;
      someoneUp = true;
      if (this.distanceSq(slot, other) <= cfg.squadmateRadiusM * cfg.squadmateRadiusM) return false;
    }
    return someoneUp;
  }

  /** U-062: the length of a nav path from `from` that ends within reach of `to`'s foot, metres, or null if there is none. */
  private walkDistanceTo(from: Readonly<MoveState>, to: { x: number; y: number; z: number }): number | null {
    const points = this.navMesh?.path(from, to)?.points;
    const end = points?.at(-1);
    if (!points || !end || Math.hypot(end.x - to.x, end.z - to.z) > LEVER_PATH_END_M) return null;
    let length = 0;
    let prev: { x: number; z: number } = from;
    for (const p of points) {
      length += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    return length;
  }

  /**
   * U-062: enemies taking downed characters prisoner, a tick at a time. An enemy with nothing to shoot is sent to an
   * eligible downed character (nearest first, one capturer each) when it can walk there and hold them for
   * `channelSeconds` inside what is left of the bleed-out; the session, not the brain, times the hold. The job is
   * dropped, and the channel starts over with nothing kept, when the capturer dies or is suppressed past the threshold,
   * finds a target, loses its path or is sent to the lever, when the character stops being eligible (a squadmate
   * comes within range — so a revive, which needs one, lands as it always did — or they die, or the squad is
   * wiped) or when it can no longer finish inside the bleed-out. An interrupted capturer is barred for `retrySeconds`.
   * A hold that completes calls `captureCharacter`.
   */
  private updateCaptures(nowSeconds: number): void {
    const cfg = DAMAGE.capture;
    for (const [netId, until] of this.captureBarred) if (until <= nowSeconds) this.captureBarred.delete(netId);
    for (const [index, job] of this.captureUse) {
      const held = this.slots[index];
      const e = job.enemy;
      const gone = !held || isDead(e.health) || !this.enemyList.includes(e) || e.mounted !== null || !e.brain || e.brain.isStopped || this.leverUse?.enemy === e;
      if (gone || !this.captureEligible(held!, nowSeconds)) {
        this.captureUse.delete(index);
        continue;
      }
      const atHeld = this.atHeld(e, held!);
      if (
        e.target !== null ||
        suppressionLevel(e.suppression, nowSeconds) >= cfg.suppression ||
        (e.pathStatus === 'unreachable' && !atHeld) ||
        bleedOutRemaining(held!.health, nowSeconds) < cfg.channelSeconds - job.seconds
      ) {
        this.captureBarred.set(e.netId, nowSeconds + cfg.retrySeconds);
        this.captureUse.delete(index);
      }
    }
    // Only every half second: a path for each capturer and downed character is not free.
    if (this.currentTick % 15 === 0) this.assignCaptures(nowSeconds);
    for (const [index, job] of [...this.captureUse]) {
      const held = this.slots[index]!;
      if (!this.atHeld(job.enemy, held) || !job.enemy.brain!.read('interact')) {
        job.seconds = 0;
        continue;
      }
      job.seconds += TICK_SECONDS;
      if (job.seconds < cfg.channelSeconds) continue;
      this.captureUse.delete(index);
      this.captureCharacter(index, { x: held.state.x, y: held.state.y, z: held.state.z });
    }
    this.announceCaptures();
  }

  /** U-062: sends the nearest able enemy to each eligible downed character that has no capturer. */
  private assignCaptures(nowSeconds: number): void {
    const cfg = DAMAGE.capture;
    const busy = new Set([...this.captureUse.values()].map((job) => job.enemy));
    for (const held of this.slots) {
      if (this.captureUse.has(held.index) || !this.captureEligible(held, nowSeconds)) continue;
      const remaining = bleedOutRemaining(held.health, nowSeconds);
      const dist = (e: EnemyEntity) => Math.hypot(e.state.x - held.state.x, e.state.z - held.state.z);
      const candidates = this.enemyList
        .filter(
          (e) =>
            !busy.has(e) && !e.inactive && !isDead(e.health) && !e.mounted && e.brain && !e.brain.isStopped && e.target === null &&
            e.faction !== SQUAD && !e.def.friendly && this.leverUse?.enemy !== e && !this.captureBarred.has(e.netId) &&
            // Straight-line lower bound first: one too far to finish in time is not worth a path.
            dist(e) / cfg.approachSpeedMps + cfg.channelSeconds <= remaining,
        )
        .sort((a, b) => dist(a) - dist(b))
        .slice(0, 4);
      for (const e of candidates) {
        const walk = e.bounds ? completePathLength(this.enemyPath(e, held.state), e.state, held.state) : this.walkDistanceTo(e.state, held.state);
        if (walk === null || walk / cfg.approachSpeedMps + cfg.channelSeconds > remaining) continue;
        this.captureUse.set(held.index, { enemy: e, seconds: 0 });
        busy.add(e);
        break;
      }
    }
  }

  /** U-062: whether an enemy stands close enough over a downed character to hold them. */
  private atHeld(e: EnemyEntity, held: Slot): boolean {
    if (isDead(e.health) || e.state.vault || !e.canReach(held.state)) return false;
    return Math.hypot(e.state.x - held.state.x, e.state.z - held.state.z) <= DAMAGE.capture.reachM && Math.abs(e.state.y - held.state.y) <= 1.5;
  }

  /** U-010: whether an enemy stands at the lever by the terminal's rules: in reach of its eye, and a clear line to it. */
  private atLever(e: EnemyEntity, lever: UploadLever): boolean {
    if (isDead(e.health) || e.state.vault || !this.enemyInteractionGoal(e, lever.at)) return false;
    const eye = soldierEye(e.state);
    const t = lever.at;
    if ((eye.x - t.x) ** 2 + (eye.y - t.y) ** 2 + (eye.z - t.z) ** 2 > lever.reachM * lever.reachM) return false;
    return lineOfSight(eye, t, this.collisionBoxes);
  }

  /** U-010: a path from `from` that ends within reach of `to`'s foot. */
  private canWalkTo(from: Readonly<MoveState>, to: { x: number; y: number; z: number }): boolean {
    const mesh = this.navMesh;
    if (!mesh) return false;
    const path = mesh.path(from, to);
    const end = path?.points.at(-1);
    return end !== undefined && Math.hypot(end.x - to.x, end.z - to.z) <= LEVER_PATH_END_M;
  }

  /**
   * U-009: a human's interact press (since U-011, or a bot's held hands at the terminal), not already a revive or a gun, at the
   * current upload's terminal. The press is the host's to judge, and it
   * starts the upload only when every check holds: the mission running and
   * its objective an upload that is not already running (`startUpload`); the
   * soldier alive and standing (not downed), not vaulting or on a gun; the
   * terminal within the objective's `reachM` of the soldier's eye; and
   * nothing in the world between the eye and the panel. A press is an edge
   * of the newest real input (`updateMounts`), so a held key, a repeat of an
   * old input or a press after the upload finished starts nothing.
   */
  private startUploadAt(slot: Slot): boolean {
    const run = this.missionRun;
    const up = run && this.roomStarted ? run.openUpload() : null;
    if (!run || !up || up.phase === 'active') return false;
    const def = up.def;
    if (!isAlive(slot.health) || slot.state.vault || slot.mounted) return false;
    const eye = soldierEye(slot.state);
    const t = def.terminal;
    if ((eye.x - t.x) ** 2 + (eye.y - t.y) ** 2 + (eye.z - t.z) ** 2 > def.reachM * def.reachM) return false;
    if (!lineOfSight(eye, t, this.collisionBoxes)) return false;
    const started = run.startUpload();
    if (started) this.broadcastMission();
    return started;
  }

  /**
   * T-4.29: a mounted gunner's trigger pull. The gun's weapon, belt, cadence
   * and heat, whatever the message names; the aim held within the arc; the
   * round from the gun's muzzle, through the same `traceShot` as every shot.
   * Aimed always: a gun on a mount is a gun on a mount.
   */
  private fireMounted(slot: Slot, gun: EmplacementEntity, msg: Extract<Message, { kind: 'Fire' }>): void {
    const nowSeconds = this.nowMs / 1000;
    finishReload(gun.weapon, gun.weaponState, nowSeconds);
    const yawWire = clampYawToArc(gun.facing, tableToWire(msg.yaw), gun.def.traverseDeg);
    const pitchWire = clampPitch(tableToWire(msg.pitch), gun.def) & 0x3ff;
    slot.yaw = yawWire;
    slot.pitch = pitchWire;
    gun.yaw = yawWire;
    gun.pitch = pitchWire;
    if (!canFireHot(gun.heat)) return;
    const shot = tryFire(gun.weapon, gun.weaponState, nowSeconds, true, false);
    if (shot === null) {
      if (gun.weaponState.ammo === 0) startReload(gun.weapon, gun.weaponState, nowSeconds);
      return;
    }
    heatShot(gun.def, gun.heat);
    this.lastFiredTick[slot.index] = this.currentTick;
    // Table units for the trace, from the clamped wire aim: the round goes where the gun points, not where the message did.
    const yaw = (yawWire << WIRE_TO_TABLE_SHIFT) & 0xfff;
    const pitch = (pitchWire << WIRE_TO_TABLE_SHIFT) & 0xfff;
    this.traceShot(slot.netId, gun.weapon, shot, msg.tick, gun.muzzle, yaw, pitch, msg.renderTimeMs);
  }

  private releaseSlot(conn: ServerConnection, reason = ''): void {
    this.cancelCommanderSupplies(conn);
    this.connections.delete(conn);
    this.aiDebugClients.delete(conn);
    this.spectators.delete(conn);
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;
    // T-4.18: a dropped socket keeps a claim on the seat for the grace; a
    // player who chose to leave keeps none, and the seat is anyone's.
    slot.reservedUntilMs = reason === 'left' ? 0 : this.nowMs + RESUME.graceSeconds * 1000;
    if (slot.reservedUntilMs === 0) slot.resumeToken = '';
    // Hand the entity back to a bot; it keeps its position and its netId.
    // A departing reviver must not leave an interaction attached to a persistent entity.
    this.clearReviveStateForSlot(slot.index);
    // T-4.29: a bot does not use the gun; the seat leaves it.
    if (slot.mounted) this.dismount(slot);
    slot.isBot = true;
    slot.connection = null;
    this.readySlots[slot.index] = false;
    if (!this.roomStarted && this.creatorSlot === slot.index) {
      this.creatorSlot = this.slots.find((s) => !s.isBot && s.connection !== null)?.index ?? -1;
    }
    // U-090: if the mission is over, whoever hosts now is told what they may choose.
    this.broadcastRunOffer();
    this.broadcastRestoreGate();
    slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
    // A bot has a gun in hand, not whatever the departed player was holding.
    slot.heldProjectile = -1;
    // Anything still queued belongs to someone who has left. A bot that walked
    // out the departed player's last few inputs would look briefly possessed.
    slot.queue.length = 0;
    this.giveBrain(slot);
    // U-025: the departed player's bots, and the slot they leave, go to the lowest-numbered human left.
    this.reconcileCommanders();
    this.broadcastRoster();
    this.broadcastRoomState();
    if (!this.roomStarted && this.everyHumanReady()) this.startRoom();
  }

  /**
   * T-3.09: a client asking for AI debug reports. A host that does not allow
   * them ignores the request outright — it does not even remember it — so
   * turning the flag on later could never start sending to a client that
   * asked of a host that said no.
   */
  private applyAiDebugRequest(conn: ServerConnection, on: boolean): void {
    if (!this.aiDebugAllowed) return;
    if (on) this.aiDebugClients.add(conn);
    else this.aiDebugClients.delete(conn);
  }

  /**
   * At the brains' 10 Hz, every running brain's reasons to every client that
   * asked. Unreliable: each report replaces the last, so a lost one is only a
   * tenth of a second of a stale overlay. Nothing is built when nobody asked.
   */
  private sendAiDebug(): void {
    if (this.aiDebugClients.size === 0 || this.currentTick % BRAIN_PERIOD_TICKS !== 0) return;
    const sources: AiDebugSource[] = [];
    for (const slot of this.slots) {
      if (!slot.brain) continue;
      sources.push({ netId: slot.netId, position: slot.state, brain: slot.brain, follower: this.followers[slot.index] ?? null });
    }
    for (const enemy of this.enemyList) {
      if (!enemy.brain) continue;
      sources.push({ netId: enemy.netId, position: enemy.state, brain: enemy.brain, follower: enemy.follower });
    }
    const wire = encodeMessage(buildAiDebug(this.currentTick, sources));
    for (const conn of this.aiDebugClients) {
      if (conn.state !== 'active' || !conn.transport.isOpen) continue;
      conn.transport.send(wire, 'unreliable');
      this.aiDebugSent++;
      this.aiDebugBytesSent += wire.length;
    }
  }

  /**
   * Everyone learns who is in the squad whenever it changes. Reliable, and
   * tiny: six booleans and six short names, a few times per session.
   */
  private broadcastRoster(): void {
    const roster = this.roster;
    for (const c of this.connections) if (c.state === 'active') c.sendRoster(roster);
  }

  /** T-4.19: ready-up state is separate from the gameplay roster. */
  private broadcastRoomState(): void {
    if (!this.roomLobbyEnabled) return;
    const creator = this.creatorSlot >= 0 ? this.creatorSlot : 0;
    const msg = { kind: 'RoomState', started: this.roomStarted, creator, world: this.world.id, ready: [...this.readySlots], classes: [...this.classSlots] } as const;
    for (const c of this.connections) if (c.state === 'active') c.send(msg);
  }

  private everyHumanReady(): boolean {
    const humans = this.slots.filter((slot) => !slot.isBot);
    return humans.length > 0 && humans.every((slot) => this.readySlots[slot.index] === true);
  }

  private startRoom(): void {
    if (this.roomStarted || this.incompatibleCampaign) return;
    this.roomStarted = true;
    if (!this.missionStartState) this.captureMissionStart();
    for (const slot of this.slots) {
      slot.queue.length = 0;
      slot.input = idleInput(slot.yaw);
      slot.pendingInputTick = -1;
    }
    this.startEncounter(this.missionCheckpointState?.completedGroups ?? []);
    // U-060: a resumed campaign starts in the world its checkpoint saved, as a retry does.
    const worldRestored = this.restoreCheckpointWorld(this.missionCheckpointState);
    if (this.missionCheckpointState?.event) this.restoreEvents(this.missionCheckpointState, worldRestored);
    this.spawnerValue?.initialize();
    // U-025: the campaign starts with every bot under the lowest-numbered human.
    this.reconcileCommanders(true);
    this.broadcastRoster();
    this.broadcastRoomState();
    this.broadcastMission();
    this.broadcastScriptState();
    this.broadcastSupplies();
  }

  private applyRoomCommand(conn: ServerConnection, msg: Extract<Message, { kind: 'RoomCommand' }>): void {
    if (msg.command === 'choose') {
      this.applyRunChoice(conn, msg);
      return;
    }
    if (this.incompatibleCampaign) return;
    if (!this.roomLobbyEnabled || this.roomStarted) return;
    const slot = this.slots.find((candidate) => candidate.connection === conn && !candidate.isBot);
    if (!slot) return;
    if (msg.command === 'ready') {
      this.readySlots[slot.index] = msg.ready ?? false;
      if (this.everyHumanReady()) this.startRoom();
      else this.broadcastRoomState();
      return;
    }
    // U-021: a character is the slot's, so there is nothing to pick; a 'class' command from an older page is ignored.
    if (msg.command === 'class') return;
    if (msg.command === 'start' && slot.index === this.creatorSlot) this.startRoom();
  }

  private applyInput(conn: ServerConnection, msg: Extract<Message, { kind: 'Input' }>): void {
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;

    /**
     * Every input the packet carries, oldest first: the resent ones and then
     * the newest. Anything already seen is dropped — a duplicate carries no
     * information, and on a reordering link a stale one would otherwise
     * overwrite its own successor.
     */
    const frames = [...(msg.prior ?? [])]
      .sort((a, b) => a.tick - b.tick)
      .map((f) => ({
        tick: f.tick,
        moveX: f.moveX,
        moveY: f.moveY,
        yaw: f.yaw,
        buttons: f.buttons,
      }))
      .concat([
        { tick: msg.tick, moveX: msg.moveX, moveY: msg.moveY, yaw: msg.yaw, buttons: msg.buttons },
      ]);

    for (const frame of frames) {
      if (frame.tick <= slot.newestInputTick) continue;
      slot.newestInputTick = frame.tick;
      slot.queue.push({
        tick: frame.tick,
        input: {
          moveX: frame.moveX,
          moveY: frame.moveY,
          yaw: frame.yaw,
          jump: (frame.buttons & 0b001) !== 0,
          sprint: (frame.buttons & 0b010) !== 0,
          crouch: (frame.buttons & 0b100) !== 0,
          interact: (frame.buttons & 0b1000) !== 0,
          firing: (frame.buttons & 0b10000) !== 0,
          // T-2.40, ADR-016.
          prone: (frame.buttons & 0b100000) !== 0,
          // U-029.
          drop: (frame.buttons & 0b1000000) !== 0,
          // U-046.
          cook: (frame.buttons & 0b10000000) !== 0,
        },
      });
    }

    /**
     * Nothing is dropped here. Discarding a queued input loses a tick of motion
     * the player actually made, and the client — which predicted it — eats the
     * whole difference as a correction. That was measured: dropping from the
     * front on a bursty link produced 1.1 m lurches on an otherwise clean run.
     *
     * A backlog is drained by CATCHING UP in `step` instead, which keeps every
     * input. The queue is still bounded, by a hard ceiling that only a client
     * sending far faster than the tick rate can reach.
     */
    while (slot.queue.length > MAX_INPUT_QUEUE * 4) slot.queue.shift();

    // Aim is not queued: it is a view direction, not a movement step, and the
    // freshest one is always the right one.
    if (slot.mounted) {
      // T-4.29: the gun goes where the gunner looks, as far as it traverses and elevates.
      slot.yaw = clampYawToArc(slot.mounted.facing, msg.yaw, slot.mounted.def.traverseDeg);
      slot.pitch = clampPitch(msg.pitch, slot.mounted.def) & 0x3ff;
      slot.mounted.yaw = slot.yaw;
      slot.mounted.pitch = slot.pitch;
    } else if (isAlive(slot.health)) {
      // U-030: a downed or dead body cannot turn (the player's camera still can).
      slot.yaw = msg.yaw;
      slot.pitch = msg.pitch;
    }
  }

  /**
   * Resolve a trigger pull (T-1.17 cadence, T-1.18 rewind).
   *
   * Everything in the message is untrusted. The weapon index is bounds-checked,
   * the cadence and magazine are the server's own, and the claimed render time
   * is clamped inside `resolveShot`.
   */
  private applyFire(conn: ServerConnection, msg: Extract<Message, { kind: 'Fire' }>): void {
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;
    // A downed soldier is on the ground and a dead one is waiting to respawn;
    // neither has a weapon in hand. A client that keeps sending Fire gets
    // nothing, and never a hit event to draw.
    if (!isAlive(slot.health)) return;
    // Mid-vault both hands are on the wall (T-2.21). The client stops pulling
    // the trigger too; refusing here keeps a lying client from firing.
    if (slot.state.vault) return;
    // T-4.29: on a gun, the gun fires — with its own numbers, arc and heat.
    if (slot.mounted) {
      this.fireMounted(slot, slot.mounted, msg);
      return;
    }

    const id = WEAPON_IDS[msg.weapon];
    if (id === undefined) return; // Out-of-range index: drop it, do not throw.
    // U-018: a Fire names a gun the soldier carries, or it is refused — as a forged Equip is. (It used to swap to any.)
    if (!this.carries(slot, id)) return;
    this.drawGun(slot, id);
    // A shot is a gun in hand, whatever the last Equip said.
    slot.heldProjectile = -1;

    const nowSeconds = this.nowMs / 1000;
    finishReload(slot.weapon, slot.weaponState, nowSeconds);

    /**
     * No auto/semi check here, deliberately. Each Fire message IS one discrete
     * trigger pull, so `allowsFire` would be asked (held, edge) = (true, true)
     * and answer true for every weapon — a check that reads like enforcement
     * while enforcing nothing. Auto versus semi is a client INPUT concern: it
     * decides whether holding the button keeps generating pulls. What stops a
     * client generating them faster than the weapon allows is the cadence in
     * `tryFire` below, which is the server's own and is the real protection.
     */
    /**
     * Prone fires like any other stance (T-2.42, ADR-016): no refusal, only a
     * stance input. The stance is the one at the rewound instant, the same
     * instant the origin below is taken from, so the cone and the eye height
     * never disagree about whether this shooter was lying down.
     */
    const rewoundTo = this.nowMs - clampRewindMs(this.nowMs, msg.renderTimeMs);
    const shooterThen = this.hitboxes.stateAt(slot.netId, rewoundTo);
    const proneThen = shooterThen?.prone ?? slot.state.prone;
    // U-002 (B-09): and a crouched one from a crouched eye, in the stance it fired in.
    const crouchedThen = shooterThen?.crouched ?? slot.state.crouched;
    // T-3.16: suppression widens the cone by its data's amount, at the level the page is told.
    const shot = tryFire(slot.weapon, slot.weaponState, nowSeconds, msg.ads && this.mayAim(slot), proneThen, suppressionConeUnits(suppressionLevel(slot.suppression, nowSeconds)));
    if (shot === null) {
      // Cadence, reload or an empty magazine. Auto-reload so a player who
      // empties a magazine is not stuck until they think to press a key.
      if (slot.weaponState.ammo === 0) startReload(slot.weapon, slot.weaponState, nowSeconds);
      return;
    }

    /**
     * Wire units here, TABLE units in the message.
     *
     * `slot.pitch` is what the snapshot replicates (`s.pitch & 0x3ff`), and a
     * Fire carries its aim at 1/4096 so the server traces the exact angles the
     * client computed. Storing the table value in the wire field masked off the
     * top two bits of it, so a shot fired while looking up replicated a
     * nonsense aim pitch until the next Input overwrote it — visible since
     * T-2.25 as a remote soldier's rifle flicking as they fire. Found while
     * adding the throw beside it; one line, so it is fixed here rather than
     * left for the sign-off to trip over.
     */
    slot.pitch = tableToWire(msg.pitch);
    // Already table units: no expansion, so no expansion error.
    const yaw = msg.yaw & 0xfff;
    const pitch = msg.pitch & 0xfff;
    /**
     * Traced from the eye, not from the visual muzzle. The server does not know
     * which camera the client is using and must not need to: a shot must hit
     * the same thing in first and third person, or the view mode becomes a
     * gameplay choice. The client draws its tracer from wherever the weapon
     * appears to be; that is cosmetic.
     */
    /**
     * Trace from where the SHOOTER was when they fired, not from where they are
     * now.
     *
     * The fire command took half a round trip to arrive, and the server kept
     * simulating in the meantime — at 80 ms and sprint speed the shooter has
     * moved about 0.54 m. Tracing the client's aim direction from a position
     * half a metre away from the one it was computed at throws the shot off by
     * a couple of degrees over typical range, which is an order of magnitude
     * wider than the weapon's own aimed cone. It reads as the gun being
     * inaccurate, and it gets worse with ping, exactly like the report.
     *
     * Rewinding the origin to the same instant the TARGETS are rewound to puts
     * the whole trace in one moment — the moment the player was looking at.
     * That is the same principle lag compensation already applies to targets,
     * applied to the shooter, and it is the missing half of it.
     */
    const at = shooterThen?.position ?? slot.state;
    // A prone shooter's shot leaves from a prone eye (T-2.42), not 0.75 m above
    // the body — otherwise lying behind cover would still shoot over it.
    const origin = eyePosition(at.x, at.y, at.z, DEFAULT_MUZZLE_RIG, eyeStance(crouchedThen, proneThen));
    this.lastFiredTick[slot.index] = this.currentTick;
    this.traceShot(slot.netId, slot.weapon, shot, msg.tick, origin, yaw, pitch, msg.renderTimeMs);
  }

  /**
   * Everything after the trigger: one trigger pull's pellets traced, damage
   * applied, stimuli made and `HitEvent`s sent. A human's `Fire` comes here
   * rewound to the instant it was looking at; an AI's (T-3.15) with no rewind
   * at all — `renderTimeMs` the present — because a
   * server-side shooter sees the world as it is. One path, so an enemy's round
   * hurts a slot through exactly the `applyDamage` a player's hurts an enemy.
   */
  private traceShot(
    shooterNetId: number,
    weapon: WeaponDef,
    shot: Shot,
    tick: number,
    origin: { x: number; y: number; z: number },
    yaw: number,
    pitch: number,
    renderTimeMs: number,
  ): void {
    // T-3.14: the shot is heard where it was fired from, once per trigger pull.
    if (weapon.id !== 'knife') this.stimuli.push({ kind: 'shot', at: origin, sourceNetId: shooterNetId });

    for (const dir of shotDirections(weapon, shot, shooterNetId, tick, yaw, pitch)) {
      const hit = resolveShot(
        this.hitboxes,
        {
          shooterNetId,
          ray: { origin, direction: dir, maxDistance: weapon.maxRangeM },
          nowMs: this.nowMs,
          clientRenderTimeMs: renderTimeMs,
        },
        DEFAULT_HITBOX,
        this.collisionBoxes,
      );

      let dealt = 0;
      if (hit && hit.netId !== 0) {
        /**
         * Zone from the impact point's height up the target's hitbox — which is
         * exactly why T-1.18 returns a point rather than only a distance.
         */
        const zone = hit.zone;
        dealt = zoneDamage(damageAtDistance(weapon, hit.distance), zone);

        const target = this.slots.find((s) => s.netId === hit.netId);
        if (target) {
          const result = applyDamage(target.health, dealt, this.nowMs / 1000);
          dealt = result.applied;
          if (result.killed) this.bumpStat(target.index, 'deaths');
          if (dealt > 0) {
            target.lastDamagedAt = this.nowMs / 1000;
            if (this.slots.some((sl) => sl.netId === shooterNetId)) this.friendlyHitCount++;
          }
          /**
           * A killed player stops moving immediately: their queued inputs are
           * intent from before they died, and letting a corpse run out its
           * buffer looks like the hit did not register. A DOWNED player keeps
           * their queue too — the controller ignores it and holds them still
           * (B-05) — so a revive or death still lands on the tick it should.
           */
          if (result.killed) target.queue.length = 0;
        }
        // An enemy is hurt by the same rules, except that it dies at zero
        // rather than going down (T-3.10, its archetype's `downable`).
        const enemy = target ? undefined : this.enemyList.find((e) => e.netId === hit.netId);
        if (enemy) {
          // U-066: a tank's armour turns most of a bullet away.
          if (enemy.def.vehicle) dealt *= enemy.def.vehicle.armour.bullet;
          const result = applyDamage(enemy.health, dealt, this.nowMs / 1000, DAMAGE, enemy.def.downable);
          dealt = result.applied;
          if (dealt > 0) enemy.lastDamagedAt = this.nowMs / 1000;
          if (result.killed) {
            this.killEnemy(enemy);
            const shooterSlot = this.slots.findIndex((s) => s.netId === shooterNetId);
            // U-075: shooting the escorted character earns nothing.
            if (!enemy.def.friendly) {
              this.awardXp(shooterSlot, 'kill');
              this.bumpStat(shooterSlot, 'kills');
            }
          }
        }
        // Range targets take no damage: they are the range's fixtures, not
        // enemies, and stay so (T-3.10).
      }
      this.emitShotStimuli(shooterNetId, origin, dir, hit ? hit.distance : weapon.maxRangeM, hit?.point ?? null, hit?.netId ?? 0);

      // A scenery stop is a hit event on netId 0 at the wall: everyone draws
      // the tracer ending there, nobody takes damage (T-1.12).
      const event: Message = hit
        ? {
            kind: 'HitEvent',
            shooterNetId,
            targetNetId: hit.netId,
            x: hit.point.x,
            y: hit.point.y,
            z: hit.point.z,
            originX: origin.x,
            originY: origin.y,
            originZ: origin.z,
            damage: dealt,
          }
        : {
            kind: 'HitEvent',
            shooterNetId,
            targetNetId: 0,
            x: origin.x + dir.x * weapon.maxRangeM,
            y: origin.y + dir.y * weapon.maxRangeM,
            z: origin.z + dir.z * weapon.maxRangeM,
            originX: origin.x,
            originY: origin.y,
            originZ: origin.z,
            damage: 0,
          };
      for (const c of this.connections) c.send(event);
    }
  }

  /**
   * What one pellet does after it leaves the muzzle besides what it hits
   * (T-3.14 hearing, T-3.16 suppression). An impact is heard where it stopped
   * and suppresses every soldier of the other side whose capsule is within
   * `impactRadiusM` of it; a near miss — the path passing within `nearMissM`
   * of a capsule without touching it — suppresses that soldier, and an enemy
   * hears it at the closest point. Traced against the present, not the
   * rewound world: what a soldier feels is the round going past it now.
   */
  private emitShotStimuli(
    shooterNetId: number,
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    length: number,
    impact: { x: number; y: number; z: number } | null,
    hitNetId: number,
  ): void {
    const nowSeconds = this.nowMs / 1000;
    if (impact) this.stimuli.push({ kind: 'impact', at: { x: impact.x, y: impact.y, z: impact.z }, sourceNetId: shooterNetId });
    const shooter = this.side(shooterNetId);
    for (const soldier of this.livingSoldiers()) {
      if (soldier.netId === hitNetId || soldier.netId === shooterNetId) continue;
      if (!this.hostile(shooter, soldier.side)) continue;
      const capsule = soldierCapsule(soldier.state);
      const pass = passCapsule(origin, dir, length, capsule);
      if (isNearMiss(pass.gap)) {
        raiseSuppression(soldier.suppression, SUPPRESSION.nearMiss, nowSeconds);
        this.dealt(shooterNetId, SUPPRESSION.nearMiss);
        if (soldier.side !== SQUAD) this.stimuli.push({ kind: 'nearMiss', at: pass.at, sourceNetId: shooterNetId });
      }
      if (impact && capsuleGap(impact, capsule) <= SUPPRESSION.impactRadiusM) {
        raiseSuppression(soldier.suppression, SUPPRESSION.impact, nowSeconds);
        this.dealt(shooterNetId, SUPPRESSION.impact);
      }
    }
  }

  /**
   * T-3.23: suppression each shooter has dealt, summed as the data's amounts
   * before any target's cap — what its rounds did, not what the targets could
   * still take. The MG scenario compares archetypes by it.
   */
  private readonly suppressionDealt = new Map<number, number>();

  private dealt(shooterNetId: number, amount: number): void {
    this.suppressionDealt.set(shooterNetId, (this.suppressionDealt.get(shooterNetId) ?? 0) + amount);
  }

  /** Suppression a shooter's rounds have dealt so far (T-3.23). */
  suppressionDealtBy(netId: number): number {
    return this.suppressionDealt.get(netId) ?? 0;
  }

  /**
   * Every living soldier — slot or enemy — as much of it as suppression needs:
   * where it stands, its level, and its side (`SQUAD` for a slot, else the
   * enemy's faction).
   */
  private livingSoldiers(): { netId: number; state: MoveState; suppression: SuppressionState; side: number }[] {
    const out: { netId: number; state: MoveState; suppression: SuppressionState; side: number }[] = [];
    for (const slot of this.slots) if (!isDead(slot.health)) out.push({ netId: slot.netId, state: slot.state, suppression: slot.suppression, side: SQUAD });
    for (const e of this.enemyList) if (!isDead(e.health)) out.push({ netId: e.netId, state: e.state, suppression: e.suppression, side: e.def.friendly ? SQUAD : e.faction });
    return out;
  }

  /** Whose side a netId is on: `SQUAD`, an enemy's faction, or null for no soldier. */
  private side(netId: number): number | null {
    if (this.slots.some((s) => s.netId === netId)) return SQUAD;
    const e = this.enemyList.find((x) => x.netId === netId);
    return e ? (e.def.friendly ? SQUAD : e.faction) : null;
  }

  /**
   * Whether rounds from `from` suppress a soldier on `to`. Only the other
   * side's fire pins a soldier down: a squadmate's rounds past your ear, or a
   * grenade you threw yourself, do not. Fire from nobody in particular does.
   */
  private hostile(from: number | null, to: number): boolean {
    return from === null || from !== to;
  }

  /**
   * A projectile leaving the hand (T-2.31).
   *
   * Everything in the message is untrusted, as in `applyFire`: the index is
   * bounds-checked, and the pouch and the cooldown are the server's own, so a
   * client sending Throw thirty times a second gets exactly what the data
   * allows and nothing more.
   *
   * Nothing is rewound. A hitscan shot is resolved against the world its
   * shooter was looking at, because the shot is over by the time the message
   * arrives; a grenade is an object that exists from here on, in everyone's
   * present, and spawning it in the past would only put it where nobody will
   * see it.
   */
  private applyThrow(conn: ServerConnection, msg: Extract<Message, { kind: 'Throw' }>): void {
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;
    // The same two refusals a Fire gets: no hands free while downed, dead or
    // mid-vault. The client stops asking too; this is for one that does not.
    if (!isAlive(slot.health)) return;
    if (slot.state.vault) return;

    // U-054: C4 is thrown by the character that may (the support) and put on a surface within reach by everyone else.
    if (this.projectileDefs[msg.projectile]?.kind === 'placed' && !this.throwsPlaced(slot.index)) {
      this.placeCharge(slot, msg.projectile, msg.yaw, msg.pitch);
      return;
    }
    // U-046: a grenade with its pin pulled flies with the fuse it has left; the host's own clock says how long it was cooked.
    const cooked = slot.cook?.kind === msg.projectile ? this.nowMs / 1000 - slot.cook.since : 0;
    const fuse = this.projectileDefs[msg.projectile]?.fuseSeconds ?? 0;
    // A sliver of fuse is always left: a grenade thrown at the last moment still leaves the hand.
    const age = fuse > 0 ? Math.max(0, Math.min(cooked, fuse - TICK_SECONDS)) : 0;
    if (this.launch(slot, slot.index, msg.projectile, msg.yaw, msg.pitch, age) && slot.cook?.kind === msg.projectile) slot.cook = null;
  }

  /**
   * U-047: a soldier with the health kits in hand and the trigger held applies
   * one, to the nearest downed mate in reach, else the nearest hurt mate, else
   * themselves. The application runs `DAMAGE.kit.seconds` and is interrupted by
   * letting go, by putting the kits away, by damage, or by the target moving out
   * of reach or changing state; a downed soldier cannot apply one, even to
   * themselves. Spent on completion. Bots use them (U-053) on a hurt mate.
   */
  private updateKits(): void {
    const reachSq = DAMAGE.kit.reachM * DAMAGE.kit.reachM;
    for (const slot of this.slots) {
      const damaged = slot.health.current < slot.kitHealth;
      slot.kitHealth = slot.health.current;
      // A bot's brain asks for the use itself (U-053) and takes the kit out to do it; a human holds the trigger with it drawn.
      const botWants = this.autonomous(slot) && !this.commanderUsingSupply(slot) && (slot.brain?.read('useKit') ?? false);
      if (botWants) slot.heldProjectile = KIT_HELD;
      else if (this.autonomous(slot) && slot.heldProjectile === KIT_HELD) slot.heldProjectile = -1;
      const using =
        slot.heldProjectile === KIT_HELD && slot.kits > 0 && isAlive(slot.health) && !slot.mounted && !slot.state.vault && !damaged &&
        (this.autonomous(slot) ? botWants : slot.input.firing === true && slot.staleTicks <= MAX_INPUT_REPEAT);
      if (!using) {
        slot.kitProgress = 0;
        slot.kitTarget = -1;
        continue;
      }
      let target = slot.kitTarget >= 0 ? this.slots[slot.kitTarget] : undefined;
      // The one being helped must still be in reach and still need it in the same way.
      if (target && (target !== slot && this.distanceSq(slot, target) > reachSq || isDead(target.health) || (!isDowned(target.health) && target.health.current >= target.health.max))) {
        target = undefined;
        slot.kitProgress = 0;
      }
      if (!target) {
        let best: Slot | null = null;
        let bestRank = 3;
        let bestD = Number.POSITIVE_INFINITY;
        for (const other of this.slots) {
          if (other === slot || other.mounted) continue;
          const downed = isDowned(other.health);
          if (!downed && !(isAlive(other.health) && other.health.current < other.health.max)) continue;
          const d = this.distanceSq(slot, other);
          if (d > reachSq) continue;
          const rank = downed ? 0 : 1;
          if (rank < bestRank || (rank === bestRank && d < bestD)) {
            best = other;
            bestRank = rank;
            bestD = d;
          }
        }
        if (best === null && slot.health.current < slot.health.max) best = slot;
        if (best === null) {
          slot.kitProgress = 0;
          slot.kitTarget = -1;
          continue;
        }
        target = best;
        slot.kitTarget = best.index;
        slot.kitProgress = 0;
      }
      slot.kitProgress += TICK_SECONDS;
      if (slot.kitProgress >= this.kitSeconds(slot)) {
        const wasDowned = isDowned(target.health);
        if (applyKit(target.health)) {
          slot.kits -= 1;
          if (target !== slot && wasDowned) {
            this.awardXp(slot.index, 'revive');
            this.bumpStat(slot.index, 'revives');
            target.queue.length = 0;
          }
          target.reviveBySlot = -1;
          target.reviveProgressSeconds = 0;
        }
        slot.kitProgress = 0;
        slot.kitTarget = -1;
      }
    }
  }

  /** U-050: this soldier's multiple on walking and sprinting speed (the support's +10%); 1 without a class. */
  private speedScaleOf(slot: number): number {
    if (this.classLoadouts !== 'class') return 1;
    return classById(this.classSlots[slot] ?? '')?.speedScale ?? 1;
  }

  /** U-049: this soldier's multiple on the time of a timed interaction (the support's discount); 1 without a class. */
  private interactionScale(slot: number): number {
    if (this.classLoadouts !== 'class') return 1;
    return classById(this.classSlots[slot] ?? '')?.interactionTimeScale ?? 1;
  }

  /** U-049: seconds `reviver` (a slot index) must hold E to revive; 3 for most, less for the support. */
  private reviveSeconds(reviver: number): number {
    return DAMAGE.downed.reviveSeconds * this.interactionScale(reviver < 0 ? -1 : reviver);
  }

  /** U-047, U-049: seconds this soldier takes to apply a kit. */
  private kitSeconds(slot: Slot): number {
    return DAMAGE.kit.seconds * this.interactionScale(slot.index);
  }

  /**
   * U-046: right click with a thrown item in hand pulls the pin (a press, not a hold); the fuse runs from then. A
   * grenade not thrown in time goes off in the hand, where its soldier stands (dead or alive), and is spent.
   */
  private updateCooking(nowSeconds: number): void {
    for (const slot of this.slots) {
      const held = slot.cookHeld && !this.autonomous(slot);
      const pressed = held && !slot.cookWasHeld;
      slot.cookWasHeld = held;
      if (pressed && isAlive(slot.health) && !slot.mounted && !slot.state.vault && this.projectileDefs[slot.heldProjectile]?.kind === 'placed') {
        // U-054: right click with the charges in hand is the detonator.
        this.detonateCharges(slot, slot.heldProjectile);
      } else if (pressed && slot.cook === null && isAlive(slot.health) && !slot.mounted && !slot.state.vault && slot.heldProjectile >= 0) {
        const def = this.projectileDefs[slot.heldProjectile];
        if (def && def.kind === 'thrown' && def.fuseSeconds > 0 && (slot.pouch[slot.heldProjectile] ?? 0) > 0) {
          slot.cook = { kind: slot.heldProjectile, since: nowSeconds };
        }
      }
      const cook = slot.cook;
      if (cook === null) continue;
      const def = this.projectileDefs[cook.kind];
      if (!def || (slot.pouch[cook.kind] ?? 0) <= 0) {
        slot.cook = null;
      } else if (nowSeconds - cook.since >= def.fuseSeconds && this.projectiles.length < MAX_PROJECTILES) {
        slot.pouch[cook.kind] = (slot.pouch[cook.kind] ?? 0) - 1;
        const origin = throwEye(slot.state);
        this.projectiles.push({
          netId: this.nextProjectileNetId++,
          def,
          kind: cook.kind,
          ownerSlot: slot.index,
          ownerNetId: slot.netId,
          xpPlayerId: this.xpPlayer(slot.index),
          state: { ...createProjectileState(origin, { x: 0, y: 0, z: 0 }), age: def.fuseSeconds },
        });
        slot.cook = null;
      }
    }
  }

  /** U-054: whether this slot's character throws placed equipment; everyone does on a free session. */
  private throwsPlaced(slot: number): boolean {
    if (this.classLoadouts !== 'class') return true;
    return classById(this.classSlots[slot] ?? '')?.throwsPlaced ?? false;
  }

  /**
   * U-054: put a charge on the surface the soldier is looking at, within `PLACE_REACH_M` of the eye: a wall, or the
   * ground. Spends one; nothing happens (and nothing is spent) if there is no surface in reach.
   */
  private placeCharge(slot: Slot, projectile: number, yaw: number, pitch: number): boolean {
    const def = this.projectileDefs[projectile] ?? null;
    if (def === null || def.kind !== 'placed') return false;
    const nowSeconds = this.nowMs / 1000;
    if (nowSeconds < slot.nextThrowAt || (slot.pouch[projectile] ?? 0) <= 0 || this.projectiles.length >= MAX_PROJECTILES) return false;
    const eye = throwEye(slot.state);
    const dir = dirFromYawPitch(yaw, pitch);
    let reach = PLACE_REACH_M;
    let normal = { x: 0, y: 1, z: 0 };
    const hit = rayWorld({ origin: eye, direction: dir, maxDistance: PLACE_REACH_M }, this.collisionBoxes);
    if (hit) {
      reach = hit.distance;
      normal = hit.normal;
    }
    const groundY = this.moveConfig.groundY;
    if (dir.y < -1e-6) {
      const t = (groundY - eye.y) / dir.y;
      if (t >= 0 && t <= reach) {
        reach = t;
        normal = { x: 0, y: 1, z: 0 };
      } else if (!hit) return false;
    } else if (!hit) return false;
    slot.pouch[projectile] = (slot.pouch[projectile] ?? 0) - 1;
    slot.nextThrowAt = nowSeconds + def.cooldownSeconds;
    const lift = def.radiusM + 0.01;
    this.projectiles.push({
      netId: this.nextProjectileNetId++,
      def,
      kind: projectile,
      ownerSlot: slot.index,
      ownerNetId: slot.netId,
      xpPlayerId: this.xpPlayer(slot.index),
      state: createProjectileState(
        { x: eye.x + dir.x * reach + normal.x * lift, y: eye.y + dir.y * reach + normal.y * lift, z: eye.z + dir.z * reach + normal.z * lift },
        { x: 0, y: 0, z: 0 },
      ),
      stuck: true,
      ...(def.coneDeg > 0 ? { facing: flatFacing(yaw) } : {}),
    });
    return true;
  }

  /** U-055: whether a body is inside a directional device's cone (always, for an ordinary blast). */
  private inBlastCone(p: ActiveProjectile, body: { x: number; z: number }): boolean {
    if (p.def.coneDeg <= 0 || !p.facing) return true;
    const dx = body.x - p.state.x;
    const dz = body.z - p.state.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.05) return true;
    return dx * p.facing.x + dz * p.facing.z >= d * coneHalfCos(p.def.coneDeg);
  }

  /** U-055: a stuck mine is tripped when a soldier of the other side is within `triggerM` in front of it, in sight. */
  private mineTripped(p: ActiveProjectile): boolean {
    const owner = this.side(p.ownerNetId);
    const from = { x: p.state.x, y: p.state.y + 0.3, z: p.state.z };
    for (const soldier of this.livingSoldiers()) {
      if (!this.hostile(owner, soldier.side)) continue;
      const centre = soldierCapsule(soldier.state).centre;
      const d = Math.sqrt((centre.x - from.x) ** 2 + (centre.y - from.y) ** 2 + (centre.z - from.z) ** 2);
      if (d > p.def.triggerM || !this.inBlastCone(p, soldier.state)) continue;
      if (lineOfSight(from, centre, this.collisionBoxes)) return true;
    }
    return false;
  }

  /**
   * U-057: every stuck sensor marks each living enemy within `senseM` (through walls) that moved faster than
   * `senseSpeedMps` since the last tick, for the whole squad, through the same marks a player's ping makes. A mark
   * lingers `SENSOR_LINGER_TICKS` after the enemy stops or leaves, then fades; with the sensor gone they all do.
   */
  private updateSensors(): void {
    const seen = new Set<number>();
    const sensors = this.projectiles.filter((p) => p.def.senseM > 0 && p.stuck === true && p.destroyed !== true);
    for (const enemy of this.enemyList) {
      const before = this.sensorPositions.get(enemy.netId);
      this.sensorPositions.set(enemy.netId, { x: enemy.state.x, z: enemy.state.z });
      if (isDead(enemy.health) || before === undefined) continue;
      const speed = Math.hypot(enemy.state.x - before.x, enemy.state.z - before.z) / TICK_SECONDS;
      for (const s of sensors) {
        if (speed <= s.def.senseSpeedMps) continue;
        if (Math.hypot(enemy.state.x - s.state.x, enemy.state.y - s.state.y, enemy.state.z - s.state.z) > s.def.senseM) continue;
        seen.add(enemy.netId);
        const held = this.sensorMarks.get(enemy.netId);
        const from = s.ownerSlot;
        if (held) held.lastTick = this.currentTick;
        else {
          const mark: TargetMark = {
            id: this.nextMarkId++,
            from,
            point: { x: enemy.state.x, y: enemy.state.y, z: enemy.state.z },
            target: enemy.netId,
            expiresTick: Number.MAX_SAFE_INTEGER,
          };
          this.sensorMarks.set(enemy.netId, { mark, lastTick: this.currentTick });
          this.marks.push(mark);
          this.marksChanged = true;
        }
        break;
      }
    }
    for (const [netId, held] of this.sensorMarks) {
      if (seen.has(netId) || this.currentTick - held.lastTick <= SENSOR_LINGER_TICKS) continue;
      this.sensorMarks.delete(netId);
      this.marks = this.marks.filter((m) => m !== held.mark);
      this.marksChanged = true;
    }
    if (this.marksChanged) {
      this.marksChanged = false;
      this.broadcastMarks();
    }
  }

  /** U-054: every armed charge of this kind that `slot` has out goes off at once. */
  private detonateCharges(slot: Slot, kind: number): void {
    const mine = this.projectiles.filter((p) => p.kind === kind && p.stuck === true && p.ownerNetId === slot.netId && p.def.senseM <= 0);
    if (mine.length === 0) return;
    const rest = this.projectiles.filter((p) => !mine.includes(p));
    this.projectiles.length = 0;
    this.projectiles.push(...rest);
    for (const p of mine) this.detonate(p, { x: p.state.x, y: p.state.y, z: p.state.z });
  }

  /** U-054: E on the soldier's own charge, within reach and in sight, takes it back into the pouch. */
  private takeOwnCharge(slot: Slot): boolean {
    if (!isAlive(slot.health) || slot.state.vault || slot.mounted) return false;
    const eye = soldierEye(slot.state);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    this.projectiles.forEach((p, i) => {
      if (p.def.kind !== 'placed' || p.stuck !== true || p.ownerNetId !== slot.netId || p.def.smokeM > 0) return;
      const d = Math.hypot(eye.x - p.state.x, eye.y - p.state.y, eye.z - p.state.z);
      if (d <= PICKUPS.reachM && d < bestD && lineOfSight(eye, { x: p.state.x, y: p.state.y, z: p.state.z }, this.collisionBoxes)) {
        best = i;
        bestD = d;
      }
    });
    if (best < 0) return false;
    const [taken] = this.projectiles.splice(best, 1);
    slot.pouch[taken!.kind] = Math.min(POUCH_COUNT_MAX, (slot.pouch[taken!.kind] ?? 0) + 1);
    return true;
  }

  /**
   * The throw itself, for a slot's Throw and an enemy brain's alike (T-3.22):
   * the index bounds-checked, the thrower's own pouch and cooldown, the
   * session's cap, then the launch `throwLaunch` computes from its eye.
   * Returns whether anything left the hand.
   */
  private launch(
    thrower: { netId: number; state: MoveState; pouch: number[]; nextThrowAt: number },
    ownerSlot: number,
    projectile: number,
    yawIn: number,
    pitchIn: number,
    cookedSeconds = 0,
  ): boolean {
    const def = this.projectileDefs[projectile] ?? null;
    if (def === null) return false; // Out-of-range index: drop it, do not throw.
    const nowSeconds = this.nowMs / 1000;
    if (nowSeconds < thrower.nextThrowAt) return false;
    const left = thrower.pouch[projectile] ?? 0;
    if (left <= 0) return false;
    // Nothing is spent on a throw the session has no room for.
    if (this.projectiles.length >= MAX_PROJECTILES) return false;
    thrower.pouch[projectile] = left - 1;
    thrower.nextThrowAt = nowSeconds + def.cooldownSeconds;

    const { origin, velocity } = throwLaunch(def, throwEye(thrower.state), yawIn, pitchIn, this.projectileWorld());
    this.projectiles.push({
      netId: this.nextProjectileNetId++,
      def,
      kind: projectile,
      ownerSlot,
      ownerNetId: thrower.netId,
      xpPlayerId: this.xpPlayer(this.slots.findIndex((s) => s.netId === thrower.netId)),
      state: { ...createProjectileState(origin, velocity), age: cookedSeconds },
      ...(def.coneDeg > 0 ? { facing: flatFacing(yawIn) } : {}),
    });
    return true;
  }

  /**
   * A switch of what is in the hands: the loadout index, guns first and the
   * pouch after them. Out-of-range is dropped like every other index. A gun
   * switch is the same one a Fire with a new weapon index makes, so the
   * body shows the new gun before its first shot.
   */
  private applyEquip(conn: ServerConnection, msg: Extract<Message, { kind: 'Equip' }>): void {
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;
    // Hands are unavailable while downed or dead; enforce it here as well as
    // at the client so a forged Equip cannot change the authoritative weapon.
    if (!isAlive(slot.health)) return;
    // T-4.29: a gunner's hands are on the gun; what they carry waits.
    if (slot.mounted) return;
    const gun = WEAPON_IDS[msg.item];
    if (gun !== undefined) {
      // T-4.27: a class carries its own guns and no others — its primary a picked-up one, since U-018.
      if (!this.carries(slot, gun)) return;
      this.drawGun(slot, gun);
      slot.heldProjectile = -1;
      return;
    }
    // U-047: slot 6, the health kits, drawn like a grenade: shown to others as one more pouch item in hand.
    if (msg.item === KIT_EQUIP_ITEM) {
      slot.heldProjectile = KIT_HELD;
      return;
    }
    const pouchIndex = msg.item - WEAPON_IDS.length;
    if (projectileByIndex(pouchIndex) === null) return;
    // U-048: the frag, and the one piece of equipment this soldier carries; nothing else in the pouch has a slot.
    if (pouchIndex !== FRAG_INDEX && pouchIndex !== slot.equipment) return;
    slot.heldProjectile = pouchIndex;
  }

  /**
   * U-028: a reload the player started on the page — the reload key, or an
   * empty magazine reloading itself — run on the host's own weapon state and
   * clock, so the magazine the host fires from is the one the page shows.
   * Refused, as a forged one must be, while down or dead, on a mounted gun,
   * or with a grenade or a rocket in hand; `startReload` itself refuses a
   * full magazine or one already reloading.
   */
  private applyReload(conn: ServerConnection): void {
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot || !isAlive(slot.health) || slot.mounted || slot.heldProjectile >= 0) return;
    const nowSeconds = this.nowMs / 1000;
    finishReload(slot.weapon, slot.weaponState, nowSeconds);
    startReload(slot.weapon, slot.weaponState, nowSeconds);
  }

  /** The boxes and the floor a projectile collides with: this session's world. */
  private projectileWorld(): ProjectileWorld {
    return { boxes: this.collisionBoxes, groundY: this.moveConfig.groundY };
  }

  /**
   * Fly every projectile one tick, and detonate the ones that arrive.
   *
   * Run AFTER the soldiers have moved, so a rocket meets the bodies where this
   * tick left them rather than where the last one did.
   */
  private stepProjectiles(): void {
    if (this.projectiles.length === 0 && this.released.length === 0) return;
    const world = this.projectileWorld();
    const survivors: ActiveProjectile[] = [];
    for (const projectile of this.projectiles) {
      // U-054: a placed charge goes off only on its owner's word; a stuck one just waits, and a very old one goes quietly.
      if (projectile.def.kind === 'placed') {
        if (projectile.destroyed === true) continue;
        if (!projectile.stuck) {
          const flight = stepProjectile(projectile.def, projectile.state, TICK_SECONDS, world);
          projectile.state = flight.state;
          if (flight.impact !== null || flight.state.resting) {
            projectile.state.vx = 0;
            projectile.state.vy = 0;
            projectile.state.vz = 0;
            projectile.stuck = true;
          }
        } else {
          projectile.state.age += TICK_SECONDS;
          // U-055: a mine with a trip goes off by itself when the other side comes into its cone.
          if (projectile.def.triggerM > 0 && this.mineTripped(projectile)) {
            this.detonate(projectile, { x: projectile.state.x, y: projectile.state.y, z: projectile.state.z });
            continue;
          }
        }
        if (projectile.state.age < projectile.def.maxLifeSeconds) survivors.push(projectile);
        continue;
      }
      const step = stepProjectile(projectile.def, projectile.state, TICK_SECONDS, world);
      projectile.state = step.state;

      let at = step.detonation === null ? null : step.detonation.point;
      /**
       * A rocket goes off on the first BODY it touches too, and the body wins:
       * `step.to` is already truncated at whatever scenery stopped the
       * projectile, so anything found inside that segment is at or in front of
       * the wall. The thrower is excluded — a rocket is born half a metre from
       * its own capsule — but the blast that follows is not, so firing one into
       * a wall at arm's length still costs you.
       */
      if (projectile.def.detonateOnImpact) {
        const body = this.bodyAlong(step.from, step.to, projectile.ownerNetId);
        if (body !== null) at = body;
      }

      if (at === null) {
        survivors.push(projectile);
        continue;
      }
      this.detonate(projectile, at);
    }
    this.projectiles.length = 0;
    for (const projectile of survivors) if (projectile.destroyed !== true) this.projectiles.push(projectile);
    // U-058: what a detonation released this tick (a smoke cloud) joins the world after the pass.
    for (const released of this.released) this.projectiles.push(released);
    this.released.length = 0;
  }

  /**
   * U-058: the clouds of smoke there are, each as a sphere, thinning over its last seconds so that
   * a cloud about to end conceals less than a fresh one.
   */
  private smokeClouds(): SmokeCloud[] {
    const out: SmokeCloud[] = [];
    for (const p of this.projectiles) {
      if (p.def.smokeM <= 0) continue;
      const remaining = p.def.maxLifeSeconds - p.state.age;
      const fade = Math.max(0, Math.min(1, remaining / SMOKE_FADE_SECONDS));
      out.push({ x: p.state.x, y: p.state.y, z: p.state.z, radiusM: p.def.smokeM * fade });
    }
    return out;
  }

  /**
   * The nearest hit capsule along a segment, as it stands NOW, or null.
   *
   * Deliberately not `resolveShot`: that rewinds, which is right for a shot
   * fired at a remembered world and wrong for an object flying through the
   * present one. The range targets are in here on the same terms as the
   * players, so a rocket goes off on a target the way a bullet stops on one.
   */
  private bodyAlong(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, excludeNetId: number): { x: number; y: number; z: number } | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length <= 0) return null;
    const ray = { origin: from, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length };
    let best: number | null = null;
    for (const netId of this.hitboxes.netIds()) {
      if (netId === excludeNetId) continue;
      const state = this.hitboxes.stateAt(netId, this.nowMs);
      if (state === null) continue;
      // U-068: a rocket goes off on a tank's hull, not on the soldier-sized capsule at its middle.
      const distance = rayBody(ray, bodyParts(this.hitboxes.shapeOf(netId) ?? DEFAULT_HITBOX, state.stance, state.position, state.yaw))?.distance ?? null;
      if (distance === null) continue;
      if (best === null || distance < best) best = distance;
    }
    if (best === null) return null;
    return {
      x: from.x + ray.direction.x * best,
      y: from.y + ray.direction.y * best,
      z: from.z + ray.direction.z * best,
    };
  }

  /**
   * Go off: everyone in reach takes the blast, the thrower included.
   *
   * SELF-DAMAGE AND FRIENDLY FIRE ARE ON, and that is a decision rather than
   * an oversight. Six co-operative slots and nothing hostile in M2 means a
   * grenade that could not hurt a teammate could not be judged at all — and a
   * blast a player can stand in is the only thing that makes them respect the
   * fuse. Damage goes through `applyDamage` like a bullet's, so a blast downs,
   * cuts a bleed-out and cannot kill twice, by the same rules.
   */
  private detonate(projectile: ActiveProjectile, at: { x: number; y: number; z: number }): void {
    const nowSeconds = this.nowMs / 1000;
    const targets: { netId: number; damage: number }[] = [];
    for (const slot of this.slots) {
      if (isDead(slot.health)) continue;
      if (!this.inBlastCone(projectile, slot.state)) continue;
      const height = slot.state.prone ? PRONE_HITBOX_HEIGHT : slot.state.crouched ? CROUCH_HITBOX_HEIGHT : HITBOX_HEIGHT;
      const damage = blastDamageOn(
        projectile.def,
        at,
        { x: slot.state.x, y: slot.state.y, z: slot.state.z },
        height,
        this.collisionBoxes,
      );
      if (damage <= 0) continue;
      const result = applyDamage(slot.health, damage, nowSeconds);
      if (result.applied > 0) slot.lastDamagedAt = nowSeconds;
      // A killed player stops moving immediately, as under fire (see applyFire).
      if (result.killed) {
        slot.queue.length = 0;
        this.bumpStat(slot.index, 'deaths');
      }
      targets.push({ netId: slot.netId, damage: result.applied });
    }
    // Enemies take the blast on the same terms (T-3.10), dying at zero.
    for (const enemy of this.enemyList) {
      if (isDead(enemy.health)) continue;
      if (!this.inBlastCone(projectile, enemy.state)) continue;
      const vehicle = enemy.def.vehicle;
      // U-066: a blast reaches a tank's hull, not its middle: measured from its skin, and cut by its armour.
      const height = vehicle ? 2 * vehicle.hull.radius + 0.6 : enemy.state.prone ? PRONE_HITBOX_HEIGHT : enemy.state.crouched ? CROUCH_HITBOX_HEIGHT : HITBOX_HEIGHT;
      let feet = { x: enemy.state.x, y: enemy.state.y, z: enemy.state.z };
      if (vehicle) {
        // The point of the hull nearest the blast, then the feet that put that point at the middle of `height`.
        const skin = towardBy({ x: feet.x, y: feet.y + vehicle.hull.from[1], z: feet.z }, at, vehicle.radiusM);
        feet = { x: skin.x, y: skin.y - height / 2, z: skin.z };
      }
      const raw = blastDamageOn(projectile.def, at, feet, height, this.collisionBoxes);
      const damage = vehicle ? raw * (vehicle.armour.blast[PROJECTILE_IDS[projectile.kind] ?? ''] ?? vehicle.armour.blastDefault) : raw;
      if (damage <= 0) continue;
      const result = applyDamage(enemy.health, damage, nowSeconds, DAMAGE, enemy.def.downable);
      if (result.applied > 0) enemy.lastDamagedAt = nowSeconds;
      if (result.killed) {
        this.killEnemy(enemy);
        const ownerSlot = this.slots.findIndex((s) => s.netId === projectile.ownerNetId);
        this.awardXp(ownerSlot, 'kill', projectile.xpPlayerId);
        this.bumpStat(ownerSlot, 'kills');
      }
      targets.push({ netId: enemy.netId, damage: result.applied });
    }

    // U-057: a blast within `SENSOR_BLAST_KILL_M` destroys any sensor standing there.
    for (const other of this.projectiles) {
      if (projectile.def.blastDamage <= 0) break;
      if (other === projectile || other.def.senseM <= 0 || other.stuck !== true) continue;
      if (Math.hypot(other.state.x - at.x, other.state.y - at.y, other.state.z - at.z) <= SENSOR_BLAST_KILL_M) other.destroyed = true;
    }

    // U-058: a smoke grenade's pop releases its cloud where it stands, and is too quiet to be heard as a blast.
    if (projectile.def.releases !== '') {
      const index = (PROJECTILE_IDS as readonly string[]).indexOf(projectile.def.releases);
      const def = this.projectileDefs[index];
      if (def) {
        this.released.push({
          netId: this.nextProjectileNetId++,
          def,
          kind: index,
          ownerSlot: projectile.ownerSlot,
          ownerNetId: projectile.ownerNetId,
          xpPlayerId: projectile.xpPlayerId,
          state: createProjectileState(at, { x: 0, y: 0, z: 0 }),
          stuck: true,
        });
      }
    }

    // T-3.14: heard at the blast, and a threat from whoever threw it.
    if (projectile.def.releases === '') this.stimuli.push({ kind: 'detonation', at: { x: at.x, y: at.y, z: at.z }, sourceNetId: projectile.ownerNetId });

    // T-3.16: a blast suppresses the other side inside its radius, less with distance.
    const thrower = this.side(projectile.ownerNetId);
    for (const soldier of this.livingSoldiers()) {
      if (!this.hostile(thrower, soldier.side)) continue;
      const centre = soldierCapsule(soldier.state).centre;
      const d = Math.sqrt((centre.x - at.x) ** 2 + (centre.y - at.y) ** 2 + (centre.z - at.z) ** 2);
      // U-056: a concussion grenade's own amount over its own radius; the others use the shared curve.
      const own = projectile.def.suppression;
      const level = own === 0 ? blastSuppression(d) : d < projectile.def.blastRadiusM ? own * (1 - Math.max(0, d) / projectile.def.blastRadiusM) : 0;
      raiseSuppression(soldier.suppression, level, nowSeconds);
    }

    const event: Message = {
      kind: 'Detonation',
      netId: projectile.netId,
      projectile: projectile.kind,
      // The tick this blast belongs to, so a client rendering a hundred
      // milliseconds behind can hold it until it gets there (T-2.33).
      tick: this.currentTick,
      x: at.x,
      y: at.y,
      z: at.z,
      targets,
    };
    for (const c of this.connections) c.send(event);
  }

  /** Advance one authoritative tick and broadcast. */
  step(wallNow: number): void {
    // U-025: while paused the session's clock stands still — the wall time
    // it spends paused is taken off every later step, so ticks, timers, the
    // mission clock and the rewind history all resume where they stopped.
    if (this.lastWallMs !== null && (this.paused || this.incompatibleCampaign)) this.pausedMs += Math.max(0, wallNow - this.lastWallMs);
    this.lastWallMs = wallNow;
    const now = wallNow - this.pausedMs;
    this.nowMs = now;
    for (const conn of [...this.connections]) {
      // Advance each connection's clock BEFORE testing the timeout: messages
      // arriving between ticks are stamped with the latest tick time.
      conn.setNow(now);
      if (conn.isTimedOut(now)) conn.reject('heartbeat timeout');
      // (The code doubles as the text: a client shows exactly that.)
      else if (conn.isExpired(now, this.maxSessionMs)) conn.reject('session limit');
      else if (conn.isIdle(now, this.idleTimeoutMs)) conn.reject('idle');
    }

    // U-025: nobody seated to command the bots: nothing moves until someone is.
    if (this.paused) return;

    if (this.incompatibleCampaign) {
      this.broadcast(this.buildSnapshot());
      return;
    }

    // T-4.19: while waiting, advance time/ticks and send static snapshots, but run no gameplay.
    // Keeping the tick moving preserves the tick*TICK_MS = room-clock invariant used by rewind.
    if (!this.roomStarted) {
      this.currentTick++;
      this.broadcast(this.buildSnapshot());
      return;
    }

    // U-028: a player's reload is done when its clock says, not when they next fire —
    // the magazine the snapshot carries, and the next shot, are the full one.
    for (const slot of this.slots) if (!slot.isBot) finishReload(slot.weapon, slot.weaponState, now / 1000);

    // T-3.32: the encounter's spawns, on mission time (ticks since the session began), before anyone perceives.
    const aiFrom = this.profileAi ? performance.now() : 0;
    if (this.spawnerValue) {
      const seconds = (this.currentTick - this.missionStartTick) * TICK_SECONDS;
      const at = now / 1000;
      const living = this.enemyList.filter((e) => !isDead(e.health) && !e.def.friendly);
      this.directorValue!.sample({
        seconds,
        humans: this.testHumanCount ?? this.slots.filter((s) => !s.isBot).length,
        squadHealth: this.slots.reduce((a, s) => a + s.health.current, 0),
        contact: living.filter((e) => e.target !== null).length,
        suppression: this.slots.reduce((a, s) => a + suppressionLevel(s.suppression, at), 0) / this.slots.length,
      });
      this.eventRun?.step(seconds);
      this.spawnerValue.step(seconds);
    }

    const nowSeconds = now / 1000;
    this.perceive(nowSeconds);
    this.thinkGroups(nowSeconds);
    // T-3.25: where every slot is and is heading, before a bot's brain asks for its place.
    this.formation.update(
      this.slots.map((s) => ({
        index: s.index,
        human: !s.isBot,
        x: s.state.x,
        // U-123: a vaulting soldier stands on its takeoff floor, so neither its trail nor its arrival is a storey of air.
        y: standingY(s.state),
        z: s.state.z,
        yaw: s.yaw,
        speed: this.slotSpeed[s.index] ?? 0,
        sprint: s.input.sprint,
        spread: this.spreadFor(s.index),
      })),
    );
    this.validateCommanderSupplies();
    this.thinkBrains();
    this.driveBots();
    this.enemyHands(nowSeconds);
    this.holdStances();
    if (this.profileAi) this.aiMs += performance.now() - aiFrom;

    for (const slot of this.slots) {
      /**
       * Bleed-out (T-2.13): a downed soldier nobody reached dies here, and
       * stops where they lie, exactly as a finishing shot would stop them.
       */
      if (isDowned(slot.health) && expireBleedOut(slot.health, nowSeconds)) {
        this.bumpStat(slot.index, 'deaths');
        slot.queue.length = 0;
        slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
      }
      /**
       * Dead players do not move and do not fall: they wait out the timer and
       * reappear at their own spawn point with full health. Downed ones fall
       * through to the movement below, where `input.downed` holds them still
       * (B-05).
       */
      if (isDead(slot.health)) {
        // T-3.34: on a mission that does not respawn, the dead wait for a restart.
        if (!this.missionRun && !slot.captured && readyToRespawn(slot.health, nowSeconds)) {
          respawn(slot.health, DAMAGE, nowSeconds);
          this.applyClassHealth(slot);
          const point = this.squadStart(slot.index);
          slot.state = createMoveState(point.x, point.y, point.z);
          slot.queue.length = 0;
          slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
          // U-018: a picked-up gun does not come back with the soldier.
          this.restorePrimary(slot);
          slot.weaponState = createWeaponState(slot.weapon);
          slot.suppression = createSuppression();
          slot.pouch = this.pouchFor(slot.index);
          slot.kits = this.kitsFor(slot.index);
          slot.equipment = this.equipmentFor(slot.index);
          slot.nextThrowAt = 0;
        }
        // Still recorded into the hitbox history below, so a shot already in
        // flight resolves against where the body is.
        continue;
      }

      if (!this.autonomous(slot)) {
        /**
         * Drain a backlog by stepping the extra inputs, not by throwing them
         * away. A burst arrives when the link stutters and then delivers
         * several at once; the player made all of those inputs, so simulating
         * all of them is what keeps the server's story and the client's
         * prediction the same story. Bounded so a backlog cannot become a
         * speed burst.
         */
        let extra = Math.min(MAX_CATCHUP_INPUTS, Math.max(0, slot.queue.length - MAX_INPUT_QUEUE));
        while (extra > 0) {
          const ahead = slot.queue.shift();
          if (!ahead) break;
          slot.input = ahead.input;
          slot.interactHeld = ahead.input.interact === true;
          if (ahead.input.drop === true) slot.dropPending = true;
          slot.cookHeld = ahead.input.cook === true;
          slot.pendingInputTick = ahead.tick;
          slot.staleTicks = 0;
          slot.input.downed = isDowned(slot.health);
          slot.input.speedScale = this.speedScaleOf(slot.index);
          slot.state = this.stepSoldier(slot.netId, slot.state, slot.input);
          extra -= 1;
        }

        const next = slot.queue.shift();
        if (next) {
          slot.input = next.input;
          slot.interactHeld = next.input.interact === true;
          if (next.input.drop === true) slot.dropPending = true;
          slot.cookHeld = next.input.cook === true;
          slot.pendingInputTick = next.tick;
          slot.staleTicks = 0;
        } else {
          /**
           * Nothing buffered: hold still rather than repeating the last input.
           *
           * ADR-012 specified repeat-then-idle, and that was right before
           * inputs were resent. It is wrong now. Horizontal motion in this
           * controller is driven directly by input, so an idle step moves the
           * player almost nowhere, while a REPEATED step moves them another
           * full tick's worth — roughly 0.22 m at sprint — that the client
           * never predicted and must therefore be yanked back from. Repeating
           * was the last remaining source of corrections on an 80 ms / 5% loss
           * link once redundancy was carrying the inputs themselves.
           *
           * The cost is that this player's character pauses for a tick on
           * everyone else's screen instead of gliding on. That is the trade
           * asked for explicitly: smooth for the person with the poor
           * connection, slightly jittery for everyone watching them. A
           * held-then-caught-up character is also more honest than one that
           * keeps running on a guess and then teleports back.
           *
           * `pendingInputTick` deliberately does NOT advance here — the server
           * has consumed nothing, so it has nothing new to acknowledge, and
           * re-acknowledging would make the client reconcile against a state
           * from a moment it cannot match.
           */
          slot.staleTicks++;
          // The interact latch survives this on purpose: an idle tick pauses
          // a revive; only a real release or silence past the window ends it.
          slot.input = idleInput(slot.yaw);
        }
      }
      // Vitality decides movement, not the client: a downed soldier is held
      // still whatever buttons arrive (B-05), and the predictor applies the
      // same rule.
      slot.input.downed = isDowned(slot.health);
      slot.input.speedScale = this.speedScaleOf(slot.index);
      const fromX = slot.state.x;
      const fromZ = slot.state.z;
      // T-4.29: a gunner is held at the gun, crouched, looking within its arc.
      if (slot.mounted) this.pinGunner(slot, slot.mounted);
      slot.state = this.stepSoldier(slot.netId, slot.state, slot.input);
      if (slot.mounted) {
        slot.state.x = slot.mounted.place.x;
        slot.state.z = slot.mounted.place.z;
      }
      const moved = Math.sqrt((slot.state.x - fromX) ** 2 + (slot.state.z - fromZ) ** 2) / TICK_SECONDS;
      this.slotSpeed[slot.index] = moved;
      // T-3.14: a soldier running faster than a walk is heard where they are
      // (past the midpoint of walk and sprint, so a walk's rounding never counts).
      if (slot.input.sprint && moved > (this.moveConfig.walkSpeed + this.moveConfig.sprintSpeed) / 2) {
        this.stimuli.push({ kind: 'sprint', at: { x: slot.state.x, y: slot.state.y, z: slot.state.z }, sourceNetId: slot.netId });
      }
      /**
       * Recover weapon bloom, every tick, for every slot.
       *
       * Firing ADDS bloom and only this takes it away. Without it the server's
       * cone climbs to the weapon's maximum within a few shots and stays pinned
       * there for the rest of the session — every weapon permanently at its
       * worst accuracy. The client decays its own copy correctly, so the HUD
       * goes on reporting the small cone while the authoritative shots use the
       * large one: the divergence is invisible from inside the game and shows
       * up only as "the guns got worse".
       */
      decayBloom(slot.weapon, slot.weaponState, TICK_SECONDS);
      // U-030: a downed body keeps the heading it fell with.
      if (!isDowned(slot.health)) slot.yaw = slot.input.yaw;
      // Consumed now, so this is what the client may stop replaying.
      slot.lastProcessedInputTick = slot.pendingInputTick;
    }

    // Resolve revive interaction after consuming this tick's input, so a newly pressed E starts immediately.
    this.updateRevives();
    // T-4.29: mounting and dismounting, after the revive has had first claim on the same press.
    this.updateCooking(nowSeconds);
    this.updateKits();
    this.updateMounts(nowSeconds);
    // U-010: the enemy at the upload's lever.
    this.updateLever(nowSeconds);
    // U-062: enemies taking downed characters prisoner.
    this.updateCaptures(nowSeconds);
    // U-017: weapons on the ground past their time.
    this.expirePickups(nowSeconds);

    const walkFrom = this.profileAi ? performance.now() : 0;
    this.stepEnemies(nowSeconds);
    if (this.profileAi) this.aiMs += performance.now() - walkFrom;

    // Record AFTER stepping, so the history holds the post-tick positions that
    // the snapshot about to go out will describe. Recording pre-step would
    // rewind clients to a world half a tick behind the one they were shown.
    for (const slot of this.slots) {
      this.hitboxes.record(slot.netId, now, slot.state.x, slot.state.y, slot.state.z, slot.state.crouched, slot.state.prone, lyingPose(slot));
    }
    /**
     * The range targets are shootable too. They never move, but they are
     * recorded on the same schedule as everything else rather than special-cased
     * into the trace: one code path means a rewound shot resolves against them
     * identically, and means they stop being special the moment something makes
     * them move (M2 gives them AI).
     */
    for (const target of RANGE_TARGETS) {
      this.hitboxes.record(target.netId, now, target.x, target.y, target.z);
    }
    /**
     * Enemies on the same schedule (T-3.10), corpses included — a shot already
     * in flight resolves against where the body lies, as a slot's does — so a
     * human's rewound shot resolves against an enemy exactly as against a slot.
     */
    for (const enemy of this.enemyList) {
      this.hitboxes.record(enemy.netId, now, enemy.state.x, enemy.state.y, enemy.state.z, enemy.state.crouched, enemy.state.prone, lyingPose(enemy));
    }

    // After everyone has moved and been recorded: an AI shoots at this tick's world.
    const fireFrom = this.profileAi ? performance.now() : 0;
    this.fireEnemies(nowSeconds);
    // U-068: and the tanks, from their turrets.
    this.fireTanks(nowSeconds);
    if (this.profileAi) this.aiMs += performance.now() - fireFrom;

    this.currentTick++;
    // T-4.28: the scoreboard's clock keeps up while a mission runs, five seconds at a time.
    if (this.missionRun && this.missionRun.current.state === 'progress' && this.currentTick % 150 === 0) this.broadcastStats();
    /**
     * Projectiles fly LAST, after the bodies have moved and been recorded and
     * after the tick has advanced. Both halves matter: a rocket meets the
     * soldiers where this tick left them, and a detonation names the tick of
     * the snapshot it is announced alongside — the same snapshot the projectile
     * despawns from, so a client is never told a grenade went off in a world
     * where it is still in the air.
     */
    this.stepProjectiles();
    this.expireMarks();
    this.updateSensors();
    this.stepMission();
    this.updateSupplies();
    const snapshot = this.buildSnapshot();
    this.broadcast(snapshot);
    this.sendAiDebug();
  }

  /**
   * Hearing and sight (T-3.14), before brains think so a brain acts on this
   * tick's knowledge.
   *
   * Every living enemy hears, every tick, each stimulus since the last step
   * that a squad slot made within its kind's radius of its ears. On its think
   * tick it also looks: T-3.13 awareness of each living slot is stepped by
   * the think period, a detected, visible slot is remembered as seen, a dead
   * one is forgotten (it will respawn somewhere else), and target choice runs
   * over what memory then holds.
   */
  private perceive(nowSeconds: number): void {
    const heard = this.stimuli.splice(0);
    if (this.enemyList.length === 0) return;
    const squad = heard.filter((s) => this.slots.some((slot) => slot.netId === s.sourceNetId));
    const dt = BRAIN_PERIOD_TICKS * TICK_SECONDS;
    // What an enemy can see and shoot at: the six slots, and (U-075) an escorted character on the squad's side.
    const sightable = [
      ...this.slots.map((slot) => ({
        netId: slot.netId,
        state: slot.state,
        health: slot.health,
        speed: this.slotSpeed[slot.index] ?? 0,
        firing: this.currentTick - (this.lastFiredTick[slot.index] ?? -Infinity) <= BRAIN_PERIOD_TICKS,
      })),
      ...this.enemyList
        .filter((e) => e.def.friendly)
        .map((e) => ({
          netId: e.netId,
          state: e.state,
          health: e.health,
          speed: e.speed,
          firing: false,
        })),
    ];
    for (const enemy of this.enemyList) {
      if (enemy.inactive || isDead(enemy.health) || enemy.def.friendly) continue;
      const eye = eyePosition(enemy.state.x, enemy.state.y, enemy.state.z, DEFAULT_MUZZLE_RIG, eyeStance(false, enemy.state.prone));
      for (const stimulus of squad) if (hears(eye, stimulus)) rememberHeard(enemy.memory, stimulus, nowSeconds);
      if (!enemy.brain?.due(this.currentTick)) continue;

      beginThink(enemy.memory, nowSeconds);
      const perception = enemy.def.perception;
      const observer = { eye, yaw: wireToTable(enemy.yaw) };
      for (const other of sightable) {
        if (isDead(other.health)) {
          forgetTarget(enemy.memory, other.netId);
          enemy.awareness.delete(other.netId);
          continue;
        }
        const target = {
          feet: { x: other.state.x, y: other.state.y, z: other.state.z },
          stance: other.state.prone ? ('prone' as const) : other.state.crouched ? ('crouched' as const) : ('standing' as const),
          speed: other.speed,
          firing: other.firing,
        };
        const sighting = sight(observer, target, this.collisionBoxes, perception, this.moveConfig, undefined, this.smokeClouds());
        const awareness = stepAwareness(enemy.awareness.get(other.netId) ?? 0, sighting, target, perception, dt);
        enemy.awareness.set(other.netId, awareness);
        if (sighting.visible && isDetected(awareness, perception)) {
          rememberSeen(enemy.memory, other.netId, target.feet, nowSeconds, isDowned(other.health));
        }
        // U-031: a soldier who is down is down whether or not it is in sight this think, and stops being a target.
        const known = enemy.memory.entries.get(other.netId);
        if (known) known.downed = isDowned(other.health);
      }
      enemy.target = chooseTarget(enemy.memory, enemy.state, nowSeconds);
      watchStill(enemy.still, enemy.target, enemy.memory, enemy.state.y, nowSeconds);
    }
    if (this.botsDriven) this.perceiveForBots(heard, nowSeconds);
  }

  /**
   * T-3.26: a friendly bot's hearing and sight, the enemies' turned round: it
   * hears the enemy's rounds and sees enemies by its archetype's perception
   * (`squad.json` bot.archetype), into its own memory and target.
   */
  private perceiveForBots(heard: readonly Stimulus[], nowSeconds: number): void {
    const hostile = heard.filter((s) => this.enemyList.some((e) => e.netId === s.sourceNetId && !e.def.friendly));
    const dt = BRAIN_PERIOD_TICKS * TICK_SECONDS;
    const perception = BOT_ARCHETYPE.perception;
    for (const slot of this.slots) {
      if (!this.autonomous(slot) || !slot.brain || !isAlive(slot.health)) continue;
      const eye = eyePosition(slot.state.x, slot.state.y, slot.state.z, DEFAULT_MUZZLE_RIG, eyeStance(false, slot.state.prone));
      for (const stimulus of hostile) if (hears(eye, stimulus)) rememberHeard(slot.memory, stimulus, nowSeconds);
      if (!slot.brain.due(this.currentTick)) continue;
      beginThink(slot.memory, nowSeconds);
      const observer = { eye, yaw: wireToTable(slot.yaw) };
      for (const enemy of this.enemyList) {
        if (enemy.def.friendly) continue;
        if (isDead(enemy.health)) {
          forgetTarget(slot.memory, enemy.netId);
          slot.awareness.delete(enemy.netId);
          continue;
        }
        const target = {
          feet: { x: enemy.state.x, y: enemy.state.y, z: enemy.state.z },
          stance: enemy.state.prone ? ('prone' as const) : enemy.state.crouched ? ('crouched' as const) : ('standing' as const),
          speed: enemy.speed,
          firing: this.currentTick - (this.enemyFiredTick.get(enemy.netId) ?? -Infinity) <= BRAIN_PERIOD_TICKS,
        };
        const sighting = sight(observer, target, this.collisionBoxes, perception, this.moveConfig);
        const awareness = stepAwareness(slot.awareness.get(enemy.netId) ?? 0, sighting, target, perception, dt);
        slot.awareness.set(enemy.netId, awareness);
        if (sighting.visible && isDetected(awareness, perception)) rememberSeen(slot.memory, enemy.netId, target.feet, nowSeconds, false);
      }
      slot.target = this.botTarget(slot, nowSeconds);
      watchStill(slot.still, slot.target, slot.memory, slot.state.y, nowSeconds);
    }
  }

  /**
   * A fighting brain's stance and hands, onto its input (T-3.20): the crouch
   * it holds, a reload it asks for, and the point it faces while it walks —
   * strafing towards its goal rather than turning its back on the threat, the
   * move turned so the ground covered is the path follower's. Not mid-vault:
   * a vault is walked straight at the wall. And its cover reservation is kept
   * honest: released once it has left the point, or died.
   */
  private enemyHands(nowSeconds: number): void {
    for (const enemy of this.enemyList) {
      const alive = !isDead(enemy.health);
      this.cover?.track(enemy.netId, enemy.state, alive);
      if (alive && !enemy.inactive && enemy.brain) this.aiHands(enemy, NO_SLOT, enemy.follower?.onVault ?? false, nowSeconds);
    }
    // T-3.26: friendly bots' hands the same way, when they run a tree that uses them.
    if (!this.botsDriven) return;
    for (const slot of this.slots) {
      if (!this.autonomous(slot)) continue;
      const able = isAlive(slot.health);
      this.cover?.track(slot.netId, slot.state, able);
      if (able && slot.brain && !this.commanderUsingSupply(slot)) this.aiHands(slot, slot.index, this.followers[slot.index]?.onVault ?? false, nowSeconds);
    }
  }

  /** One AI soldier's stance, reload, throw and gaze onto its input (`enemyHands`). */
  private aiHands(body: AiBody, ownerSlot: number, onVault: boolean, nowSeconds: number): void {
    const brain = body.brain!;
    body.input.crouch = brain.read('crouch');
    // Settle a reload that has just finished before asking for another, or
    // a request still standing on the finishing tick restarts it unfilled.
    finishReload(body.weapon, body.weaponState, nowSeconds);
    if (brain.read('reload')) startReload(body.weapon, body.weaponState, nowSeconds);
    // A throw it asked for on this think, made once (T-3.22). Mid-vault the
    // hands are on the wall, as for a player; it faces the way it threw.
    // U-079: a bot's word to set off the charges it has out, the human's detonator.
    const detonate = brain.take('detonate');
    const caster = ownerSlot === NO_SLOT ? undefined : this.slots[ownerSlot];
    if (detonate !== null && caster && isAlive(caster.health) && this.canBotEngage(caster.index, caster.target)) this.detonateCharges(caster, detonate);
    const toss = brain.take('throwAt');
    if (toss && (ownerSlot === NO_SLOT || this.canBotEngage(ownerSlot, this.slots[ownerSlot]?.target ?? null)) && !body.state.vault && this.launch(body, ownerSlot, toss.projectile, toss.yaw, toss.pitch)) {
      body.yaw = tableToWire(toss.yaw);
      body.input.yaw = body.yaw;
      body.pitch = tableToWire(toss.pitch);
    }
    const look = brain.read('lookAt');
    if (!look || body.state.vault || onVault) return;
    const dx = look.x - body.state.x;
    const dz = look.z - body.state.z;
    if (dx * dx + dz * dz < 1e-6) return;
    const input = body.input;
    const from = (input.yaw / 1024) * Math.PI * 2;
    // World direction of the move (the controller's frame: forward (sin, cos), right (−cos, sin)).
    const wx = input.moveY * Math.sin(from) - input.moveX * Math.cos(from);
    const wz = input.moveY * Math.cos(from) + input.moveX * Math.sin(from);
    const yaw = ((Math.round((Math.atan2(dx, dz) / (Math.PI * 2)) * 1024) % 1024) + 1024) % 1024;
    const to = (yaw / 1024) * Math.PI * 2;
    input.moveY = wx * Math.sin(to) + wz * Math.cos(to);
    input.moveX = -wx * Math.cos(to) + wz * Math.sin(to);
    input.yaw = yaw;
    // Sprinting is forward only: a strafe is a walk.
    if (input.sprint && input.moveY < 0.7) input.sprint = false;
  }

  /** U-079: every living armoured vehicle, as the bots' combat world shows it. */
  private armourViews(): ArmourView[] {
    const out: ArmourView[] = [];
    for (const enemy of this.enemyList) {
      const vehicle = enemy.def.vehicle;
      if (!vehicle || isDead(enemy.health)) continue;
      const heading = wireToTable(enemy.yaw);
      const mid = (vehicle.hull.from[1] + vehicle.hull.to[1]) / 2;
      out.push({
        netId: enemy.netId,
        x: enemy.state.x,
        y: enemy.state.y,
        z: enemy.state.z,
        centre: { x: enemy.state.x, y: enemy.state.y + mid, z: enemy.state.z },
        radiusM: vehicle.hull.radius,
        headingX: sin(heading),
        headingZ: cos(heading),
        speedMps: enemy.speed,
        tell: enemy.tell ? { until: enemy.tell.until, point: { ...enemy.tell.point } } : null,
        shellBlastM: vehicle.cannon.blastRadiusM,
        muzzle: this.turretPoint(enemy, vehicle.cannon.muzzle),
      });
    }
    return out;
  }

  /** U-068: a point on a tank's turret (`[right, up, forward]` from its feet), turning with the turret. */
  private turretPoint(enemy: EnemyEntity, offset: readonly [number, number, number]): { x: number; y: number; z: number } {
    const a = wireToTable(enemy.turretYaw);
    const fx = sin(a);
    const fz = cos(a);
    return { x: enemy.state.x - offset[0] * fz + offset[2] * fx, y: enemy.state.y + offset[1], z: enemy.state.z + offset[0] * fx + offset[2] * fz };
  }

  /**
   * U-068: every living tank's turret, cannon and machine gun, each tick.
   *
   * The target is the nearest standing squad soldier in range with a clear line from the muzzle (so never one it
   * could not hit through cover, nor one who is down or held prisoner). The turret turns to it, at its own rate and
   * apart from the hull, or back to the hull's heading with nobody to shoot. Only while it is at a firing position or
   * crawling (`fireMaxSpeedMps`) and the turret is on the bearing does anything fire.
   *
   * The machine gun is the tank's own weapon in the archetype's bursts. The cannon first LOCKS: the turret holds a
   * point for `tellSeconds` (replicated as `aiming`, for the muzzle flash and the warning) and the shell goes at that
   * point, not at wherever the target has moved to: a squad that moves in the tell is missed, which is the counterplay.
   * Then it waits out its interval.
   */
  private fireTanks(nowSeconds: number): void {
    for (const enemy of this.enemyList) {
      const vehicle = enemy.def.vehicle;
      if (!vehicle) continue;
      if (enemy.inactive) continue;
      if (isDead(enemy.health)) {
        enemy.tell = null;
        continue;
      }
      // U-069: a tank on its way out holds its fire.
      if (enemy.drive?.withdrawing) {
        enemy.tell = null;
        continue;
      }
      const cannon = vehicle.cannon;
      const eye = this.turretPoint(enemy, vehicle.machineGun.muzzle);

      // The tell holds its target; otherwise the nearest one it can see.
      let target: Slot | null = null;
      let point: { x: number; y: number; z: number } | null = null;
      if (enemy.tell) {
        const locked = this.slots.find((s) => s.netId === enemy.tell!.netId);
        if (locked && isAlive(locked.health)) {
          target = locked;
          point = enemy.tell.point;
        } else enemy.tell = null;
      }
      if (!target) {
        let bestD = cannon.rangeM * cannon.rangeM;
        for (const slot of this.slots) {
          if (!isAlive(slot.health)) continue;
          const d = (slot.state.x - enemy.state.x) ** 2 + (slot.state.z - enemy.state.z) ** 2;
          if (d >= bestD) continue;
          const seen = visibleAimPoint(eye, aimPoints(slot.state, slot.state.crouched, slot.state.prone, DEFAULT_HITBOX, lyingPose(slot)), this.collisionBoxes);
          if (!seen) continue;
          bestD = d;
          target = slot;
          point = seen;
        }
      }

      // The turret: onto the target's bearing, or back to the hull's.
      const wantYaw = point ? tableToWire(aimAngles(eye, point).yaw) : enemy.yaw;
      const rate = Math.max(1, Math.round(((vehicle.turretTurnDegPerSec / 360) * 1024) * TICK_SECONDS));
      const off = ((wantYaw - enemy.turretYaw + 1536) & 1023) - 512;
      enemy.turretYaw = (enemy.turretYaw + Math.max(-rate, Math.min(rate, off)) + 1024) & 1023;
      const remaining = Math.abs(((wantYaw - enemy.turretYaw + 1536) & 1023) - 512);
      const aligned = (deg: number): boolean => remaining <= (deg / 360) * 1024;

      const steady = enemy.speed <= vehicle.fireMaxSpeedMps;
      if (!target || !point || !steady) {
        if (!steady) enemy.tell = null;
        enemy.aim = null;
        continue;
      }
      if (!enemy.aim || enemy.aim.netId !== target.netId) enemy.aim = { netId: target.netId, since: nowSeconds };
      const range = Math.sqrt((point.x - eye.x) ** 2 + (point.y - eye.y) ** 2 + (point.z - eye.z) ** 2);

      // The cannon: lock, hold, fire at the locked point, wait.
      if (enemy.tell) {
        if (nowSeconds >= enemy.tell.until) {
          this.fireShell(enemy, vehicle, enemy.tell.point);
          enemy.tell = null;
          enemy.cannonReadyAt = nowSeconds + cannon.intervalSeconds;
        }
      } else if (nowSeconds >= enemy.cannonReadyAt && aligned(cannon.alignDeg)) {
        enemy.tell = { until: nowSeconds + cannon.tellSeconds, netId: target.netId, point: { ...point } };
      }

      // The machine gun: bursts on sight inside its range, the turret on the bearing.
      if (range <= vehicle.machineGun.rangeM && aligned(vehicle.machineGun.alignDeg)) this.fireTankGun(enemy, vehicle, target, eye, point, range, nowSeconds);
    }
  }

  /** U-068: one tick of a tank's coaxial gun, by the archetype's burst discipline and aim error (as `aiShoot`, but the hull does not turn to it). */
  private fireTankGun(enemy: EnemyEntity, vehicle: EnemyVehicle, target: Slot, eye: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }, range: number, nowSeconds: number): void {
    const accuracy = enemy.def.accuracy;
    const ws = enemy.weaponState;
    finishReload(enemy.weapon, ws, nowSeconds);
    if (ws.ammo === 0) startReload(enemy.weapon, ws, nowSeconds);
    if (ws.bloomUnits > degToAngle(accuracy.holdBloomDeg) || nowSeconds < enemy.burst.pauseUntil) return;
    const line = aimAngles(eye, point);
    const cone = aimConeDeg(accuracy, {
      distanceM: range,
      targetSpeedMps: this.slotSpeed[target.index] ?? 0,
      suppression: suppressionLevel(enemy.suppression, nowSeconds),
      timeOnTargetSeconds: nowSeconds - (enemy.aim?.since ?? nowSeconds),
    });
    const aimed = aimError(line.yaw, line.pitch, cone, aimSeed(this.currentTick, enemy.netId, ws.shotIndex));
    const shot = tryFire(enemy.weapon, ws, nowSeconds, true, false);
    if (shot === null) return;
    if (++enemy.burst.rounds >= accuracy.burstRounds) {
      enemy.burst.rounds = 0;
      enemy.burst.pauseUntil = nowSeconds + accuracy.burstPauseSeconds;
    }
    this.enemyFiredTick.set(enemy.netId, this.currentTick);
    this.traceShot(enemy.netId, enemy.weapon, shot, this.currentTick, eye, aimed.yaw, aimed.pitch, this.nowMs);
    if (ws.ammo === 0) startReload(enemy.weapon, ws, nowSeconds);
  }

  /** U-068: the cannon's shell leaves the barrel for a point, with the projectile row's look and the tank's own numbers. */
  private fireShell(enemy: EnemyEntity, vehicle: EnemyVehicle, at: { x: number; y: number; z: number }): void {
    const cannon = vehicle.cannon;
    const index = (PROJECTILE_IDS as readonly string[]).indexOf(cannon.projectile);
    const base = this.projectileDefs[index];
    if (!base || this.projectiles.length >= MAX_PROJECTILES) return;
    const def: ProjectileDef = { ...base, speedMPerSec: cannon.speedMPerSec, blastDamage: cannon.blastDamage, blastRadiusM: cannon.blastRadiusM };
    const origin = this.turretPoint(enemy, cannon.muzzle);
    const dx = at.x - origin.x;
    const dz = at.z - origin.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    // Aim high by the drop over the flight, so the shell arrives where the barrel was laid.
    const seconds = flat / cannon.speedMPerSec;
    const dy = at.y + 0.5 * def.gravity * seconds * seconds - origin.y;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length <= 1e-6) return;
    const v = cannon.speedMPerSec / length;
    this.projectiles.push({
      netId: this.nextProjectileNetId++,
      def,
      kind: index,
      ownerSlot: NO_SLOT,
      ownerNetId: enemy.netId,
      xpPlayerId: null,
      state: createProjectileState(origin, { x: dx * v, y: dy * v, z: dz * v }),
    });
    this.stimuli.push({ kind: 'shot', at: origin, sourceNetId: enemy.netId });
  }

  /**
   * AI trigger pulls (T-3.15), every tick, for every living enemy whose brain
   * names someone to shoot.
   *
   * It fires through the human path: the archetype's `WeaponDef`, `tryFire`'s
   * cadence, magazine and reload, the weapon's bloom and aimed cone, and
   * `traceShot`'s damage and `HitEvent` — with no rewind, since it sees the
   * present. What it adds is the aim: a point on the target it can see (never
   * one behind a wall), the true line to it, and the archetype's aim error
   * around that line. Losing sight, or changing target, starts time on target
   * again. An empty magazine starts a reload the moment it empties, whether
   * or not it goes on shooting.
   */
  private fireEnemies(nowSeconds: number): void {
    for (const enemy of this.enemyList) {
      if (enemy.inactive || isDead(enemy.health)) continue;
      // U-068: a tank fights with its own turret (`fireTanks`), not a soldier's hands.
      if (enemy.def.vehicle) continue;
      // T-4.29: a mounted gun is deployed by nature, and fires with the gun's numbers from the gun's muzzle.
      if (this.aiShoot(enemy, enemy.def.accuracy, enemy.mounted !== null || this.deployed(enemy, nowSeconds), false, nowSeconds, enemy.mounted)) this.enemyFiredTick.set(enemy.netId, this.currentTick);
    }
    // T-3.26: friendly bots fire by the same path, holding fire while a squadmate is on the line.
    if (!this.botsDriven) return;
    for (const slot of this.slots) {
      if (!this.autonomous(slot) || !slot.brain || !isAlive(slot.health) || this.commanderUsingSupply(slot)) continue;
      if (this.canBotEngage(slot.index, slot.brain.fireAt ?? slot.target) && this.aiShoot(slot, BOT_ARCHETYPE.accuracy, true, true, nowSeconds)) this.lastFiredTick[slot.index] = this.currentTick;
    }
  }

  /**
   * One AI soldier's trigger this tick (`fireEnemies`); true when a round left
   * the gun. `mayFire` false aims without firing (an MG not yet deployed);
   * `spareFriends` holds fire while a squadmate's capsule, grown by
   * `bot.friendlyMarginM`, is on the line to the aim point (T-3.26).
   */
  private aiShoot(shooter: AiBody, accuracy: EnemyAccuracy, mayFire: boolean, spareFriends: boolean, nowSeconds: number, gun: EmplacementEntity | null = null): boolean {
    // T-4.29: on a gun, the gun's weapon, belt and muzzle; the shooter's own otherwise.
    const weapon = gun ? gun.weapon : shooter.weapon;
    const ws = gun ? gun.weaponState : shooter.weaponState;
    finishReload(weapon, ws, nowSeconds);
    if (ws.ammo === 0) startReload(weapon, ws, nowSeconds);

    // Mid-vault both hands are on the wall, for an AI as for a player (T-2.21).
    if (shooter.state.vault) return false;
    // Its own eye in its own stance: crouched behind low cover it sees (and
    // shoots) over nothing a crouched head would not (T-3.20).
    const eye = gun ? gun.muzzle : soldierEye(shooter.state);
    const targetId = shooter.brain?.fireAt ?? null;
    const target = targetId === null ? null : this.soldier(targetId);
    // U-031: nor at a soldier who is down, even if the brain still names it before its next think.
    const shootable = target && target.netId !== shooter.netId && isAlive(target.health) ? target : null;
    let point = shootable ? visibleAimPoint(eye, aimPoints(shootable.state, shootable.state.crouched, shootable.state.prone, DEFAULT_HITBOX, lyingPose(shootable)), this.collisionBoxes) : null;
    let aimAt = shootable?.netId ?? SUPPRESSIVE_AIM;
    // No line of sight, no shot — except suppressive fire (T-3.21): a brain
    // with nobody to shoot at but a point to keep heads down at fires there,
    // through whatever is in the way, by every other rule a shot follows.
    if (!point && targetId === null) {
      point = shooter.brain?.read('suppressAt') ?? null;
      aimAt = SUPPRESSIVE_AIM;
    }
    if (!point) {
      shooter.aim = null;
      return false;
    }
    if (!shooter.aim || shooter.aim.netId !== aimAt) shooter.aim = { netId: aimAt, since: nowSeconds };

    const line = aimAngles(eye, point);
    /**
     * T-4.29: a mounted gun traverses and elevates only so far. A target
     * outside the arc is not shot at: the gun is laid on the nearer stop, and
     * an AI gunner whose target stays outside the arc for the data's seconds
     * gets off the gun and fights on foot.
     */
    if (gun) {
      const yawWire = tableToWire(line.yaw);
      const pitchWire = tableToWire(line.pitch);
      const inArc = withinArc(gun.facing, yawWire, gun.def.traverseDeg) && clampPitch(pitchWire, gun.def) === signedWire(pitchWire);
      if (inArc) gun.outOfArcSince = null;
      else {
        gun.outOfArcSince ??= nowSeconds;
        gun.yaw = clampYawToArc(gun.facing, yawWire, gun.def.traverseDeg);
        gun.pitch = clampPitch(pitchWire, gun.def) & 0x3ff;
        shooter.yaw = gun.yaw;
        shooter.input.yaw = gun.yaw;
        shooter.pitch = gun.pitch;
        if (nowSeconds - gun.outOfArcSince >= gun.def.ai.leaveAfterSeconds) {
          const gunner = this.enemyList.find((e) => e.mounted === gun);
          if (gunner) this.dismountEnemy(gunner);
        }
        return false;
      }
    }
    // It faces what it shoots at, and the snapshot says so.
    shooter.yaw = tableToWire(line.yaw);
    shooter.input.yaw = shooter.yaw;
    shooter.pitch = tableToWire(line.pitch);

    // T-3.23: a gun that deploys is aimed but not fired until it has been still its deploy time.
    if (!mayFire) return false;
    // T-3.26: never through a squadmate.
    if (spareFriends && this.friendOnLine(shooter.netId, eye, point)) return false;
    // Trigger discipline: a burst, then wait for the gun to settle — and a
    // burst of the archetype's length, then a pause (T-3.23).
    if (ws.bloomUnits > degToAngle(accuracy.holdBloomDeg)) return false;
    if (nowSeconds < shooter.burst.pauseUntil) return false;
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cone = aimConeDeg(accuracy, {
      distanceM: range,
      targetSpeedMps: aimAt === SUPPRESSIVE_AIM ? 0 : (shootable?.speed ?? 0),
      suppression: suppressionLevel(shooter.suppression, nowSeconds),
      timeOnTargetSeconds: nowSeconds - shooter.aim.since,
    });
    // The round's own aim error, drawn from the seed the shot about to go will carry.
    const aimed = aimError(line.yaw, line.pitch, cone, aimSeed(this.currentTick, shooter.netId, ws.shotIndex));
    // Nor a round the aim error would throw into one: that round is held, and
    // the next tick draws another.
    if (spareFriends && this.friendOnLine(shooter.netId, eye, along(eye, aimed, range))) return false;
    // T-4.29: an overheated gun does not fire, whoever is on it.
    if (gun && !canFireHot(gun.heat)) return false;
    const shot = tryFire(weapon, ws, nowSeconds, true, gun ? false : shooter.state.prone);
    if (shot === null) return false;
    if (gun) {
      heatShot(gun.def, gun.heat);
      gun.yaw = clampYawToArc(gun.facing, tableToWire(aimed.yaw), gun.def.traverseDeg);
      gun.pitch = clampPitch(tableToWire(aimed.pitch), gun.def) & 0x3ff;
    }
    if (++shooter.burst.rounds >= accuracy.burstRounds) {
      shooter.burst.rounds = 0;
      shooter.burst.pauseUntil = nowSeconds + accuracy.burstPauseSeconds;
    }

    this.traceShot(shooter.netId, weapon, shot, this.currentTick, eye, aimed.yaw, aimed.pitch, this.nowMs);
    // The last round out starts the reload on the same tick.
    if (ws.ammo === 0) startReload(weapon, ws, nowSeconds);
    return true;
  }

  /** Whether a living squadmate's capsule, grown by `bot.friendlyMarginM`, crosses the segment `eye` → `point` (T-3.26). */
  friendOnLine(shooterNetId: number, eye: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }): boolean {
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-6) return false;
    const ray = { origin: eye, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length };
    for (const slot of this.slots) {
      if (slot.netId === shooterNetId || isDead(slot.health)) continue;
      // Cautious: the posed body where the friend is drawn, and the upright
      // capsule round where they stand, each grown by the margin. A bot holds
      // fire for either.
      const margin = SQUAD_CONFIG.bot.friendlyMarginM;
      const parts = bodyParts(DEFAULT_HITBOX, bodyStance(slot.state.crouched, slot.state.prone, lyingPose(slot).lying), slot.state, slot.yaw);
      if (rayBody(ray, parts, margin) !== null) return true;
      const capsule = soldierCapsule(slot.state);
      if (rayCapsule(ray, capsule.centre, capsule.radius + margin, capsule.halfHeight + margin) !== null) return true;
    }
    return false;
  }

  /** Whether an enemy may fire as far as deploying goes (T-3.23): always, for an archetype that does not deploy. */
  deployed(enemy: EnemyEntity, nowSeconds = this.nowMs / 1000): boolean {
    const deploy = enemy.def.deploy;
    return !deploy || (enemy.deployedAt !== null && nowSeconds - enemy.deployedAt >= deploy.seconds - 1e-9);
  }

  /** A slot or an enemy by netId, as much of it as a shooter aims with. */
  private soldier(netId: number): { netId: number; state: MoveState; health: HealthState; speed: number; yaw: number } | null {
    const slot = this.slots.find((s) => s.netId === netId);
    if (slot) return { netId, state: slot.state, health: slot.health, speed: this.slotSpeed[slot.index] ?? 0, yaw: slot.yaw };
    const enemy = this.enemyList.find((e) => e.netId === netId);
    return enemy ? { netId, state: enemy.state, health: enemy.health, speed: enemy.speed, yaw: enemy.yaw } : null;
  }

  /**
   * 10 Hz brains (T-3.08): each on the tick its netId's phase names, so the
   * six are spread two to a tick rather than all landing on one.
   */
  private thinkBrains(): void {
    for (const slot of this.slots) {
      if (this.commanderUsingSupply(slot)) continue;
      if (slot.brain?.due(this.currentTick)) {
        // U-053: holding a kit's use is asked afresh each think, so a branch that pre-empts the heal lets go of it.
        slot.brain.take('useKit');
        // U-153: and rising from a held stance, so a branch that pre-empts a revive or heal lies down again.
        slot.brain.take('rise');
        slot.brain.think(this.currentTick);
      }
    }
    // Enemies' netIds are consecutive, so they spread over the phases too.
    for (const enemy of this.enemyList) {
      // However it died, a dead enemy's brain is stopped before it can think.
      if (isDead(enemy.health)) {
        if (enemy.brain && !enemy.brain.isStopped) this.killEnemy(enemy);
        continue;
      }
      if (!enemy.inactive && enemy.brain?.due(this.currentTick)) enemy.brain.think(this.currentTick);
    }
  }

  /**
   * U-067: one tick of a tank's driving (`stepDrive`). It may stand only where the hull clears every wall and every
   * script blocker (three footprints along its length), and not on a living soldier: it waits for either to go and
   * does not push through or run anyone over.
   */
  private driveTank(enemy: EnemyEntity, drive: VehicleDrive, vehicle: EnemyVehicle): void {
    const heightAware = drive.origin?.y !== undefined || drive.path.some((p) => p.y !== undefined);
    let supportedY = enemy.state.y;
    const clear = (x: number, z: number, forward: { x: number; z: number }, intendedY = enemy.state.y): boolean => {
      let y = enemy.state.y;
      if (heightAware) {
        const support = vehicleSupport({ x, y: intendedY, z }, forward, vehicle, this.collisionBoxes, this.moveConfig.groundY, VEHICLE_STEP_M);
        if (support === null || Math.abs(support - enemy.state.y) > this.moveConfig.stepHeight) return false;
        y = support;
      } else {
        const half = vehicle.hull.radius + .1;
        const reach = Math.abs(vehicle.hull.to[2] - vehicle.hull.from[2]) / 2;
        for (const along of [0, reach, -reach]) if (blockedAt(x + forward.x * along, z + forward.z * along, half, y, this.moveConfig.stepHeight, VEHICLE_CLEARANCE_M, this.collisionBoxes)) return false;
      }
      const margin = vehicle.radiusM + 0.4;
      const height = Math.max(vehicle.hull.to[1] + vehicle.hull.radius, vehicle.turret.to[1] + vehicle.turret.radius);
      if (this.slots.some((s) => !isDead(s.health) && s.state.y < y + height && s.state.y + this.moveConfig.height > y && (s.state.x - x) ** 2 + (s.state.z - z) ** 2 < margin * margin)) return false;
      supportedY = y;
      return true;
    };
    const to = stepDrive({ x: enemy.state.x, y: enemy.state.y, z: enemy.state.z }, drive, vehicle, TICK_SECONDS, clear);
    enemy.state = { ...enemy.state, x: to.x, y: supportedY, z: to.z };
    enemy.yaw = driveYawWire(drive);
    enemy.input = { ...enemy.input, yaw: enemy.yaw, moveX: 0, moveY: 0 };
  }

  /**
   * Step every living enemy through `stepCharacter` with the input its brain's
   * intent produced (or an idle one), and take away corpses whose time is up.
   * A corpse is not stepped: like a dead slot it lies where it fell.
   */
  private stepEnemies(nowSeconds: number): void {
    let expired = false;
    for (const enemy of this.enemyList) {
      if (isDead(enemy.health)) {
        if (nowSeconds - (enemy.health.diedAt as number) >= enemy.def.corpseSeconds) expired = true;
        continue;
      }
      enemy.input.downed = false;
      if (enemy.inactive) { enemy.speed = 0; continue; }
      const fromX = enemy.state.x;
      const fromZ = enemy.state.z;
      // U-067: a tank drives its path; it does not walk on a soldier's controller.
      if (enemy.def.vehicle) {
        if (!enemy.drive) { enemy.speed = 0; continue; }
        this.driveTank(enemy, enemy.drive, enemy.def.vehicle);
        enemy.speed = Math.sqrt((enemy.state.x - fromX) ** 2 + (enemy.state.z - fromZ) ** 2) / TICK_SECONDS;
        decayBloom(enemy.weapon, enemy.weaponState, TICK_SECONDS);
        // U-069: a withdrawing tank that has driven out is gone — not a corpse, not a wreck.
        if (enemy.drive.withdrawing && enemy.drive.phase === 'arrived') {
          enemy.departed = true;
          expired = true;
        }
        continue;
      }
      // T-4.29: a gunner stays on its gun, crouched behind it, whatever its brain's feet want.
      if (enemy.mounted) enemy.input = { ...enemy.input, moveX: 0, moveY: 0, jump: false, sprint: false, crouch: true, prone: false, yaw: enemy.yaw };
      const stepped = this.stepSoldier(enemy.netId, enemy.state, enemy.input);
      const region = enemy.posture?.region;
      const from = { x: enemy.state.x, y: standingY(enemy.state), z: enemy.state.z };
      const to = { x: stepped.x, y: standingY(stepped), z: stepped.z };
      if (!region || (regionContains(region, to) && regionContainsSegment(region, from, to))) enemy.state = stepped;
      else {
        enemy.input = { ...enemy.input, moveX: 0, moveY: 0, jump: false };
        enemy.follower = null; enemy.pathStatus = 'unreachable';
      }
      if (enemy.mounted) {
        enemy.state.x = enemy.mounted.place.x;
        enemy.state.z = enemy.mounted.place.z;
      }
      enemy.speed = Math.sqrt((enemy.state.x - fromX) ** 2 + (enemy.state.z - fromZ) ** 2) / TICK_SECONDS;
      // T-3.23: a gun that deploys packs up the moment it moves, and settles again only standing still.
      const deploy = enemy.def.deploy;
      if (deploy) enemy.deployedAt = enemy.speed > deploy.movingSpeedMps || enemy.state.vault ? null : (enemy.deployedAt ?? nowSeconds);
      enemy.yaw = enemy.input.yaw;
      // Its gun recovers as a slot's does (T-3.15): firing adds bloom, only this takes it away.
      decayBloom(enemy.weapon, enemy.weaponState, TICK_SECONDS);
    }
    if (!expired) return;
    const kept = this.enemyList.filter((enemy) => {
      const gone = enemy.departed || (isDead(enemy.health) && nowSeconds - (enemy.health.diedAt as number) >= enemy.def.corpseSeconds);
      // Out of the history too, or a rewound shot could still find the corpse.
      if (gone) this.hitboxes.forget(enemy.netId);
      return !gone;
    });
    this.enemyList.length = 0;
    for (const enemy of kept) this.enemyList.push(enemy);
  }

  /**
   * 30 Hz locomotion: every bot whose brain wants to go somewhere has its
   * latest intent walked by path following, then steered round everyone else.
   * A bot whose brain wants nothing, and never has since it last stood still,
   * keeps whatever input it has — an idle one — exactly as before brains.
   */
  private stepSoldier(netId: number, state: MoveState, input: MoveInput): MoveState {
    const others = [...this.slots, ...this.enemyList.filter((e) => !e.def.vehicle)]
      .filter((body) => body.netId !== netId)
      .map((body) => characterSpace(body.state, this.moveConfig, !isAlive(body.health), body.netId));
    return keepCharacterSpace(state, stepCharacter(state, input, TICK_SECONDS, this.moveConfig, this.collisionBoxes), others, this.moveConfig, this.collisionBoxes, netId);
  }

  private driveBots(): void {
    const mesh = this.navMesh;
    if (!mesh) return;
    const inputs: (MoveInput | null)[] = this.slots.map(() => null);
    for (const slot of this.slots) {
      const brain = slot.brain;
      if (!this.autonomous(slot) || !brain) continue;
      const use = this.supplyUses.get(slot.index);
      if (use?.mode === 'commander') {
        const cache = this.supplyDefs.find((c) => c.id === use.cacheId)!;
        if (use.phase === 'collect' || this.canUseSupply(slot, cache, true)) {
          use.phase = 'collect';
          slot.input = idleInput(slot.yaw);
          this.followers[slot.index] = null;
          continue;
        }
        const follower = this.followers[slot.index] ??= new PathFollower(mesh, this.collisionBoxes, undefined, this.moveConfig,
          (from, to) => this.supplyPath(from, to));
        const step = follower.step(slot.state, { goal: cache.feet, pace: 'walk' }, slot.yaw);
        // Arrival is only a path result, never permission to collect through a slab/wall.
        if (step.status === 'unreachable' || step.status === 'arrived' || follower.repaths >= 2) {
          this.failCommanderSupply(slot, 'unreachable cache');
          continue;
        }
        inputs[slot.index] = step.input;
        continue;
      }
      const intent = brain.intent;
      let follower = this.followers[slot.index] ?? null;
      if (!follower) {
        if (!intent) continue;
        follower = this.followers[slot.index] = new PathFollower(mesh, this.collisionBoxes, undefined, this.moveConfig);
      }
      inputs[slot.index] = follower.step(slot.state, this.heldPace(slot, intent), slot.yaw).input;
      // Stood still again: its input is the idle one just made, and stays so.
      if (!intent) this.followers[slot.index] = null;
    }
    // Living enemies walk their brains' intents the same way (T-3.10). A
    // corpse is out of the crowd altogether: nobody steers round the dead.
    const living = this.enemyList.filter((e) => !isDead(e.health));
    const enemyInputs: (MoveInput | null)[] = living.map((enemy) => {
      if (enemy.inactive) return null;
      // T-4.29: a gunner's brain may want to go somewhere; its feet stay on the gun.
      const patrol = enemy.posture?.patrol;
      const intent = enemy.mounted ? null : patrol?.active ? stepAuthoredPatrol(enemy.posture!, enemy.state) : (enemy.brain?.intent ?? null);
      if (!enemy.follower) {
        if (!intent) return null;
        enemy.follower = new PathFollower(mesh, this.collisionBoxes, undefined, this.moveConfig, enemy.bounds ? (from, to, searchM) => enemy.bounds!.path(from, to, searchM) : undefined);
      }
      const stepped = enemy.follower.step(enemy.state, intent, enemy.yaw);
      enemy.pathStatus = stepped.status;
      const input = stepped.input;
      if (!intent) enemy.follower = null;
      return input;
    });
    if (!this.avoidance) {
      if (inputs.every((i) => !i) && enemyInputs.every((i) => !i)) return;
      this.avoidance = new Avoidance(mesh, MAX_SLOTS + MAX_ENEMIES, undefined, this.moveConfig);
    }
    const entries: AvoidanceEntry[] = this.slots.map((slot) => ({
      id: slot.netId,
      state: slot.state,
      input: inputs[slot.index] ?? null,
      hold: this.followers[slot.index]?.onVault ?? false,
    }));
    living.forEach((enemy, i) => {
      entries.push({ id: enemy.netId, state: enemy.state, input: enemyInputs[i] ?? null, hold: enemy.follower?.onVault ?? false });
    });
    const steered = this.avoidance.step(entries);
    for (const slot of this.slots) {
      const input = steered[slot.index];
      if (inputs[slot.index] && input) slot.input = input;
    }
    living.forEach((enemy, i) => {
      const input = steered[this.slots.length + i];
      if (enemyInputs[i] && input) enemy.input = input;
    });
  }

  /** Clear all revive state owned by, or stored on, a reused slot. */
  private clearReviveStateForSlot(slotIndex: number): void {
    if (this.clearSupplyUse(slotIndex)) this.broadcastSupplyProgress();
    const slot = this.slots[slotIndex];
    if (slot) {
      slot.reviveBySlot = -1;
      slot.reviveProgressSeconds = 0;
    }
    for (const target of this.slots) {
      if (target.reviveBySlot === slotIndex) {
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
      }
    }
  }

  /**
   * T-2.15: resolve the held-E revive interaction authoritatively.
   *
   * A downed target owns its reviver lock. Once a living human has started
   * within range, another player cannot steal the interaction until the first
   * player releases E, leaves range, becomes downed/dead, or the target stops
   * being downed. This makes simultaneous attempts deterministic and matches
   * the requested "first to start holds it" rule.
   */
  private updateRevives(): void {
    const rangeSq = DAMAGE.downed.reviveRangeM * DAMAGE.downed.reviveRangeM;

    // First, invalidate locks whose reviver is no longer actively holding E.
    for (const target of this.slots) {
      if (!isDowned(target.health)) {
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
        continue;
      }
      if (target.reviveBySlot < 0) {
        target.reviveProgressSeconds = 0;
        continue;
      }
      const reviver = target.reviveBySlot >= 0 ? this.slots[target.reviveBySlot] : undefined;
      if (
        !reviver ||
        !isAlive(reviver.health) ||
        !this.holdingInteract(reviver) ||
        this.distanceSq(reviver, target) > rangeSq
      ) {
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
      }
    }

    // Then allow unclaimed targets to be claimed in stable slot/netId order.
    // One soldier at a time: a reviver already holding a lock takes no second
    // target, however many downed teammates are in reach. The next one is
    // claimed the tick after the first revive completes and frees the reviver.
    for (const reviver of this.slots) {
      if (!isAlive(reviver.health) || !this.holdingInteract(reviver)) continue;
      if (this.slots.some((t) => t.reviveBySlot === reviver.index)) continue;
      let best: Slot | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const target of this.slots) {
        if (target === reviver || !isDowned(target.health) || target.reviveBySlot >= 0) continue;
        const d = this.distanceSq(reviver, target);
        if (d <= rangeSq && d < bestDistance) {
          best = target;
          bestDistance = d;
        }
      }
      if (best) {
        best.reviveBySlot = reviver.index;
        best.reviveProgressSeconds = 0;
      }
    }

    // Advance every active interaction and complete it at the configured hold time.
    for (const target of this.slots) {
      if (!isDowned(target.health) || target.reviveBySlot < 0) continue;
      this.clearSupplyUse(target.reviveBySlot);
      target.reviveProgressSeconds += TICK_SECONDS;
      if (target.reviveProgressSeconds >= this.reviveSeconds(target.reviveBySlot)) {
        this.awardXp(target.reviveBySlot, 'revive');
        this.bumpStat(target.reviveBySlot, 'revives');
        revive(target.health);
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
        target.queue.length = 0;
      }
    }
  }

  /**
   * Holding E as of the newest real input, and not silent past the repeat
   * window — or, for a bot (T-3.26), its brain asking to: the same lock, range
   * and timer a human's held E gets.
   */
  private holdingInteract(slot: Slot): boolean {
    if (this.commanderUsingSupply(slot)) return false;
    if (this.autonomous(slot)) return slot.brain?.read('interact') ?? false;
    return slot.interactHeld && slot.staleTicks <= MAX_INPUT_REPEAT;
  }

  private distanceSq(a: Slot, b: Slot): number {
    const dx = a.state.x - b.state.x;
    const dy = a.state.y - b.state.y;
    const dz = a.state.z - b.state.z;
    return dx * dx + dy * dy + dz * dz;
  }

  private buildSnapshot(): WorldSnapshot {
    const entities: WorldSnapshot['entities'] = this.slots.map((s) => ({
        netId: s.netId,
        components: {
          [T]: [
            quantize(s.state.x, POSITION),
            quantize(s.state.y, POSITION),
            quantize(s.state.z, POSITION),
            s.yaw & 0x3ff,
            s.pitch & 0x3ff,
          ],
          // Vertical velocity must replicate or a client reconciling mid-jump
          // snaps to the right height with the wrong momentum and diverges again
          // on the very next tick.
          [V]: [quantize(0, VELOCITY), quantize(s.state.vy, VELOCITY), quantize(0, VELOCITY)],
          // Replicated, never predicted: §2.3 puts damage firmly on the
          // server's side of the line. The vitality and its timer ride along
          // (T-2.13) so the HUD counts what the server counts.
          [H]: [
            Math.round(s.health.current),
            Math.round(s.health.max),
            vitalityCode(vitality(s.health)),
            Math.min(63, Math.ceil(vitalTimer(s.health, this.nowMs / 1000))),
            Math.min(100, Math.round((s.reviveProgressSeconds / this.reviveSeconds(s.reviveBySlot)) * 100)),
            s.reviveBySlot < 0 ? 0 : s.reviveBySlot + 1,
          ],
          [COMPONENT_IDS.PlayerSlot]: [s.index, s.isBot ? 1 : 0],
          // Replicate the authoritative stance so remote presentation matches the hitbox.
          [C]: [s.state.crouched ? 1 : 0, s.state.prone ? 1 : 0],
          // A vault in progress, whole (T-2.21): a predictor reconciling
          // mid-vault continues the same traversal instead of falling out of it.
          [COMPONENT_IDS.Vault]: vaultToLevels(s.state.vault),
          // The weapon in hand and its reload, for the body (T-2.26): the
          // host's own reload, which since U-028 includes a player's manual
          // one (a Reload from the page).
          [COMPONENT_IDS.Weapon]: [
            Math.max(0, (WEAPON_IDS as readonly string[]).indexOf(s.weapon.id)),
            Math.min(100, Math.round(reloadProgress(s.weapon, s.weaponState, this.nowMs / 1000) * 100)),
            s.heldProjectile + 1,
            // U-024: what is left in the pouch, for the page's own count to follow.
            ...PROJECTILE_IDS.map((_, i) => Math.min(POUCH_COUNT_MAX, s.pouch[i] ?? 0)),
            // U-028: and the rounds in the magazine.
            Math.min(AMMO_MAX, s.weaponState.ammo),
            // U-018: and what key 1 draws.
            s.primary === null ? NO_SECONDARY : Math.max(0, (WEAPON_IDS as readonly string[]).indexOf(s.primary)),
            // U-022: and the second primary, if the soldier carries one.
            s.secondary === null ? NO_SECONDARY : Math.max(0, (WEAPON_IDS as readonly string[]).indexOf(s.secondary)),
            // U-029: and whether the pistol has been put down.
            s.noPistol ? 1 : 0,
            // U-047: and the kits left, and how far through applying one.
            Math.min(7, s.kits),
            s.kitProgress > 0 ? Math.min(100, Math.floor((100 * s.kitProgress) / this.kitSeconds(s))) : 0,
            // U-048: and the equipment in slot 5, an index plus one.
            s.equipment + 1,
          ],
          // T-3.16: how suppressed, so the page can show it and widen its cone to match.
          [COMPONENT_IDS.Suppression]: [suppressionToWire(suppressionLevel(s.suppression, this.nowMs / 1000))],
        },
      }));

    /**
     * Enemies (T-3.10): a soldier's Transform, Velocity, Health and Crouch,
     * and an Enemy saying which archetype and whose side — what tells a client
     * this soldier is not a squadmate. No PlayerSlot, no Vault, no Weapon.
     * A corpse's Health timer counts down to its despawn.
     */
    for (const e of this.enemyList) {
      const corpseLeft = isDead(e.health)
        ? Math.max(0, e.def.corpseSeconds - (this.nowMs / 1000 - (e.health.diedAt as number)))
        : 0;
      entities.push({
        netId: e.netId,
        components: {
          [T]: [
            quantize(e.state.x, POSITION),
            quantize(e.state.y, POSITION),
            quantize(e.state.z, POSITION),
            e.yaw & 0x3ff,
            e.pitch & 0x3ff,
          ],
          [V]: [quantize(0, VELOCITY), quantize(e.state.vy, VELOCITY), quantize(0, VELOCITY)],
          [H]: [
            Math.round(e.health.current),
            Math.round(e.health.max),
            vitalityCode(vitality(e.health)),
            Math.min(63, Math.ceil(corpseLeft)),
            // U-010: how far through pulling the lever it is, percent — the slot a squadmate's revive uses.
            this.leverUse?.enemy === e ? this.leverPercent() : 0,
            0,
          ],
          [C]: [e.state.crouched ? 1 : 0, e.state.prone ? 1 : 0],
          // U-066: a tank's turret faces its own way; a soldier's is 0. U-068: and 1 while its cannon is locked on a point.
          [COMPONENT_IDS.Enemy]: [e.archetype, e.faction, e.def.vehicle ? e.turretYaw & 0x3ff : 0, e.tell ? 1 : 0],
        },
      });
    }

    /**
     * Projectiles are entities like any other, and were the first to come and
     * go (enemies, above, are the second): they carry a Transform and a
     * Velocity — the velocity so a client can point a rocket along its flight
     * and smooth between samples — and a
     * Projectile saying which kind and whose. No health, no stance, nothing
     * a soldier needs. They cost their component mask and about a hundred bits
     * a tick each while they are in the air, and nothing at all once they are
     * not (T-1.04's despawn).
     */
    for (const p of this.projectiles) {
      entities.push({
        netId: p.netId,
        components: {
          [T]: [
            quantize(p.state.x, POSITION),
            quantize(p.state.y, POSITION),
            quantize(p.state.z, POSITION),
            0,
            0,
          ],
          [V]: [
            quantize(p.state.vx, VELOCITY),
            quantize(p.state.vy, VELOCITY),
            quantize(p.state.vz, VELOCITY),
          ],
          [COMPONENT_IDS.Projectile]: [p.kind, p.ownerSlot],
        },
      });
    }

    /**
     * Emplacements (T-4.29): a Transform — the gun's place and the way it is
     * laid — and an Emplacement saying which kind, who is on it and how hot it
     * is. Static and few; a delta carries nothing for one nobody has touched.
     */
    /** U-017: pickups — where each lies, which way, and what it is. They come and go as projectiles do. */
    for (const p of this.pickupList) {
      entities.push({
        netId: p.netId,
        components: {
          [T]: [quantize(p.x, POSITION), quantize(p.y, POSITION), quantize(p.z, POSITION), p.yaw & 0x3ff, 0],
          [COMPONENT_IDS.Pickup]: [p.weapon, p.ammo],
        },
      });
    }

    for (const g of this.emplacementList) {
      const gunnerSlot = g.gunnerNetId === 0 ? -1 : this.slots.findIndex((s) => s.netId === g.gunnerNetId);
      entities.push({
        netId: g.netId,
        components: {
          [T]: [quantize(g.placed.x, POSITION), quantize(g.placed.y, POSITION), quantize(g.placed.z, POSITION), g.yaw & 0x3ff, g.pitch & 0x3ff],
          [COMPONENT_IDS.Emplacement]: [g.kind, g.gunnerNetId === 0 ? 0 : gunnerSlot >= 0 ? gunnerSlot + 1 : 7, heatToWire(g.heat), g.heat.overheated ? 1 : 0],
        },
      });
    }

    return { tick: this.currentTick, entities };
  }

  private broadcast(snapshot: WorldSnapshot): void {
    for (const conn of this.connections) {
      if (conn.state !== 'active') continue;

      const slot = this.slots.find((sl) => sl.connection === conn);
      let view = this.views.get(conn);
      if (!view) {
        view = new ClientView();
        this.views.set(conn, view);
      }
      // Per-client baseline: the VIEW they were sent at the tick they last
      // acknowledged (T-3.12) — an entity out of their radius then and in it
      // now is a spawn, the reverse a despawn. If it has aged out of the ring
      // they get a full view, which is self-healing.
      const baseline = conn.lastAckedTick >= 0 ? view.history.get(conn.lastAckedTick) : null;
      const watched = this.spectators.get(conn);
      const current = view.next(snapshot, watched === undefined ? (slot ? slot.netId : null) : watched === ESCORT_SPECTATE_SLOT ? (this.escort()?.netId ?? slot?.netId ?? null) : (this.slots[watched]?.netId ?? null));
      const w = new BitWriter();
      writeDelta(w, current, baseline);
      const payload = w.toUint8Array();

      const wire = encodeMessage({
        kind: 'Delta',
        tick: snapshot.tick,
        baselineTick: baseline ? baseline.tick : null,
        lastProcessedInputTick: slot ? slot.lastProcessedInputTick : -1,
        payload,
      });
      conn.transport.send(wire, 'unreliable');
      this.snapshotsSent++;
      this.bytesSent += wire.length;
    }
  }

  /** Every seated connection is told the host is draining, then dropped. */
  close(reason = 'session closed'): void {
    this.avoidance?.destroy();
    this.avoidance = null;
    for (const conn of [...this.connections]) conn.reject('host draining', reason);
    this.connections.clear();
    this.aiDebugClients.clear();
  }
}
