/**
 * The browser's networked client (T-1.14, T-1.15, T-1.16 finally in the page).
 *
 * Deliberately a sibling of BotClient rather than a reimplementation: same
 * predict/reconcile path from `shared`, same snapshot store, same reconcile
 * rule. The bot proves that path in CI; this one makes it visible. Anything
 * this file did differently would make the bot's evidence worthless.
 *
 * Two things it adds that the bot does not need: interpolation buffers for
 * remote entities (the bot has no renderer), and hit events (the bot does not
 * shoot).
 */
import {
  COMPONENT_IDS,
  InterpolationBuffer,
  type InterpResult,
  INTERPOLATION_DELAY_MS,
  type Message,
  type MoveConfig,
  type MoveInput,
  type MoveState,
  PROTOCOL_VERSION,
  POSITION,
  Predictor,
  SnapshotStore,
  TICK_SECONDS,
  type Transport,
  VELOCITY,
  decodeMessage,
  dequantize,
  encodeMessage,
} from '@sandline/shared';

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const TICK_MS = TICK_SECONDS * 1000;

export interface ServerShot {
  shooterNetId: number;
  /** 0 when the shot hit nothing. */
  targetNetId: number;
  x: number;
  y: number;
  z: number;
  damage: number;
}

export interface NetStats {
  joined: boolean;
  netId: number;
  serverTick: number;
  snapshotsApplied: number;
  rejectedDeltas: number;
  missedBaselines: number;
  corrections: number;
  reconciles: number;
  lastDivergence: number;
  peakDivergence: number;
  remotes: number;
}

export class NetClient {
  private readonly store = new SnapshotStore();
  private predictor: Predictor | null = null;
  private readonly buffers = new Map<number, InterpolationBuffer>();
  private netIdValue = -1;
  private joinedFlag = false;

  private snapshotsApplied = 0;
  private rejectedDeltas = 0;
  private reconciles = 0;
  /**
   * Counted from `result.corrected`, NOT from `Predictor.corrections`.
   *
   * Those two disagree. `Predictor.reconcile` increments its own counter only
   * on the replay path; when the acknowledged tick has aged out of history it
   * snaps straight to authority, returns `corrected: true`, and never counts
   * it. That is the most violent correction there is, so a netgraph fed from
   * the internal counter would under-report precisely the worst case. Raised
   * for T-1.23 rather than changed here: the same counter feeds T-1.22's exit
   * gate, and moving a gate's metric is not a side effect of a client change.
   */
  private correctionCount = 0;
  private lastDivergence = 0;
  private peakDivergence = 0;
  private newestServerMs = 0;
  /**
   * Local estimate of the server's clock, advanced by frame time and pulled
   * forward whenever a fresher snapshot lands. Remote entities render at
   * `this - INTERPOLATION_DELAY_MS` (T-1.16); without a clock that keeps
   * running between snapshots they would step once per arrival instead of
   * moving smoothly.
   */
  private serverClockMs = 0;

