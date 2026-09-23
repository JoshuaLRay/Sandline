/**
 * The mission's one objective (T-3.34): clear the world's objective area and
 * hold it for `data/mission.json`'s `holdSeconds`; fail on a squad wipe.
 * Evaluated once a tick on the server, from what the session tells it —
 * nothing here reads the session, so the rule is testable on its own.
 *
 * The hold counts a tick when no living enemy is inside the area and at
 * least one living squad soldier (human or bot) is; any living enemy inside
 * sets it back to zero; the squad stepping out with the area still clear
 * pauses it. Complete once it reaches the hold; failed when every slot is
 * dead at once. Both are final until a restart (`reset`).
 */
import { MISSION, type MissionConfig, type MissionView, TICK_SECONDS } from '@sandline/shared';

/** What the session tells the mission each tick. */
export interface MissionTick {
  /** Living enemies inside the objective area. */
  enemiesInside: number;
  /** Living squad soldiers inside it. */
  squadInside: number;
  /** Every slot is dead. */
  wiped: boolean;
}

export class MissionRun {
  private view: MissionView;

  constructor(private readonly config: MissionConfig = MISSION) {
    this.view = { state: 'progress', clear: false, heldTicks: 0, holdTicks: Math.round(config.holdSeconds / TICK_SECONDS), attempt: 1 };
  }

  /** Where the mission stands. */
  get current(): Readonly<MissionView> {
    return this.view;
  }

  /** Evaluate one tick. Returns true when anything a client shows changed: the state, the area's clearness, or a whole second of hold. */
  step(t: MissionTick): boolean {
    if (this.view.state !== 'progress') return false;
    const before = { ...this.view };
    const clear = t.enemiesInside === 0;
    let held = before.heldTicks;
    if (!clear) held = 0;
    else if (t.squadInside > 0) held = Math.min(before.holdTicks, held + 1);
    let state: MissionView['state'] = 'progress';
    if (t.wiped) state = 'failed';
    else if (held >= before.holdTicks) state = 'complete';
    this.view = { ...before, state, clear, heldTicks: held };
    const second = (ticks: number) => Math.floor(ticks * TICK_SECONDS);
    return state !== before.state || clear !== before.clear || second(held) !== second(before.heldTicks);
  }

  /** Start again: in progress, nothing held, the next attempt. */
  reset(): void {
    this.view = { state: 'progress', clear: false, heldTicks: 0, holdTicks: this.view.holdTicks, attempt: this.view.attempt + 1 };
  }

  /** Whether the respawn rule applies (`mission.respawn`). */
  get respawns(): boolean {
    return this.config.respawn;
  }
}
