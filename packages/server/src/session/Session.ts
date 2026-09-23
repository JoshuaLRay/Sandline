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
  COMPONENT_IDS,
  DEFAULT_MOVE_CONFIG,
  MAX_SLOTS,
  type MoveConfig,
  RANGE_TARGETS,
  type Message,
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
  PROJECTILE_IDS,
  type ProjectileDef,
  type ProjectileState,
  type ProjectileWorld,
  blastDamageOn,
  createProjectileState,
  getProjectile,
  projectileByIndex,
  stepProjectile,
  tableToWire,
  type HealthState,
  applyDamage,
  vaultToLevels,
  createHealth,
  expireBleedOut,
  isDead,
  isDowned,
  vitalTimer,
  vitality,
  DAMAGE,
  vitalityCode,
  createMoveState,
  createWeaponState,
  damageAtDistance,
  decayBloom,
  isAlive,
  readyToRespawn,
  reloadProgress,
  revive,
  respawn,
  spawnFor,
  zoneAt,
  zoneDamage,
  encodeMessage,
  finishReload,
  DEFAULT_MUZZLE_RIG,
  eyePosition,
  getWeapon,
  shotDirections,
  startReload,
  tryFire,
  quantize,
  stepCharacter,
  writeDelta,
  type EnemyDef,
  ENEMY_NET_ID_LIMIT,
  FIRST_ENEMY_NET_ID,
  buildTree,
  enemyIndex,
  getEnemy,
  SQUAD as SQUAD_CONFIG,
  ORDERS,
  orderProblem,
  type BotOrder,
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
import { DEFAULT_HITBOX, HitboxHistory, capsuleFor, clampRewindMs, rayCapsule, resolveShot } from '../net/lagComp.ts';
import { BRAIN_PERIOD_TICKS, Brain, type BrainTree, createBrainRegistry, defaultBrainTree } from '../ai/Brain.ts';
import { type AiDebugSource, buildAiDebug } from '../ai/debug.ts';
import { aimAngles, aimConeDeg, aimError, aimPoints, aimSeed, visibleAimPoint } from '../ai/aim.ts';
import { CoverSystem, DEFAULT_COVER_BODY } from '../ai/cover.ts';
import { EnemyGroup } from '../ai/group.ts';
import type { CombatWorld } from '../ai/actions/combat.ts';
import type { DownedMate, SquadView } from '../ai/actions/friendly.ts';
import { Formation, type FormationPlace } from '../ai/friendly/formation.ts';
import { type StillWatch, createStillWatch, throwEye, throwLaunch, watchStill } from '../ai/throw.ts';
import type { CoverPoint } from '../ai/nav/baked/types.ts';
import { pathLength } from '../ai/nav/NavMesh.ts';
import { PathFollower } from '../ai/locomotion/followPath.ts';
import { Avoidance, type AvoidanceEntry } from '../ai/locomotion/avoidance.ts';
import type { NavMesh } from '../ai/nav/NavMesh.ts';
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

/** T-3.26: the archetype a friendly bot sees, aims and fires by (`squad.json`'s bot.archetype), with its slot's own gun. */
const BOT_ARCHETYPE = getEnemy(SQUAD_CONFIG.bot.archetype);

/** The aim id suppressive fire is timed on (T-3.21): a point, not a soldier. */
const SUPPRESSIVE_AIM = -1;

/** A soldier's eye where it stands now, in its stance: prone, crouched (the cover body's crouched eye, T-3.19) or standing. */
function soldierEye(state: MoveState): { x: number; y: number; z: number } {
  const h = state.prone ? DEFAULT_MUZZLE_RIG.proneEyeHeight : state.crouched ? (DEFAULT_COVER_BODY.crouched[2] as number) : DEFAULT_MUZZLE_RIG.eyeHeight;
  return { x: state.x, y: state.y + h, z: state.z };
}

/** A soldier's capsule where it stands now, as the trace and the near miss both see it. */
function soldierCapsule(state: MoveState): { centre: { x: number; y: number; z: number }; halfHeight: number; radius: number } {
  const { halfHeight, centerOffsetY } = capsuleFor(DEFAULT_HITBOX, state.crouched, state.prone);
  return { centre: { x: state.x, y: state.y + centerOffsetY, z: state.z }, halfHeight, radius: DEFAULT_HITBOX.radius };
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
  netId: number;
  def: ProjectileDef;
  /** Index into PROJECTILE_IDS: what goes on the wire. */
  kind: number;
  ownerSlot: number;
  ownerNetId: number;
  state: ProjectileState;
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
  input: MoveInput;
  health: HealthState;
  /** Its brain, stopped on the tick it dies. */
  brain: Brain | null;
  /** Path following for the brain's intent, made on the first one, as a bot's. */
  follower: PathFollower | null;
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
  /** T-3.23: rounds into the current burst, and when a pause after the last one ends (seconds). */
  burst: { rounds: number; pauseUntil: number };
}