  /** Authoritative shot outcomes. Set by the renderer to draw tracers. */
  onShot: ((shot: ServerShot) => void) | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly name: string,
    /**
     * Shared with the server's session by reference, so the movement tuning
     * panel cannot move one without the other. Two configs that drifted would
     * mispredict every tick.
     */
    private readonly moveConfig?: MoveConfig,
  ) {
    transport.onMessage((bytes) => this.handle(bytes));
  }

  get netId(): number {
    return this.netIdValue;
  }

  get joined(): boolean {
    return this.joinedFlag;
  }

  get stats(): NetStats {
    return {
      joined: this.joinedFlag,
      netId: this.netIdValue,
      serverTick: Math.round(this.newestServerMs / TICK_MS),
      snapshotsApplied: this.snapshotsApplied,
      rejectedDeltas: this.rejectedDeltas,
      missedBaselines: this.store.missedBaselines,
      corrections: this.correctionCount,
      reconciles: this.reconciles,
      lastDivergence: this.lastDivergence,
      peakDivergence: this.peakDivergence,
      remotes: this.buffers.size,
    };
  }

  join(): void {
    this.transport.send(
      encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: this.name }),
    );
  }

  /** Predict one tick locally and send the input. Unreliable: a lost input is
   *  covered by the server's repeat-then-idle rule, and resending stale input
   *  would be worse than dropping it. */
  tick(tickNumber: number, input: MoveInput, pitch: number): void {
    if (!this.joinedFlag || !this.predictor) return;
    this.predictor.predict(tickNumber, input);
    this.transport.send(
      encodeMessage({
        kind: 'Input',
        tick: tickNumber,
        moveX: input.moveX,
        moveY: input.moveY,
        yaw: input.yaw,
        pitch,
        buttons: (input.jump ? 1 : 0) | (input.sprint ? 2 : 0) | (input.crouch ? 4 : 0),
      }),
      'unreliable',
    );
  }

  /**
   * Pull the trigger. Reliable: a dropped shot is a shot the player took and
   * never got, which is far more noticeable than a dropped movement input.
   *
   * `renderTimeMs` is what the server rewinds hitboxes to, so it must be the
   * time this client was actually RENDERING — the interpolated past, not now.
   */
  fire(tick: number, yaw: number, pitch: number, weapon: number, ads: boolean): void {
    if (!this.joinedFlag) return;
    this.transport.send(
      encodeMessage({
        kind: 'Fire',
        tick,
        yaw,
        pitch,
        renderTimeMs: Math.max(0, Math.round(this.serverClockMs - INTERPOLATION_DELAY_MS)),
        weapon,
        ads,
      }),
      'reliable',
    );
  }

  /** Advance the local view of server time. Call once per frame. */
  advanceClock(frameMs: number): void {
    this.serverClockMs += frameMs;
    if (this.newestServerMs > this.serverClockMs) this.serverClockMs = this.newestServerMs;
  }

  /** Smoothed local position, or null before the first authoritative state. */
  renderPosition(frameMs: number): { x: number; y: number; z: number } | null {
    return this.predictor ? this.predictor.renderPosition(frameMs) : null;
  }

  get simulated(): MoveState | null {
    return this.predictor?.simulated ?? null;
  }

  /** Every remote entity, sampled at the interpolation delay. */
  remotes(): Map<number, InterpResult> {
    const out = new Map<number, InterpResult>();
    const renderAt = this.serverClockMs - INTERPOLATION_DELAY_MS;
    for (const [netId, buffer] of this.buffers) {
      const sample = buffer.sample(renderAt);
      if (sample) out.set(netId, sample);
    }
    return out;
  }

  private handle(bytes: Uint8Array): void {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      this.rejectedDeltas++;
      return;
    }

    switch (msg.kind) {
      case 'JoinAck':
        this.netIdValue = msg.netId;
        this.joinedFlag = true;
        // The predictor is NOT created here, for the reason BotClient gives:
        // JoinAck does not say where we spawned, and assuming the origin
        // guarantees a large bogus correction on the first snapshot.
        break;

      case 'Delta': {
        const result = this.store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
        if (!result.ok || !result.snapshot) {
          this.rejectedDeltas++;
          return;
        }
        this.snapshotsApplied++;
        this.transport.send(encodeMessage({ kind: 'Ack', tick: msg.tick }), 'unreliable');

        const serverMs = msg.tick * TICK_MS;
        if (serverMs > this.newestServerMs) this.newestServerMs = serverMs;
        this.ingest(result.snapshot.entities, msg.tick, serverMs, msg.lastProcessedInputTick);
        break;
      }

      case 'HitEvent':
        this.onShot?.({
          shooterNetId: msg.shooterNetId,
          targetNetId: msg.targetNetId,
          x: msg.x,
          y: msg.y,
          z: msg.z,
          damage: msg.damage,
        });
        break;

      default:
        break;
    }
  }

  private ingest(
    entities: readonly { netId: number; components: Record<number, readonly number[]> }[],
    tick: number,
    serverMs: number,
    lastProcessedInputTick: number,
  ): void {
    for (const entity of entities) {
      const transform = entity.components[T];
      if (!transform) continue;

      const x = dequantize(transform[0] as number, POSITION);
      const y = dequantize(transform[1] as number, POSITION);
      const z = dequantize(transform[2] as number, POSITION);

      if (entity.netId === this.netIdValue) {
        const velocity = entity.components[V];
        this.reconcile(
          {
            x,
            y,
            z,
            vy: velocity ? dequantize(velocity[1] as number, VELOCITY) : 0,
            // Derived rather than replicated, as in BotClient: height already
            // answers the question and a dedicated bit would not pay for itself.
            grounded: y <= 0.001,
          },
          lastProcessedInputTick,
        );
        continue;
      }

      let buffer = this.buffers.get(entity.netId);
      if (!buffer) {
        buffer = new InterpolationBuffer();
        this.buffers.set(entity.netId, buffer);
      }
      buffer.push({ tick, serverTimeMs: serverMs, x, y, z, yaw: (transform[3] as number) & 0x3ff });
    }
  }

  private reconcile(authoritative: MoveState, lastProcessedInputTick: number): void {
    if (!this.predictor) {
      this.predictor = new Predictor(authoritative, this.moveConfig);
      return;
    }
    if (lastProcessedInputTick < 0) return;
    const result = this.predictor.reconcile(lastProcessedInputTick, authoritative);
    this.reconciles++;
    if (result.corrected) this.correctionCount++;
    this.lastDivergence = result.error;
    if (result.error > this.peakDivergence) this.peakDivergence = result.error;
  }
}
