/**
 * Drops the bogus mouse jumps browsers report under pointer lock.
 *
 * QA: rarely, early in a session, the view jumped to face another way (in
 * third person the camera swung round with it, which reads as a teleport).
 * Chromium sometimes reports one `mousemove` with a huge `movementX`/`Y` —
 * hundreds of pixels, the distance to where the hidden cursor was — right
 * after pointer lock is taken, after fullscreen is entered or left, and on a
 * window resize. Clicking into the canvas does the first two at once
 * (B-06), which is why it happened near the start and then not again. At
 * the default sensitivity 500 px is a quarter turn and more, in one frame.
 *
 * Two rules, both on a single event's larger axis:
 *   - SETTLING: for `settleMs` after lock, fullscreen or resize, an event
 *     over `settleMaxPx` is dropped. Ordinary moves in that window still
 *     count, so the view is never dead.
 *   - A SPIKE: any other time, an event over `spikePx` is dropped when it is
 *     more than `spikeRatio` times the recent movement. A real flick builds
 *     up over several events, raising the recent movement as it goes, so it
 *     passes; a jump out of stillness does not.
 */
export interface MouseGuardConfig {
  settleMs: number;
  settleMaxPx: number;
  spikePx: number;
  spikeRatio: number;
}

export const MOUSE_GUARD: MouseGuardConfig = { settleMs: 250, settleMaxPx: 120, spikePx: 400, spikeRatio: 10 };

/** The recent movement's floor, px: from stillness a spike is measured against this. */
const RESTING_PX = 4;
/** How much of each accepted event goes into the recent movement. */
const RECENT_WEIGHT = 0.3;

export class MouseGuard {
  private settleUntil = -Infinity;
  private recent = RESTING_PX;
  dropped = 0;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly config: MouseGuardConfig = MOUSE_GUARD,
  ) {}

  /** Lock, fullscreen or the window's size changed: the next moments' big jumps are not the player's. */
  settle(): void {
    this.settleUntil = this.now() + this.config.settleMs;
    this.recent = RESTING_PX;
  }

  /** Whether this event's movement is the player's. */
  accept(dx: number, dy: number): boolean {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    if (!Number.isFinite(size)) return this.drop();
    if (this.now() < this.settleUntil && size > this.config.settleMaxPx) return this.drop();
    if (size > this.config.spikePx && size > this.config.spikeRatio * this.recent) return this.drop();
    this.recent = Math.max(RESTING_PX, this.recent + (size - this.recent) * RECENT_WEIGHT);
    return true;
  }

  private drop(): false {
    this.dropped++;
    return false;
  }
}