/** Where and how to spawn an enemy. */
export interface EnemySpawn {
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
  private nextProjectileNetId = FIRST_PROJECTILE_NET_ID;
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
  private snapshotsSent = 0;
  private bytesSent = 0;
  private readonly navMesh: NavMesh | null;
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

  constructor(
    private readonly moveConfig: MoveConfig = DEFAULT_MOVE_CONFIG,
    /** The code clients are told they landed in. Empty for a lone session. */
    readonly room = '',
    /** A world id (`WORLD=range pnpm host`), or a built world — tests make their own. */
    world: string | World = DEFAULT_WORLD_ID,
    options: SessionOptions = {},
  ) {
    this.world = typeof world === 'string' ? requireWorld(world) : world;
    this.navMesh = options.navMesh ?? null;
    const mesh = this.navMesh;
    this.cover =
      options.cover && options.cover.length > 0
        ? new CoverSystem(
            options.cover,
            this.world.boxes,
            mesh
              ? (a, b) => {
                  const path = mesh.path(a, b);
                  return path ? pathLength(path.points) : null;
                }
              : undefined,
          )
        : null;
    this.combatWorld = {
      cover: this.cover,
      boxes: this.world.boxes,
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
    };
    this.brainTree = options.brainTree ?? defaultBrainTree();
    this.aiDebugAllowed = options.aiDebug ?? false;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 0;
    this.maxSessionMs = options.maxSessionMs ?? 0;
    // Six slots exist from the moment the session does (ADR-001).
    this.formation = new Formation((p) => (mesh ? (mesh.nearestPoint(p)?.point ?? null) : p));
    const squad: SquadView = { place: (index) => this.formation.place(index), downedNear: (index) => this.downedNear(index) };
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
        state: createMoveState(spawnFor(i).x, spawnFor(i).y, spawnFor(i).z),
        yaw: 0,
        input: idleInput(),
        lastProcessedInputTick: -1,
        pendingInputTick: -1,
        newestInputTick: -1,
        queue: [],
        staleTicks: 0,
        connection: null,
        weapon: getWeapon(WEAPON_IDS[0]),
        weaponState: createWeaponState(getWeapon(WEAPON_IDS[0])),
        suppression: createSuppression(),
        pitch: 0,
        pouch: this.fullPouch(),
        nextThrowAt: 0,
        heldProjectile: -1,
        health: createHealth(),
        reviveBySlot: -1,
        reviveProgressSeconds: 0,
        interactHeld: false,
        brain: null,
        brainGeneration: 0,
      });
      this.followers.push(null);
      this.lastFiredTick.push(-Infinity);
      this.slotSpeed.push(0);
      this.giveBrain(this.slots[i]!);
    }
  }

  /** A fresh brain for a bot slot, starting from the entity as it stands. */
  private giveBrain(slot: Slot): void {
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
    };
  }

  /** Enemies in the session, living and dead, oldest first (T-3.10). */
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

  spawnEnemy(archetype: string, at: EnemySpawn): number | null {
    const def = getEnemy(archetype);
    if (this.enemyList.length >= MAX_ENEMIES || this.nextEnemyNetId >= ENEMY_NET_ID_LIMIT) return null;
    const yaw = at.yaw ?? 0;
    const enemy: EnemyEntity = {
      netId: this.nextEnemyNetId++,
      def,
      archetype: enemyIndex(def.id),
      faction: at.faction ?? 0,
      state: createMoveState(at.x, at.y, at.z),
      yaw,
      pitch: 0,
      input: idleInput(yaw),
      health: { current: def.health, max: def.health, downedAt: null, diedAt: null },
      brain: null,
      follower: null,
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
      burst: { rounds: 0, pauseUntil: 0 },
    };
    enemy.group?.add(enemy.netId);
    enemy.brain = new Brain(enemy, at.tree ?? this.enemyTree(def.tree));
    this.enemyList.push(enemy);
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

  /** T-3.26: the nearest downed squadmate within `bot.reviveSeekM` of a slot that nobody else is reviving. */
  private downedNear(index: number): DownedMate | null {
    const me = this.slots[index];
    if (!me || !isAlive(me.health)) return null;
    let best: DownedMate | null = null;
    let bestD = SQUAD_CONFIG.bot.reviveSeekM;
    for (const s of this.slots) {
      if (s === me || !isDowned(s.health)) continue;
      if (s.reviveBySlot >= 0 && s.reviveBySlot !== index) continue;
      const d = Math.sqrt((s.state.x - me.state.x) ** 2 + (s.state.z - me.state.z) ** 2);
      if (d <= bestD) {
        bestD = d;
        best = { index: s.index, x: s.state.x, y: s.state.y, z: s.state.z, reachM: DAMAGE.downed.reviveRangeM };
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
    const world = { cover: this.cover, boxes: this.world.boxes, mesh: this.navMesh };
    for (const group of this.groups.values()) {
      const members = group.members.flatMap((id) => {
        const e = this.enemyList.find((x) => x.netId === id);
        return e ? [{ netId: e.netId, state: e.state, alive: !isDead(e.health), memory: e.memory, target: e.target, prefers: e.def.prefersRole }] : [];
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
    this.cover?.release(enemy.netId);
    enemy.brain?.stop();
    enemy.follower = null;
    enemy.input = idleInput(enemy.yaw);
  }

  /** Projectiles in the air right now. The harness HUD reads it (T-2.32). */
  get projectilesInFlight(): number {
    return this.projectiles.length;
  }

  /** Who threw each projectile in the air and where it is now: the tests' view of a throw (T-3.22). */
  projectilesNow(): { netId: number; kind: number; ownerNetId: number; x: number; y: number; z: number }[] {
    return this.projectiles.map((p) => ({ netId: p.netId, kind: p.kind, ownerNetId: p.ownerNetId, x: p.state.x, y: p.state.y, z: p.state.z }));
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
    }));
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
      onInput: (c, msg) => this.applyInput(c, msg),
      // NOT the `now` this connection was opened at: that value is frozen
      // forever. Fire resolves against the session's current time.
      onFire: (c, msg) => this.applyFire(c, msg),
      onThrow: (c, msg) => this.applyThrow(c, msg),
      onEquip: (c, msg) => this.applyEquip(c, msg),
      onAiDebugRequest: (c, on) => this.applyAiDebugRequest(c, on),
      onOrder: (c, msg) => this.applyOrder(c, msg),
      onMark: (c, msg) => this.applyMark(c, msg),
      onClosed: (c) => this.releaseSlot(c),
    });
    if (conn.state === 'closed') return false;
    this.connections.add(conn);
    return this.assignSlot(conn);
  }

  private assignSlot(conn: ServerConnection): boolean {
    const slot = this.slots.find((s) => s.isBot);
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

    conn.accept(slot.netId, slot.index, this.currentTick, this.room, this.world.id);
    this.broadcastRoster();
    // T-3.27: a human is nobody's to order, so whatever this slot's bot was told
    // lapses; and the newcomer is shown the squad's orders and marks as they stand.
    if (this.orders[slot.index]) {
      this.orders[slot.index] = null;
      this.broadcastOrders();
    } else {
      conn.send({ kind: 'Orders', orders: this.currentOrders() });
    }
    conn.send({ kind: 'Marks', marks: [...this.marks] });
    return true;
  }

  // -------------------------------------------------------------------------
  // T-3.27: orders and marks
  // -------------------------------------------------------------------------

  /** Each slot's current order, or null: only ever a bot's. */
  private readonly orders: (BotOrder | null)[] = Array.from({ length: MAX_SLOTS }, () => null);
  private marks: TargetMark[] = [];
  private nextMarkId = 1;

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
   * only the bots take it (ADR-001: any player may order any bot, and nobody
   * a human). The last order to a bot stands, whoever gave it; every client
   * is sent the squad's orders whole.
   */
  private applyOrder(conn: ServerConnection, msg: Extract<Message, { kind: 'Order' }>): void {
    const from = this.humanFor(conn);
    if (!from) return;
    if (orderProblem(msg, SQUAD_CONFIG.fireteams.length) !== null) return;
    if (msg.target !== null) {
      const wanted = msg.order === 'revive' ? this.slots.some((s) => s.netId === msg.target) : this.enemyList.some((e) => e.netId === msg.target && !isDead(e.health));
      if (!wanted) return;
    }
    const a = msg.address;
    const addressed = a.to === 'slot' ? [a.index] : a.to === 'fireteam' ? [...SQUAD_CONFIG.fireteams[a.index]!.slots] : this.slots.map((s) => s.index);
    const bots = addressed.filter((i) => this.slots[i]?.isBot === true);
    if (bots.length === 0) return;
    for (const i of bots) {
      this.orders[i] = { slot: i, order: msg.order, point: msg.point ? { ...msg.point } : null, target: msg.target, from: from.index };
    }
    this.broadcastOrders();
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

  private releaseSlot(conn: ServerConnection): void {
    this.connections.delete(conn);
    this.aiDebugClients.delete(conn);
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;
    // Hand the entity back to a bot; it keeps its position and its netId.
    // A departing reviver must not leave an interaction attached to a persistent entity.
    this.clearReviveStateForSlot(slot.index);
    slot.isBot = true;
    slot.connection = null;
    slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
    // A bot has a gun in hand, not whatever the departed player was holding.
    slot.heldProjectile = -1;
    // Anything still queued belongs to someone who has left. A bot that walked
    // out the departed player's last few inputs would look briefly possessed.
    slot.queue.length = 0;
    this.giveBrain(slot);
    this.broadcastRoster();
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
    slot.yaw = msg.yaw;
    slot.pitch = msg.pitch;
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

    const id = WEAPON_IDS[msg.weapon];
    if (id === undefined) return; // Out-of-range index: drop it, do not throw.
    if (id !== slot.weapon.id) {
      slot.weapon = getWeapon(id);
      slot.weaponState = createWeaponState(slot.weapon);
    }
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
    // T-3.16: suppression widens the cone by its data's amount, at the level the page is told.
    const shot = tryFire(slot.weapon, slot.weaponState, nowSeconds, msg.ads, proneThen, suppressionConeUnits(suppressionLevel(slot.suppression, nowSeconds)));
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
    const origin = eyePosition(at.x, at.y, at.z, DEFAULT_MUZZLE_RIG, proneThen);
    this.lastFiredTick[slot.index] = this.currentTick;
    this.traceShot(slot.netId, slot.weapon, shot, msg.tick, origin, yaw, pitch, msg.renderTimeMs, rewoundTo);
  }

  /**
   * Everything after the trigger: one trigger pull's pellets traced, damage
   * applied, stimuli made and `HitEvent`s sent. A human's `Fire` comes here
   * rewound to the instant it was looking at; an AI's (T-3.15) with no rewind
   * at all — `renderTimeMs` and `rewoundTo` both the present — because a
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
    rewoundTo: number,
  ): void {
    // T-3.14: the shot is heard where it was fired from, once per trigger pull.
    this.stimuli.push({ kind: 'shot', at: origin, sourceNetId: shooterNetId });

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
        this.world.boxes,
      );

      let dealt = 0;
      if (hit && hit.netId !== 0) {
        /**
         * Zone from the impact point's height up the target's hitbox — which is
         * exactly why T-1.18 returns a point rather than only a distance.
         */
        const targetState = this.hitboxes.stateAt(hit.netId, rewoundTo);
        const zone = zoneAt(
          hit.point.y,
          targetState?.position.y ?? 0,
          targetState?.prone ? PRONE_HITBOX_HEIGHT : targetState?.crouched ? CROUCH_HITBOX_HEIGHT : HITBOX_HEIGHT,
        );
        dealt = zoneDamage(damageAtDistance(weapon, hit.distance), zone);

        const target = this.slots.find((s) => s.netId === hit.netId);
        if (target) {
          const result = applyDamage(target.health, dealt, this.nowMs / 1000);
          dealt = result.applied;
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
          const result = applyDamage(enemy.health, dealt, this.nowMs / 1000, DAMAGE, enemy.def.downable);
          dealt = result.applied;
          if (dealt > 0) enemy.lastDamagedAt = this.nowMs / 1000;
          if (result.killed) this.killEnemy(enemy);
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
    for (const e of this.enemyList) if (!isDead(e.health)) out.push({ netId: e.netId, state: e.state, suppression: e.suppression, side: e.faction });
    return out;
  }

  /** Whose side a netId is on: `SQUAD`, an enemy's faction, or null for no soldier. */
  private side(netId: number): number | null {
    if (this.slots.some((s) => s.netId === netId)) return SQUAD;
    return this.enemyList.find((e) => e.netId === netId)?.faction ?? null;
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

    this.launch(slot, slot.index, msg.projectile, msg.yaw, msg.pitch);
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
      state: createProjectileState(origin, velocity),
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
    const gun = WEAPON_IDS[msg.item];
    if (gun !== undefined) {
      if (gun !== slot.weapon.id) {
        slot.weapon = getWeapon(gun);
        slot.weaponState = createWeaponState(slot.weapon);
      }
      slot.heldProjectile = -1;
      return;
    }
    const pouchIndex = msg.item - WEAPON_IDS.length;
    if (projectileByIndex(pouchIndex) === null) return;
    slot.heldProjectile = pouchIndex;
  }

  /** The boxes and the floor a projectile collides with: this session's world. */
  private projectileWorld(): ProjectileWorld {
    return { boxes: this.world.boxes, groundY: this.moveConfig.groundY };
  }

  /**
   * Fly every projectile one tick, and detonate the ones that arrive.
   *
   * Run AFTER the soldiers have moved, so a rocket meets the bodies where this
   * tick left them rather than where the last one did.
   */
  private stepProjectiles(): void {
    if (this.projectiles.length === 0) return;
    const world = this.projectileWorld();
    const survivors: ActiveProjectile[] = [];
    for (const projectile of this.projectiles) {
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
    for (const projectile of survivors) this.projectiles.push(projectile);
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
      const { halfHeight, centerOffsetY } = capsuleFor(DEFAULT_HITBOX, state.crouched, state.prone);
      const centre = { x: state.position.x, y: state.position.y + centerOffsetY, z: state.position.z };
      const distance = rayCapsule(ray, centre, DEFAULT_HITBOX.radius, halfHeight);
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
      const height = slot.state.prone ? PRONE_HITBOX_HEIGHT : slot.state.crouched ? CROUCH_HITBOX_HEIGHT : HITBOX_HEIGHT;
      const damage = blastDamageOn(
        projectile.def,
        at,
        { x: slot.state.x, y: slot.state.y, z: slot.state.z },
        height,
        this.world.boxes,
      );
      if (damage <= 0) continue;
      const result = applyDamage(slot.health, damage, nowSeconds);
      if (result.applied > 0) slot.lastDamagedAt = nowSeconds;
      // A killed player stops moving immediately, as under fire (see applyFire).
      if (result.killed) slot.queue.length = 0;
      targets.push({ netId: slot.netId, damage: result.applied });
    }
    // Enemies take the blast on the same terms (T-3.10), dying at zero.
    for (const enemy of this.enemyList) {
      if (isDead(enemy.health)) continue;
      const height = enemy.state.prone ? PRONE_HITBOX_HEIGHT : enemy.state.crouched ? CROUCH_HITBOX_HEIGHT : HITBOX_HEIGHT;
      const damage = blastDamageOn(
        projectile.def,
        at,
        { x: enemy.state.x, y: enemy.state.y, z: enemy.state.z },
        height,
        this.world.boxes,
      );
      if (damage <= 0) continue;
      const result = applyDamage(enemy.health, damage, nowSeconds, DAMAGE, enemy.def.downable);
      if (result.applied > 0) enemy.lastDamagedAt = nowSeconds;
      if (result.killed) this.killEnemy(enemy);
      targets.push({ netId: enemy.netId, damage: result.applied });
    }

    // T-3.14: heard at the blast, and a threat from whoever threw it.
    this.stimuli.push({ kind: 'detonation', at: { x: at.x, y: at.y, z: at.z }, sourceNetId: projectile.ownerNetId });

    // T-3.16: a blast suppresses the other side inside its radius, less with distance.
    const thrower = this.side(projectile.ownerNetId);
    for (const soldier of this.livingSoldiers()) {
      if (!this.hostile(thrower, soldier.side)) continue;
      const centre = soldierCapsule(soldier.state).centre;
      const d = Math.sqrt((centre.x - at.x) ** 2 + (centre.y - at.y) ** 2 + (centre.z - at.z) ** 2);
      raiseSuppression(soldier.suppression, blastSuppression(d), nowSeconds);
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
  step(now: number): void {
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

    const nowSeconds = now / 1000;
    this.perceive(nowSeconds);
    this.thinkGroups(nowSeconds);
    // T-3.25: where every slot is and is heading, before a bot's brain asks for its place.
    this.formation.update(
      this.slots.map((s) => ({
        index: s.index,
        human: !s.isBot,
        x: s.state.x,
        y: s.state.y,
        z: s.state.z,
        yaw: s.yaw,
        speed: this.slotSpeed[s.index] ?? 0,
        sprint: s.input.sprint,
      })),
    );
    this.thinkBrains();
    this.driveBots();
    this.enemyHands(nowSeconds);

    for (const slot of this.slots) {
      /**
       * Bleed-out (T-2.13): a downed soldier nobody reached dies here, and
       * stops where they lie, exactly as a finishing shot would stop them.
       */
      if (isDowned(slot.health) && expireBleedOut(slot.health, nowSeconds)) {
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
        if (readyToRespawn(slot.health, nowSeconds)) {
          respawn(slot.health);
          const point = spawnFor(slot.index);
          slot.state = createMoveState(point.x, point.y, point.z);
          slot.queue.length = 0;
          slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
          slot.weaponState = createWeaponState(slot.weapon);
          slot.suppression = createSuppression();
          slot.pouch = this.fullPouch();
          slot.nextThrowAt = 0;
        }
        // Still recorded into the hitbox history below, so a shot already in
        // flight resolves against where the body is.
        continue;
      }

      if (!slot.isBot) {
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
          slot.pendingInputTick = ahead.tick;
          slot.staleTicks = 0;
          slot.input.downed = isDowned(slot.health);
          slot.state = stepCharacter(slot.state, slot.input, TICK_SECONDS, this.moveConfig, this.world.boxes);
          extra -= 1;
        }

        const next = slot.queue.shift();
        if (next) {
          slot.input = next.input;
          slot.interactHeld = next.input.interact === true;
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
      const fromX = slot.state.x;
      const fromZ = slot.state.z;
      slot.state = stepCharacter(slot.state, slot.input, TICK_SECONDS, this.moveConfig, this.world.boxes);
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
      slot.yaw = slot.input.yaw;
      // Consumed now, so this is what the client may stop replaying.
      slot.lastProcessedInputTick = slot.pendingInputTick;
    }

    // Resolve revive interaction after consuming this tick's input, so a newly pressed E starts immediately.
    this.updateRevives();

    this.stepEnemies(nowSeconds);

    // Record AFTER stepping, so the history holds the post-tick positions that
    // the snapshot about to go out will describe. Recording pre-step would
    // rewind clients to a world half a tick behind the one they were shown.
    for (const slot of this.slots) {
      this.hitboxes.record(slot.netId, now, slot.state.x, slot.state.y, slot.state.z, slot.state.crouched, slot.state.prone);
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
      this.hitboxes.record(enemy.netId, now, enemy.state.x, enemy.state.y, enemy.state.z, enemy.state.crouched, enemy.state.prone);
    }

    // After everyone has moved and been recorded: an AI shoots at this tick's world.
    this.fireEnemies(nowSeconds);

    this.currentTick++;
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
    for (const enemy of this.enemyList) {
      if (isDead(enemy.health)) continue;
      const eye = eyePosition(enemy.state.x, enemy.state.y, enemy.state.z, DEFAULT_MUZZLE_RIG, enemy.state.prone);
      for (const stimulus of squad) if (hears(eye, stimulus)) rememberHeard(enemy.memory, stimulus, nowSeconds);
      if (!enemy.brain?.due(this.currentTick)) continue;

      beginThink(enemy.memory, nowSeconds);
      const perception = enemy.def.perception;
      const observer = { eye, yaw: wireToTable(enemy.yaw) };
      for (const slot of this.slots) {
        if (isDead(slot.health)) {
          forgetTarget(enemy.memory, slot.netId);
          enemy.awareness.delete(slot.netId);
          continue;
        }
        const target = {
          feet: { x: slot.state.x, y: slot.state.y, z: slot.state.z },
          stance: slot.state.prone ? ('prone' as const) : slot.state.crouched ? ('crouched' as const) : ('standing' as const),
          speed: this.slotSpeed[slot.index] ?? 0,
          firing: this.currentTick - (this.lastFiredTick[slot.index] ?? -Infinity) <= BRAIN_PERIOD_TICKS,
        };
        const sighting = sight(observer, target, this.world.boxes, perception, this.moveConfig);
        const awareness = stepAwareness(enemy.awareness.get(slot.netId) ?? 0, sighting, target, perception, dt);
        enemy.awareness.set(slot.netId, awareness);
        if (sighting.visible && isDetected(awareness, perception)) {
          rememberSeen(enemy.memory, slot.netId, target.feet, nowSeconds, isDowned(slot.health));
        }
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
    const hostile = heard.filter((s) => this.enemyList.some((e) => e.netId === s.sourceNetId));
    const dt = BRAIN_PERIOD_TICKS * TICK_SECONDS;
    const perception = BOT_ARCHETYPE.perception;
    for (const slot of this.slots) {
      if (!slot.isBot || !slot.brain || !isAlive(slot.health)) continue;
      const eye = eyePosition(slot.state.x, slot.state.y, slot.state.z, DEFAULT_MUZZLE_RIG, slot.state.prone);
      for (const stimulus of hostile) if (hears(eye, stimulus)) rememberHeard(slot.memory, stimulus, nowSeconds);
      if (!slot.brain.due(this.currentTick)) continue;
      beginThink(slot.memory, nowSeconds);
      const observer = { eye, yaw: wireToTable(slot.yaw) };
      for (const enemy of this.enemyList) {
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
        const sighting = sight(observer, target, this.world.boxes, perception, this.moveConfig);
        const awareness = stepAwareness(slot.awareness.get(enemy.netId) ?? 0, sighting, target, perception, dt);
        slot.awareness.set(enemy.netId, awareness);
        if (sighting.visible && isDetected(awareness, perception)) rememberSeen(slot.memory, enemy.netId, target.feet, nowSeconds, false);
      }
      slot.target = chooseTarget(slot.memory, slot.state, nowSeconds);
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
      if (alive && enemy.brain) this.aiHands(enemy, NO_SLOT, enemy.follower?.onVault ?? false, nowSeconds);
    }
    // T-3.26: friendly bots' hands the same way, when they run a tree that uses them.
    if (!this.botsDriven) return;
    for (const slot of this.slots) {
      if (!slot.isBot) continue;
      const able = isAlive(slot.health);
      this.cover?.track(slot.netId, slot.state, able);
      if (able && slot.brain) this.aiHands(slot, slot.index, this.followers[slot.index]?.onVault ?? false, nowSeconds);
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
    const toss = brain.take('throwAt');
    if (toss && !body.state.vault && this.launch(body, ownerSlot, toss.projectile, toss.yaw, toss.pitch)) {
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
      if (isDead(enemy.health)) continue;
      if (this.aiShoot(enemy, enemy.def.accuracy, this.deployed(enemy, nowSeconds), false, nowSeconds)) this.enemyFiredTick.set(enemy.netId, this.currentTick);
    }
    // T-3.26: friendly bots fire by the same path, holding fire while a squadmate is on the line.
    if (!this.botsDriven) return;
    for (const slot of this.slots) {
      if (!slot.isBot || !slot.brain || !isAlive(slot.health)) continue;
      if (this.aiShoot(slot, BOT_ARCHETYPE.accuracy, true, true, nowSeconds)) this.lastFiredTick[slot.index] = this.currentTick;
    }
  }

  /**
   * One AI soldier's trigger this tick (`fireEnemies`); true when a round left
   * the gun. `mayFire` false aims without firing (an MG not yet deployed);
   * `spareFriends` holds fire while a squadmate's capsule, grown by
   * `bot.friendlyMarginM`, is on the line to the aim point (T-3.26).
   */
  private aiShoot(shooter: AiBody, accuracy: EnemyAccuracy, mayFire: boolean, spareFriends: boolean, nowSeconds: number): boolean {
    const weapon = shooter.weapon;
    const ws = shooter.weaponState;
    finishReload(weapon, ws, nowSeconds);
    if (ws.ammo === 0) startReload(weapon, ws, nowSeconds);

    // Mid-vault both hands are on the wall, for an AI as for a player (T-2.21).
    if (shooter.state.vault) return false;
    // Its own eye in its own stance: crouched behind low cover it sees (and
    // shoots) over nothing a crouched head would not (T-3.20).
    const eye = soldierEye(shooter.state);
    const targetId = shooter.brain?.fireAt ?? null;
    const target = targetId === null ? null : this.soldier(targetId);
    const shootable = target && target.netId !== shooter.netId && !isDead(target.health) ? target : null;
    let point = shootable ? visibleAimPoint(eye, aimPoints(shootable.state, shootable.state.crouched, shootable.state.prone), this.world.boxes) : null;
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
    const shot = tryFire(weapon, ws, nowSeconds, true, shooter.state.prone);
    if (shot === null) return false;
    if (++shooter.burst.rounds >= accuracy.burstRounds) {
      shooter.burst.rounds = 0;
      shooter.burst.pauseUntil = nowSeconds + accuracy.burstPauseSeconds;
    }

    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const cone = aimConeDeg(accuracy, {
      distanceM: Math.sqrt(dx * dx + dy * dy + dz * dz),
      targetSpeedMps: aimAt === SUPPRESSIVE_AIM ? 0 : (shootable?.speed ?? 0),
      suppression: suppressionLevel(shooter.suppression, nowSeconds),
      timeOnTargetSeconds: nowSeconds - shooter.aim.since,
    });
    const aimed = aimError(line.yaw, line.pitch, cone, aimSeed(this.currentTick, shooter.netId, shot.shotIndex));
    this.traceShot(shooter.netId, weapon, shot, this.currentTick, eye, aimed.yaw, aimed.pitch, this.nowMs, this.nowMs);
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
      const capsule = soldierCapsule(slot.state);
      if (rayCapsule(ray, capsule.centre, capsule.radius + SQUAD_CONFIG.bot.friendlyMarginM, capsule.halfHeight + SQUAD_CONFIG.bot.friendlyMarginM) !== null) return true;
    }
    return false;
  }

  /** Whether an enemy may fire as far as deploying goes (T-3.23): always, for an archetype that does not deploy. */
  deployed(enemy: EnemyEntity, nowSeconds = this.nowMs / 1000): boolean {
    const deploy = enemy.def.deploy;
    return !deploy || (enemy.deployedAt !== null && nowSeconds - enemy.deployedAt >= deploy.seconds - 1e-9);
  }

  /** A slot or an enemy by netId, as much of it as a shooter aims with. */
  private soldier(netId: number): { netId: number; state: MoveState; health: HealthState; speed: number } | null {
    const slot = this.slots.find((s) => s.netId === netId);
    if (slot) return { netId, state: slot.state, health: slot.health, speed: this.slotSpeed[slot.index] ?? 0 };
    const enemy = this.enemyList.find((e) => e.netId === netId);
    return enemy ? { netId, state: enemy.state, health: enemy.health, speed: enemy.speed } : null;
  }

  /**
   * 10 Hz brains (T-3.08): each on the tick its netId's phase names, so the
   * six are spread two to a tick rather than all landing on one.
   */
  private thinkBrains(): void {
    for (const slot of this.slots) {
      if (slot.brain?.due(this.currentTick)) slot.brain.think(this.currentTick);
    }
    // Enemies' netIds are consecutive, so they spread over the phases too.
    for (const enemy of this.enemyList) {
      // However it died, a dead enemy's brain is stopped before it can think.
      if (isDead(enemy.health)) {
        if (enemy.brain && !enemy.brain.isStopped) this.killEnemy(enemy);
        continue;
      }
      if (enemy.brain?.due(this.currentTick)) enemy.brain.think(this.currentTick);
    }
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
      const fromX = enemy.state.x;
      const fromZ = enemy.state.z;
      enemy.state = stepCharacter(enemy.state, enemy.input, TICK_SECONDS, this.moveConfig, this.world.boxes);
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
      const gone = isDead(enemy.health) && nowSeconds - (enemy.health.diedAt as number) >= enemy.def.corpseSeconds;
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
  private driveBots(): void {
    const mesh = this.navMesh;
    if (!mesh) return;
    const inputs: (MoveInput | null)[] = this.slots.map(() => null);
    for (const slot of this.slots) {
      const brain = slot.brain;
      if (!slot.isBot || !brain) continue;
      const intent = brain.intent;
      let follower = this.followers[slot.index] ?? null;
      if (!follower) {
        if (!intent) continue;
        follower = this.followers[slot.index] = new PathFollower(mesh, this.world.boxes, undefined, this.moveConfig);
      }
      inputs[slot.index] = follower.step(slot.state, intent, slot.yaw).input;
      // Stood still again: its input is the idle one just made, and stays so.
      if (!intent) this.followers[slot.index] = null;
    }
    // Living enemies walk their brains' intents the same way (T-3.10). A
    // corpse is out of the crowd altogether: nobody steers round the dead.
    const living = this.enemyList.filter((e) => !isDead(e.health));
    const enemyInputs: (MoveInput | null)[] = living.map((enemy) => {
      const intent = enemy.brain?.intent ?? null;
      if (!enemy.follower) {
        if (!intent) return null;
        enemy.follower = new PathFollower(mesh, this.world.boxes, undefined, this.moveConfig);
      }
      const input = enemy.follower.step(enemy.state, intent, enemy.yaw).input;
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
      target.reviveProgressSeconds += TICK_SECONDS;
      if (target.reviveProgressSeconds >= DAMAGE.downed.reviveSeconds) {
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
    if (slot.isBot) return slot.brain?.read('interact') ?? false;
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
            Math.min(100, Math.round((s.reviveProgressSeconds / DAMAGE.downed.reviveSeconds) * 100)),
            s.reviveBySlot < 0 ? 0 : s.reviveBySlot + 1,
          ],
          [COMPONENT_IDS.PlayerSlot]: [s.index, s.isBot ? 1 : 0],
          // Replicate the authoritative stance so remote presentation matches the hitbox.
          [C]: [s.state.crouched ? 1 : 0, s.state.prone ? 1 : 0],
          // A vault in progress, whole (T-2.21): a predictor reconciling
          // mid-vault continues the same traversal instead of falling out of it.
          [COMPONENT_IDS.Vault]: vaultToLevels(s.state.vault),
          // The weapon in hand and its reload, for the body (T-2.26). The
          // server only knows the reloads it started itself (an empty
          // magazine on a Fire); a client's manual reload is its own picture.
          [COMPONENT_IDS.Weapon]: [
            Math.max(0, (WEAPON_IDS as readonly string[]).indexOf(s.weapon.id)),
            Math.min(100, Math.round(reloadProgress(s.weapon, s.weaponState, this.nowMs / 1000) * 100)),
            s.heldProjectile + 1,
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
            0,
            0,
          ],
          [C]: [e.state.crouched ? 1 : 0, e.state.prone ? 1 : 0],
          [COMPONENT_IDS.Enemy]: [e.archetype, e.faction],
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
      const current = view.next(snapshot, slot ? slot.netId : null);
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
