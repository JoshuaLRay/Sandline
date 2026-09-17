/**
 * Fixed-timestep driver (T-0.08, ADR-012).
 *
 * The simulation ticks at a fixed 30 Hz regardless of frame rate. Rendering is
 * decoupled and interpolates between ticks; the simulation never sees a variable
 * delta, because a variable delta makes client and server disagree by
 * construction.
 *
 * Deterministic: given the same sequence of frame deltas, the same number of
 * ticks runs, every time, on every engine. It reads no wall clock itself — time
 * is passed in.
 */

export const TICK_HZ = 30;
export const TICK_SECONDS = 1 / TICK_HZ;

/**
 * Most catch-up steps permitted in one advance() call.
 *
 * Without this, a long stall (a backgrounded tab, a breakpoint, a GC pause)
 * produces an accumulator large enough that the catch-up itself takes longer
 * than the stall, which grows the accumulator further — the spiral of death.
 * We bound the work and discard the rest: the simulation falls behind wall time,
 * which is recoverable, rather than locking up, which is not.
 */
export const MAX_CATCHUP_STEPS = 5;

export class Clock {
  private accumulator = 0;
  private currentTick = 0;
  private droppedTicks = 0;

  get tick(): number {
    return this.currentTick;
  }

  /** Ticks discarded to spiral-of-death clamping. Non-zero means we stalled. */
  get dropped(): number {
    return this.droppedTicks;
  }

  /** Fraction through the current tick, for render interpolation. [0, 1). */
  get alpha(): number {
    return this.accumulator / TICK_SECONDS;
  }

  /**
   * Feed elapsed seconds; returns how many fixed steps to run now.
   * Negative or non-finite deltas are ignored rather than corrupting state.
   */
  advance(deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;

    this.accumulator += deltaSeconds;

    let steps = 0;
    while (this.accumulator >= TICK_SECONDS && steps < MAX_CATCHUP_STEPS) {
      this.accumulator -= TICK_SECONDS;
      steps++;
    }

    if (this.accumulator >= TICK_SECONDS) {
      // Still behind after the cap: drop the backlog and resync.
      const lost = Math.floor(this.accumulator / TICK_SECONDS);
      this.droppedTicks += lost;
      this.accumulator -= lost * TICK_SECONDS;
    }

    this.currentTick += steps;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.currentTick = 0;
    this.droppedTicks = 0;
  }
}
