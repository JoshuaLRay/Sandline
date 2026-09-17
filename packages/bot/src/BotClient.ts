/**
 * Headless bot client (T-1.20).
 *
 * A complete client — transport, prediction, reconciliation, snapshot store —
 * with no renderer. This is the highest-leverage piece of tooling in the
 * project: it turns "does multiplayer work under 200ms and 20% loss?" from a
 * human judgement call into a CI assertion (T-1.22).
 *
 * It runs the SAME prediction and reconciliation code the browser client runs,
 * from `shared`. A bot that ran its own simplified path would prove nothing
 * about the real one.
 */
import {
  type Message,
  type MoveInput,
  type MoveState,
  COMPONENT_IDS,
  PROTOCOL_VERSION,
  POSITION,
  Predictor,
  Sfc32,
  SnapshotStore,
  type Transport,
  VELOCITY,
  decodeMessage,
  dequantize,
  distance,
  encodeMessage,
} from '@sandline/shared';

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;

export interface BotMetrics {
  /** Largest gap between prediction and authority, in metres. */
  peakDivergence: number;
  /** Divergence on the most recent reconcile. */
  lastDivergence: number;
  /** Corrections that exceeded the threshold. */
  corrections: number;
  /** Reconciles performed — the denominator for correction rate. */
  reconciles: number;
  snapshotsApplied: number;
  /** Deltas dropped because their baseline had been lost. */
  missedBaselines: number;
  /** Deltas that arrived but could not be applied for any reason. */
  rejectedDeltas: number;
  joined: boolean;
  disconnectReason: string | null;
}

export interface BotOptions {
  name: string;
  /** Seeds the input walk. Same seed, same behaviour, every run. */
  seed?: number;
  /** Fixed input sequence; overrides the random walk when supplied. */
  script?: readonly MoveInput[];
}

/**
 * A wandering input generator.
 *
 * Deliberately not `Math.random`: a netcode test that behaves differently on
 * each run cannot be debugged when it fails.
 */
class InputWalk {
  private readonly rng: Sfc32;
  private current: MoveInput;

  constructor(seed: number) {
    this.rng = new Sfc32(seed);
    this.current = { moveX: 0, moveY: 1, yaw: 0, jump: false, sprint: false, crouch: false };
  }

  next(): MoveInput {
    // Change direction occasionally rather than every tick, so motion looks
    // like a player moving rather than jitter that averages to standing still.
    if (this.rng.nextUint32() % 20 === 0) {
      this.current = {
        moveX: (this.rng.nextUint32() % 3) - 1,
        moveY: (this.rng.nextUint32() % 3) - 1,
        yaw: this.rng.nextUint32() % 1024,
        jump: this.rng.nextUint32() % 8 === 0,
        sprint: this.rng.nextUint32() % 3 === 0,
        crouch: false,
      };
    } else {
      this.current = { ...this.current, jump: this.rng.nextUint32() % 40 === 0 };
    }
    return this.current;
  }
}

export class BotClient {
  readonly store = new SnapshotStore();
  private predictor: Predictor | null = null;
  private readonly walk: InputWalk;
  private readonly script: readonly MoveInput[] | null;
  private netId = -1;
  private tickNumber = 0;

