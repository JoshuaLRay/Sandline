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
import { DEFAULT_WORLD, type WorldBox } from '../sim/world.ts';

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
  /**
   * Newest input tick the server has acknowledged. Reconciling against an
   * acknowledgement that has not advanced is not just useless, it is harmful —
   * see the guard in `reconcile`.
   */
  private lastAckTick = -1;

  constructor(
    initial: MoveState,
    private readonly config: MoveConfig = DEFAULT_MOVE_CONFIG,
    private readonly historyLength = DEFAULT_HISTORY,
    /**
     * The session's named world (T-3.02), from `JoinAck`: prediction must
     * collide with exactly the boxes the server collides with.
     */
    private readonly world: readonly WorldBox[] = DEFAULT_WORLD,
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
    this.state = stepCharacter(this.state, input, TICK_SECONDS, this.config, this.world);
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
    /**
     * Unacknowledged inputs are found BY TICK, not by position in the array.
     *
     * This used to require an exact entry for `serverTick` and, failing to find
     * one, snap to authority and clear the whole history. That is
     * self-sustaining: acknowledgements lag by a round trip, so the next one
     * refers to a tick older than everything kept after the wipe, which fails
     * to match, which wipes again. One bad reconcile poisoned every reconcile
     * afterwards. Measured on an 80 ms / 15 ms jitter / 5% loss link: 814 of
     * 830 reconciles unmatched — the client hard-snapped to the server's
     * position thirty times a second and threw its predictions away each time,
     * which is prediction not working at all rather than prediction being
     * imprecise.
     *
     * The exact entry is only needed to MEASURE the error. Replaying needs the
     * inputs after that tick, and those are identifiable on their own.
     */
    /**
     * An acknowledgement that has not advanced carries no news about OUR
     * inputs, and acting on it is actively harmful.
     *
     * The server re-sends the same `lastProcessedInputTick` whenever it had
     * nothing buffered from this client for a tick. By then the client has
     * already trimmed that tick out of its history, so the entry is missing,
     * so it snaps to authority — comparing its present state against a server
     * state from a different moment, which reads as a large error and pulls the
     * player backwards. Every remaining lurch at 80 ms / 5% loss was one of
     * these. Waiting for the next advancing acknowledgement costs nothing: no
     * input of ours has been consumed in the meantime.
     */
    if (serverTick <= this.lastAckTick) {
      return { error: 0, corrected: false, replayed: 0, matched: true };
    }
    this.lastAckTick = serverTick;

    const matchIndex = this.history.findIndex((e) => e.tick === serverTick);
    const matched = matchIndex !== -1;
    const unacked = this.history.filter((e) => e.tick > serverTick);

    // Compare against our own prediction for that tick when we have it; against
    // where we currently believe we are when we do not.
    const reference = matched ? (this.history[matchIndex] as PredictionEntry).state : this.state;
    const error = distance(reference, serverState);
    if (error > this.peakError) this.peakError = error;

    if (matched && error <= CORRECTION_THRESHOLD_M) {
      // Within tolerance: keep our own prediction. Snapping here would mean
      // correcting on every single snapshot for sub-centimetre differences.
      this.history = unacked;
      return { error, corrected: false, replayed: 0, matched };
    }

    const before = this.state;

    // Snap to authority, then re-apply what the server has not seen yet.
    let replayed = serverState;
    this.history = [];
    for (const entry of unacked) {
      replayed = stepCharacter(replayed, entry.input, TICK_SECONDS, this.config, this.world);
      this.history.push({ tick: entry.tick, input: entry.input, state: replayed });
    }
    this.state = replayed;

    /**
     * Counted here, once, on the only path that can correct. The old code had
     * two paths and incremented on one of them, so the counter read near zero
     * while a third of reconciles were correcting.
     */
    const corrected = error > CORRECTION_THRESHOLD_M;
    if (corrected) {
      this.corrections++;
      this.applySmoothing(before, replayed);
    }

    return { error, corrected, replayed: unacked.length, matched };
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
      //
      // An ease-out curve was tried and reverted: it front-loads by
      // construction, which is the thing the test above this decision exists to
      // prevent, and with corrections now rare and under 0.15 m there was no
      // measurable feel to gain by overturning that call.
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
    this.lastAckTick = -1;
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
