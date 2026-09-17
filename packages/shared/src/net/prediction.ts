/**
 * Client-side prediction and reconciliation (T-1.14, T-1.15, ADR-012).
 *
 * The local player is applied IMMEDIATELY through the same `stepCharacter` the
 * server runs, so movement responds to input without waiting a round trip. The
 * server remains authoritative: when its snapshot arrives, we snap to what it
 * says and replay every input it had not yet seen.
 *
 * Lives in `shared`, not `client`, because the headless bot client (T-1.20)
 * runs exactly this path — that is what lets the netcode CI matrix (T-1.22)
 * measure prediction quality without a browser.
 *
 * Only the local player is predicted (ADR-012). Remote entities are
 * interpolated instead; see interpolate.ts.
 */
import {
  type MoveConfig,
  type MoveInput,
  type MoveState,
  DEFAULT_MOVE_CONFIG,
  stepCharacter,
} from '../sim/CharacterController.ts';
import { TICK_SECONDS } from '../sim/Clock.ts';

export interface PredictionEntry {
  tick: number;
  input: MoveInput;
  /** State AFTER applying `input` at `tick`. */
  state: MoveState;
}

export interface ReconcileResult {
  /** Distance between what we predicted and what the server says. */
  error: number;
  /** True when the error exceeded the threshold and a correction was applied. */
  corrected: boolean;
  /** Unacknowledged inputs re-simulated on top of the authoritative state. */
  replayed: number;
  /** False when the server referenced a tick we no longer hold. */
  matched: boolean;
}

/**
 * Below this, the correction is not worth applying: it is within quantization
 * noise (POSITION is 1/64 m, so ~7.8 mm of error is unavoidable) and snapping
 * for it would mean correcting constantly for no visible gain.
 */
export const CORRECTION_THRESHOLD_M = 0.02;

/** Residual error is eased out over this long rather than snapped. */
export const SMOOTHING_MS = 100;

/** Inputs kept for replay. At 30 Hz this is four seconds, far beyond any RTT. */
const DEFAULT_HISTORY = 128;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class Predictor {
  private history: PredictionEntry[] = [];
  private state: MoveState;
  /**
   * Visual-only offset. On correction the render position keeps its old value
   * and this offset decays to zero, so the player sees a slide rather than a
   * teleport. It never feeds back into the simulation.
   */
  private smoothing: Vec3 = { x: 0, y: 0, z: 0 };
  /** The offset at the moment of correction; the live one is scaled from it. */
  private smoothingInitial: Vec3 = { x: 0, y: 0, z: 0 };
  private smoothingRemainingMs = 0;

  /** Peak correction distance seen, for the netgraph (T-1.23). */
  peakError = 0;
  /** How many corrections exceeded the threshold. */
  corrections = 0;

  constructor(
    initial: MoveState,
    private readonly config: MoveConfig = DEFAULT_MOVE_CONFIG,
    private readonly historyLength = DEFAULT_HISTORY,
  ) {
    this.state = initial;
  }

  /** Authoritative-shape state: what the simulation believes. */
  get simulated(): MoveState {
    return this.state;
  }

  get pendingInputs(): number {
    return this.history.length;
  }

  /** Apply one input immediately and remember it for replay. */
  predict(tick: number, input: MoveInput): MoveState {
    this.state = stepCharacter(this.state, input, TICK_SECONDS, this.config);
    this.history.push({ tick, input, state: this.state });
    if (this.history.length > this.historyLength) this.history.shift();
    return this.state;
  }

  /**
   * Fold in an authoritative state for `serverTick`.
   *
   * The server has processed inputs up to serverTick; everything after it is
   * still in flight, so it is replayed on top of the authoritative state.
   */
  reconcile(serverTick: number, serverState: MoveState): ReconcileResult {
    const index = this.history.findIndex((e) => e.tick === serverTick);
    if (index === -1) {
      // The tick aged out, or arrived before we predicted it. Trust the server
      // outright rather than replaying against a baseline we do not have.
      const error = distance(this.state, serverState);
      this.applySmoothing(this.state, serverState);
      this.state = serverState;
      this.history = [];
      if (error > this.peakError) this.peakError = error;
      return { error, corrected: error > CORRECTION_THRESHOLD_M, replayed: 0, matched: false };
    }

    const predicted = this.history[index]!.state;
    const error = distance(predicted, serverState);
    if (error > this.peakError) this.peakError = error;

    // Drop everything the server has already accounted for.
    const unacked = this.history.slice(index + 1);
    this.history = [];

    if (error <= CORRECTION_THRESHOLD_M) {
      // Within tolerance: keep our own prediction. Snapping here would mean
      // correcting on every single snapshot for sub-centimetre differences.
      this.history = unacked;
      return { error, corrected: false, replayed: 0, matched: true };
    }

    const before = this.state;

    // Snap to authority, then re-apply what the server has not seen yet.
    let replayed = serverState;
    for (const entry of unacked) {
      replayed = stepCharacter(replayed, entry.input, TICK_SECONDS, this.config);
      this.history.push({ tick: entry.tick, input: entry.input, state: replayed });
    }
    this.state = replayed;
    this.corrections++;
    this.applySmoothing(before, replayed);

    return { error, corrected: true, replayed: unacked.length, matched: true };
  }

  /** Remember where we were, so rendering can ease across to where we now are. */
  private applySmoothing(from: MoveState, to: MoveState): void {
    this.smoothingInitial = { x: from.x - to.x, y: from.y - to.y, z: from.z - to.z };
    this.smoothing = { ...this.smoothingInitial };
    this.smoothingRemainingMs = SMOOTHING_MS;
  }

  /**
   * Position to draw: the simulated state plus the decaying correction offset.
   * Call once per frame with the frame delta.
   */
  renderPosition(frameDeltaMs: number): Vec3 {
    if (this.smoothingRemainingMs > 0) {
      this.smoothingRemainingMs = Math.max(0, this.smoothingRemainingMs - frameDeltaMs);

      // Scale the ORIGINAL offset by the fraction of time remaining. Scaling
      // the live offset instead compounds: it decays far faster than
      // SMOOTHING_MS suggests, putting most of the correction in the first few
      // frames — which is the visible snap this exists to avoid.
      //
      // Linear rather than exponential partly because Math.exp is banned in
      // shared (ADR-014), and partly because it finishes at a known time.
      const scale = this.smoothingRemainingMs / SMOOTHING_MS;
      this.smoothing = {
        x: this.smoothingInitial.x * scale,
        y: this.smoothingInitial.y * scale,
        z: this.smoothingInitial.z * scale,
      };
    }
    return {
      x: this.state.x + this.smoothing.x,
      y: this.state.y + this.smoothing.y,
      z: this.state.z + this.smoothing.z,
    };
  }

  /** Distance still being eased out. Zero when settled. */
  get smoothingError(): number {
    const s = this.smoothing;
    return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
  }

  reset(state: MoveState): void {
    this.state = state;
    this.history = [];
    this.smoothing = { x: 0, y: 0, z: 0 };
    this.smoothingRemainingMs = 0;
  }
}

export function distance(a: MoveState | Vec3, b: MoveState | Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
