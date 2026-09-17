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
  createMoveState,
  encodeMessage,
  quantize,
  stepCharacter,
  writeDelta,
} from '@sandline/shared';

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
  private currentTick = 0;
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

  /** Advance one authoritative tick and broadcast. */
  step(now: number): void {
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
