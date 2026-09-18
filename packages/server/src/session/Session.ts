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
  createMoveState,
  createWeaponState,
  damageAtDistance,
  dirFromYawPitch,
  encodeMessage,
  finishReload,
  getWeapon,
  muzzlePosition,
  shotDirections,
  startReload,
  tryFire,
  wireToTable,
  quantize,
  stepCharacter,
  writeDelta,
} from '@sandline/shared';
import { DEFAULT_HITBOX, HitboxHistory, resolveShot } from '../net/lagComp.ts';

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;

export interface Slot {
  index: number;
  netId: number;
  isBot: boolean;
  state: MoveState;
  yaw: number;
  input: MoveInput;
  /** Tick of the newest input actually consumed, echoed back for reconciliation. */
  lastProcessedInputTick: number;
  /** Newest input received but not yet stepped. */
  pendingInputTick: number;
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
}

/** ADR-012: repeat a missing input this many ticks, then treat it as idle. */
export const MAX_INPUT_REPEAT = 5;

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

  constructor() {
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
        staleTicks: 0,
        connection: null,
        weapon: getWeapon(WEAPON_IDS[0]),
        weaponState: createWeaponState(getWeapon(WEAPON_IDS[0])),
        pitch: 0,
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
    slot.input = {
      moveX: msg.moveX,
      moveY: msg.moveY,
      yaw: msg.yaw,
      jump: (msg.buttons & 0b001) !== 0,
      sprint: (msg.buttons & 0b010) !== 0,
      crouch: (msg.buttons & 0b100) !== 0,
    };
    slot.yaw = msg.yaw;
    slot.pendingInputTick = msg.tick;
    slot.staleTicks = 0;
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
    const forward = dirFromYawPitch(yaw, wireToTable(msg.pitch));
    const origin = muzzlePosition(
      slot.state.x,
      slot.state.y,
      slot.state.z,
      forward.x,
      forward.z,
      msg.ads,
    );

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

      const event: Message = hit
        ? {
            kind: 'HitEvent',
            shooterNetId: slot.netId,
            targetNetId: hit.netId,
            x: hit.point.x,
            y: hit.point.y,
            z: hit.point.z,
            // Applying this to health is T-1.19; the number travels now so the
            // client can show it and so that task has nothing to re-derive.
            damage: damageAtDistance(slot.weapon, hit.distance),
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

    for (const slot of this.slots) {
      if (!slot.isBot) {
        // Input has not arrived: repeat the last one briefly, then go idle
        // rather than running the player into a wall indefinitely.
        slot.staleTicks++;
        if (slot.staleTicks > MAX_INPUT_REPEAT) slot.input = idleInput(slot.yaw);
      }
      slot.state = stepCharacter(slot.state, slot.input, TICK_SECONDS, DEFAULT_MOVE_CONFIG);
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
            0,
          ],
          // Vertical velocity must replicate or a client reconciling mid-jump
          // snaps to the right height with the wrong momentum and diverges again
          // on the very next tick.
          [V]: [quantize(0, VELOCITY), quantize(s.state.vy, VELOCITY), quantize(0, VELOCITY)],
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
