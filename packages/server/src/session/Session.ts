/**
 * Authoritative session and tick loop (T-1.13, ADR-012).
 *
 * Fixed 30 Hz: drain inputs, step the simulation, build a per-client delta
 * against that client's last acknowledged tick, broadcast.
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
  SnapshotHistory,
  TICK_SECONDS,
  type Transport,
  type WorldSnapshot,
  WEAPON_IDS,
  type WeaponDef,
  type WeaponState,
  DEFAULT_WORLD,
  FIRST_PROJECTILE_NET_ID,
  PROJECTILE_IDS,
  type ProjectileDef,
  type ProjectileState,
  type ProjectileWorld,
  blastDamageOn,
  createProjectileState,
  dirFromYawPitch,
  getProjectile,
  launchOrigin,
  launchVelocity,
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
  eyePosition,
  getWeapon,
  shotDirections,
  startReload,
  tryFire,
  quantize,
  stepCharacter,
  writeDelta,
} from '@sandline/shared';
import { DEFAULT_HITBOX, HitboxHistory, capsuleFor, clampRewindMs, rayCapsule, resolveShot } from '../net/lagComp.ts';

/**
 * Full standing height of a hitbox: cylinder plus both caps. Hit zones are
 * fractions of this, so they track the capsule rather than assuming 1.8 m.
 */
const HITBOX_HEIGHT = 2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius);
const CROUCH_HITBOX_HEIGHT = 2 * ((DEFAULT_HITBOX.crouchHalfHeight ?? DEFAULT_HITBOX.halfHeight) + DEFAULT_HITBOX.radius);
/** T-2.40: prone's own hit-volume height, lower again than crouch's. */
const PRONE_HITBOX_HEIGHT = 2 * ((DEFAULT_HITBOX.proneHalfHeight ?? DEFAULT_HITBOX.halfHeight) + DEFAULT_HITBOX.radius);

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const H = COMPONENT_IDS.Health;
const C = COMPONENT_IDS.Crouch;

export interface Slot {
  index: number;
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
  /** Aim pitch, in wire units. Movement only replicates yaw; shots need both. */
  pitch: number;
  /**
   * How many of each projectile are left, indexed like PROJECTILE_IDS, and the
   * earliest time the next one may leave the hand (T-2.31). The server's, not
   * the client's: a client that lies about either gets nothing.
   */
  pouch: number[];
  nextThrowAt: number;
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

/** A full load-out of every projectile, as the data says it is carried. */
function fullPouch(): number[] {
  return PROJECTILE_IDS.map((id) => getProjectile(id).carried);
}

/**
 * How far ahead of the eye a projectile is born. Far enough to be clear of the
 * thrower's own capsule (0.35 m radius) and no further; `launchOrigin` sweeps
 * the gap, so standing against a wall shortens it rather than posting a
 * grenade through the wall.
 */
const LAUNCH_AHEAD_M = 0.55;

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

export interface SessionStats {
  tick: number;
  players: number;
  bots: number;
  snapshotsSent: number;
  bytesSent: number;
}

export class Session {
  readonly slots: Slot[] = [];
  private readonly history = new SnapshotHistory(64);
  private readonly connections = new Set<ServerConnection>();
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
  private currentTick = 0;
  /**
   * Server time at the last tick, in ms. Still injected — the session reads no
   * clock; it only remembers the last time it was handed.
   */
  private nowMs = 0;
  private nextNetId = 1;
  private snapshotsSent = 0;
  private bytesSent = 0;