  private peakDivergence = 0;
  private lastDivergence = 0;
  private reconciles = 0;
  private snapshotsApplied = 0;
  private rejectedDeltas = 0;
  private joinedFlag = false;
  private disconnectReason: string | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly options: BotOptions,
  ) {
    this.walk = new InputWalk(options.seed ?? 1);
    this.script = options.script ?? null;
    transport.onMessage((bytes) => this.handle(bytes));
    transport.onClose((reason) => {
      this.disconnectReason ??= reason;
    });
  }

  get metrics(): BotMetrics {
    return {
      peakDivergence: this.peakDivergence,
      lastDivergence: this.lastDivergence,
      corrections: this.predictor?.corrections ?? 0,
      reconciles: this.reconciles,
      snapshotsApplied: this.snapshotsApplied,
      missedBaselines: this.store.missedBaselines,
      rejectedDeltas: this.rejectedDeltas,
      joined: this.joinedFlag,
      disconnectReason: this.disconnectReason,
    };
  }

  get joined(): boolean {
    return this.joinedFlag;
  }

  /** Fraction of reconciles that needed a correction — the headline quality number. */
  get correctionRate(): number {
    return this.reconciles === 0 ? 0 : (this.predictor?.corrections ?? 0) / this.reconciles;
  }

  join(): void {
    this.transport.send(
      encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: this.options.name }),
    );
  }

  /** Sample input, predict it locally, and send it. One call per tick. */
  tick(): void {
    if (!this.joinedFlag || !this.predictor) return;
    this.tickNumber++;

    const input = this.script
      ? (this.script[(this.tickNumber - 1) % this.script.length] as MoveInput)
      : this.walk.next();

    this.predictor.predict(this.tickNumber, input);

    this.transport.send(
      encodeMessage({
        kind: 'Input',
        tick: this.tickNumber,
        moveX: input.moveX,
        moveY: input.moveY,
        yaw: input.yaw,
        pitch: 0,
        buttons: (input.jump ? 1 : 0) | (input.sprint ? 2 : 0) | (input.crouch ? 4 : 0),
      }),
      'unreliable',
    );
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
        this.netId = msg.netId;
        this.joinedFlag = true;
        // The predictor is NOT created here. JoinAck does not say where we
        // spawned, and assuming the origin guarantees a large bogus correction
        // on the first snapshot - one that pollutes peak divergence with a
        // startup artefact rather than a netcode signal. It is created from the
        // first authoritative state instead: a client cannot predict before it
        // knows where it is.
        break;

      case 'Delta': {
        const result = this.store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
        if (!result.ok || !result.snapshot) {
          this.rejectedDeltas++;
          // Acking nothing is correct: the server keeps using an older baseline
          // or falls back to a full snapshot, which is self-healing.
          return;
        }
        this.snapshotsApplied++;
        this.transport.send(encodeMessage({ kind: 'Ack', tick: msg.tick }), 'unreliable');
        this.reconcileAgainst(result.snapshot.entities, msg.lastProcessedInputTick);
        break;
      }

      case 'Disconnect':
        this.disconnectReason = msg.reason;
        break;

      default:
        break;
    }
  }

  private reconcileAgainst(
    entities: readonly { netId: number; components: Record<number, readonly number[]> }[],
    lastProcessedInputTick: number,
  ): void {
    if (this.netId < 0) return;

    const mine = entities.find((e) => e.netId === this.netId);
    const transform = mine?.components[T];
    if (!transform) return;

    const velocity = mine?.components[V];
    const authoritative: MoveState = {
      x: dequantize(transform[0] as number, POSITION),
      y: dequantize(transform[1] as number, POSITION),
      z: dequantize(transform[2] as number, POSITION),
      vy: velocity ? dequantize(velocity[1] as number, VELOCITY) : 0,
      // Derived rather than replicated: a dedicated bit would cost more than
      // it is worth when height already answers the question.
      grounded: dequantize(transform[1] as number, POSITION) <= 0.001,
    };

    // First authoritative word on where we are: adopt it as the baseline.
    if (!this.predictor) {
      this.predictor = new Predictor(authoritative);
      return;
    }

    // Nothing of ours consumed yet, so there is nothing to reconcile against.
    if (lastProcessedInputTick < 0) return;

    const result = this.predictor.reconcile(lastProcessedInputTick, authoritative);
    this.reconciles++;
    this.lastDivergence = result.error;
    if (result.error > this.peakDivergence) this.peakDivergence = result.error;
  }

  /** Current predicted position, for cross-checking against the server. */
  get position(): MoveState | null {
    return this.predictor?.simulated ?? null;
  }

  /** Distance from this bot's prediction to a known authoritative position. */
  divergenceFrom(state: MoveState): number {
    return this.predictor ? distance(this.predictor.simulated, state) : Infinity;
  }
}
