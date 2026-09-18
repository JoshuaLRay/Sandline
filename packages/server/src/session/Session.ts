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
  ServerConnection,
  VELOCITY,
  SnapshotHistory,
  TICK_SECONDS,
  type Transport,
  type WorldSnapshot,
  WEAPON_IDS,
  type WeaponDef,
  type WeaponState,
  type HealthState,
  applyDamage,
  createHealth,
  createMoveState,
  createWeaponState,
  damageAtDistance,
  decayBloom,
  isAlive,
  readyToRespawn,
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
  wireToTable,
  quantize,
  stepCharacter,
  writeDelta,
} from '@sandline/shared';
import { DEFAULT_HITBOX, HitboxHistory, clampRewindMs, resolveShot } from '../net/lagComp.ts';

/**
 * Full standing height of a hitbox: cylinder plus both caps. Hit zones are
 * fractions of this, so they track the capsule rather than assuming 1.8 m.
 */
const HITBOX_HEIGHT = 2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius);

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const H = COMPONENT_IDS.Health;

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
  health: HealthState;
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
});

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
  constructor(private readonly moveConfig: MoveConfig = DEFAULT_MOVE_CONFIG) {
    // Six slots exist from the moment the session does (ADR-001).
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.slots.push({
        index: i,
        netId: this.nextNetId++,
        isBot: true,
        state: createMoveState(i * 1.5 - 3.75, 0, 0),
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
        health: createHealth(),
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

  /** Attach a transport. The connection handshakes before taking a slot. */
  addConnection(transport: Transport, now: number): ServerConnection {
    const conn = new ServerConnection(
      transport,
      {
        onJoined: (c) => this.assignSlot(c),
        onInput: (c, msg) => this.applyInput(c, msg),
        // NOT the `now` this connection was opened at: that value is frozen
        // forever. Fire resolves against the session's current time.
        onFire: (c, msg) => this.applyFire(c, msg),
        onClosed: (c) => this.releaseSlot(c),
      },
      now,
    );
    this.connections.add(conn);
    return conn;
  }

  private assignSlot(conn: ServerConnection): void {
    const slot = this.slots.find((s) => s.isBot);
    if (!slot) {
      conn.reject('session full');
      return;
    }
    // Take over the bot's entity in place: same netId, no spawn, no despawn.
    slot.isBot = false;
    slot.connection = conn;
    slot.staleTicks = 0;
    conn.accept(slot.netId, slot.index, this.currentTick);
  }

  private releaseSlot(conn: ServerConnection): void {
    this.connections.delete(conn);
    const slot = this.slots.find((s) => s.connection === conn);
    if (!slot) return;
    // Hand the entity back to a bot; it keeps its position and its netId.
    slot.isBot = true;
    slot.connection = null;
    slot.input = idleInput(slot.yaw);
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

    slot.pitch = msg.pitch;
    const yaw = wireToTable(msg.yaw);
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

    for (const dir of shotDirections(slot.weapon, shot, slot.netId, msg.tick, yaw, wireToTable(msg.pitch))) {
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
      if (hit) {
        /**
         * Zone from the impact point's height up the target's hitbox — which is
         * exactly why T-1.18 returns a point rather than only a distance.
         */
        const feet = this.hitboxes.positionAt(hit.netId, rewoundTo);
        const zone = zoneAt(hit.point.y, feet?.y ?? 0, HITBOX_HEIGHT);
        dealt = zoneDamage(damageAtDistance(slot.weapon, hit.distance), zone);

        const target = this.slots.find((s) => s.netId === hit.netId);
        if (target) {
          const result = applyDamage(target.health, dealt, this.nowMs / 1000);
          dealt = result.applied;
          /**
           * A killed player stops moving immediately: their queued inputs are
           * intent from before they died, and letting a corpse run out its
           * buffer looks like the hit did not register.
           */
          if (result.killed) target.queue.length = 0;
        }
        // Range targets take no damage yet: they have no health because they
        // have no behaviour. Both arrive together when M2 gives them AI.
      }

      const event: Message = hit
        ? {
            kind: 'HitEvent',
            shooterNetId: slot.netId,
            targetNetId: hit.netId,
            x: hit.point.x,
            y: hit.point.y,
            z: hit.point.z,
            damage: dealt,
          }
        : {
            kind: 'HitEvent',
            shooterNetId: slot.netId,
            targetNetId: 0,
            x: origin.x + dir.x * slot.weapon.maxRangeM,
            y: origin.y + dir.y * slot.weapon.maxRangeM,
            z: origin.z + dir.z * slot.weapon.maxRangeM,
            damage: 0,
          };
      for (const c of this.connections) c.send(event);
    }
  }

  /** Advance one authoritative tick and broadcast. */
  step(now: number): void {
    this.nowMs = now;
    for (const conn of [...this.connections]) {
      // Advance each connection's clock BEFORE testing the timeout: messages
      // arriving between ticks are stamped with the latest tick time.
      conn.setNow(now);
      if (conn.isTimedOut(now)) conn.reject('heartbeat timeout');
    }

    const nowSeconds = now / 1000;
    for (const slot of this.slots) {
      /**
       * Dead players do not move and do not fall: they wait out the timer and
       * reappear at their own spawn point with full health. Downed-and-revive
       * is M2 (ADR-002); death here is death.
       */
      if (!isAlive(slot.health)) {
        if (readyToRespawn(slot.health, nowSeconds)) {
          respawn(slot.health);
          const point = spawnFor(slot.index);
          slot.state = createMoveState(point.x, point.y, point.z);
          slot.queue.length = 0;
          slot.input = idleInput(slot.yaw);
          slot.weaponState = createWeaponState(slot.weapon);
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
          slot.pendingInputTick = ahead.tick;
          slot.staleTicks = 0;
          slot.state = stepCharacter(slot.state, slot.input, TICK_SECONDS, this.moveConfig);
          extra -= 1;
        }

        const next = slot.queue.shift();
        if (next) {
          slot.input = next.input;
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
          slot.input = idleInput(slot.yaw);
        }
      }
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

    // Record AFTER stepping, so the history holds the post-tick positions that
    // the snapshot about to go out will describe. Recording pre-step would
    // rewind clients to a world half a tick behind the one they were shown.
    for (const slot of this.slots) {
      this.hitboxes.record(slot.netId, now, slot.state.x, slot.state.y, slot.state.z);
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
    const snapshot = this.buildSnapshot();
    this.history.store(snapshot);
    this.broadcast(snapshot);
  }

  private buildSnapshot(): WorldSnapshot {
    return {
      tick: this.currentTick,
      entities: this.slots.map((s) => ({
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
          // server's side of the line.
          [H]: [Math.round(s.health.current), Math.round(s.health.max)],
        },
      })),
    };
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

  close(reason = 'session closed'): void {
    for (const conn of [...this.connections]) conn.reject(reason);
    this.connections.clear();
  }
}