  /**
   * `moveConfig` is a REFERENCE, not a copy. The in-page QA server shares one
   * object with the client's predictor so the movement tuning panel moves both
   * at once; tuning one side only would mispredict every tick and read as the
   * netcode being broken rather than as a tuning artefact.
   */
  constructor(
    private readonly moveConfig: MoveConfig = DEFAULT_MOVE_CONFIG,
    /** The code clients are told they landed in. Empty for a lone session. */
    readonly room = '',
  ) {
    // Six slots exist from the moment the session does (ADR-001).
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.slots.push({
        index: i,
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
        pitch: 0,
        pouch: fullPouch(),
        nextThrowAt: 0,
        health: createHealth(),
        reviveBySlot: -1,
        reviveProgressSeconds: 0,
        interactHeld: false,
      });
    }
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
    };
  }

  /** Projectiles in the air right now. The harness HUD reads it (T-2.32). */
  get projectilesInFlight(): number {
    return this.projectiles.length;
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

    conn.accept(slot.netId, slot.index, this.currentTick, this.room);
    this.broadcastRoster();
    return true;
  }

  private releaseSlot(conn: ServerConnection): void {
    this.connections.delete(conn);
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;
    // Hand the entity back to a bot; it keeps its position and its netId.
    // A departing reviver must not leave an interaction attached to a persistent entity.
    this.clearReviveStateForSlot(slot.index);
    slot.isBot = true;
    slot.connection = null;
    slot.input = idleInput(slot.yaw);
    slot.interactHeld = false;
    // Anything still queued belongs to someone who has left. A bot that walked
    // out the departed player's last few inputs would look briefly possessed.
    slot.queue.length = 0;
    this.broadcastRoster();
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
    const shot = tryFire(slot.weapon, slot.weaponState, nowSeconds, msg.ads);
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
    const rewoundTo = this.nowMs - clampRewindMs(this.nowMs, msg.renderTimeMs);
    const shooterThen = this.hitboxes.positionAt(slot.netId, rewoundTo) ?? slot.state;
    const origin = eyePosition(shooterThen.x, shooterThen.y, shooterThen.z);

    for (const dir of shotDirections(slot.weapon, shot, slot.netId, msg.tick, yaw, pitch)) {
      const hit = resolveShot(
        this.hitboxes,
        {
          shooterNetId: slot.netId,
          ray: { origin, direction: dir, maxDistance: slot.weapon.maxRangeM },
          nowMs: this.nowMs,
          clientRenderTimeMs: msg.renderTimeMs,
        },
        DEFAULT_HITBOX,
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
        dealt = zoneDamage(damageAtDistance(slot.weapon, hit.distance), zone);

        const target = this.slots.find((s) => s.netId === hit.netId);
        if (target) {
          const result = applyDamage(target.health, dealt, this.nowMs / 1000);
          dealt = result.applied;
          /**
           * A killed player stops moving immediately: their queued inputs are
           * intent from before they died, and letting a corpse run out its
           * buffer looks like the hit did not register. A DOWNED player keeps
           * their queue too — the controller ignores it and holds them still
           * (B-05) — so a revive or death still lands on the tick it should.
           */
          if (result.killed) target.queue.length = 0;
        }
        // Range targets take no damage yet: they have no health because they
        // have no behaviour. Both arrive together when M2 gives them AI.
      }

      // A scenery stop is a hit event on netId 0 at the wall: everyone draws
      // the tracer ending there, nobody takes damage (T-1.12).
      const event: Message = hit
        ? {
            kind: 'HitEvent',
            shooterNetId: slot.netId,
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
            shooterNetId: slot.netId,
            targetNetId: 0,
            x: origin.x + dir.x * slot.weapon.maxRangeM,
            y: origin.y + dir.y * slot.weapon.maxRangeM,
            z: origin.z + dir.z * slot.weapon.maxRangeM,
            originX: origin.x,
            originY: origin.y,
            originZ: origin.z,
            damage: 0,
          };
      for (const c of this.connections) c.send(event);
    }
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

    const def = projectileByIndex(msg.projectile);
    if (def === null) return; // Out-of-range index: drop it, do not throw.
    const nowSeconds = this.nowMs / 1000;
    if (nowSeconds < slot.nextThrowAt) return;
    const left = slot.pouch[msg.projectile] ?? 0;
    if (left <= 0) return;
    // Nothing is spent on a throw the session has no room for.
    if (this.projectiles.length >= MAX_PROJECTILES) return;
    slot.pouch[msg.projectile] = left - 1;
    slot.nextThrowAt = nowSeconds + def.cooldownSeconds;

    const yaw = msg.yaw & 0xfff;
    const pitch = msg.pitch & 0xfff;
    const direction = dirFromYawPitch(yaw, pitch);
    const eye = eyePosition(slot.state.x, slot.state.y, slot.state.z);
    const origin = launchOrigin(def, eye, direction, LAUNCH_AHEAD_M, this.projectileWorld());
    this.projectiles.push({
      netId: this.nextProjectileNetId++,
      def,
      kind: msg.projectile,
      ownerSlot: slot.index,
      ownerNetId: slot.netId,
      state: createProjectileState(origin, launchVelocity(def, yaw, pitch)),
    });
  }

  /** The boxes and the floor a projectile collides with: the shared world. */
  private projectileWorld(): ProjectileWorld {
    return { boxes: DEFAULT_WORLD, groundY: this.moveConfig.groundY };
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
        DEFAULT_WORLD,
      );
      if (damage <= 0) continue;
      const result = applyDamage(slot.health, damage, nowSeconds);
      // A killed player stops moving immediately, as under fire (see applyFire).
      if (result.killed) slot.queue.length = 0;
      targets.push({ netId: slot.netId, damage: result.applied });
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
    }

    const nowSeconds = now / 1000;
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
          slot.pouch = fullPouch();
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
          slot.state = stepCharacter(slot.state, slot.input, TICK_SECONDS, this.moveConfig);
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
      slot.state = stepCharacter(slot.state, slot.input, TICK_SECONDS, this.moveConfig);
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
    const snapshot = this.buildSnapshot();
    this.history.store(snapshot);
    this.broadcast(snapshot);
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
        reviver.isBot ||
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
      if (reviver.isBot || !isAlive(reviver.health) || !this.holdingInteract(reviver)) continue;
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

  /** Holding E as of the newest real input, and not silent past the repeat window. */
  private holdingInteract(slot: Slot): boolean {
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
          ],
        },
      }));

    /**
     * Projectiles are entities like any other, and the only ones that come and
     * go: they carry a Transform and a Velocity — the velocity so a client can
     * point a rocket along its flight and smooth between samples — and a
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

      // Per-client baseline: whatever they last acknowledged. If that has aged
      // out of the ring they get a full snapshot, which is self-healing.
      const baseline = conn.lastAckedTick >= 0 ? this.history.get(conn.lastAckedTick) : null;
      const w = new BitWriter();
      writeDelta(w, snapshot, baseline);
      const payload = w.toUint8Array();

      const slot = this.slots.find((sl) => sl.connection === conn);
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
    for (const conn of [...this.connections]) conn.reject('host draining', reason);
    this.connections.clear();
  }
}
