/**
 * The mission's HUD line (T-3.34): one line, from the host's `Mission`
 * message alone — nothing here decides whether the objective is done.
 */
import { TICK_SECONDS, type MissionView } from '@sandline/shared';

/** The key that asks the host to start the mission again once it is over. */
export const RESTART_KEY = 'KeyP';

/** What the HUD shows for this state; empty with no mission. */
export function missionLine(view: MissionView | null): string {
  if (!view) return '';
  const held = Math.floor(view.heldTicks * TICK_SECONDS);
  const hold = Math.round(view.holdTicks * TICK_SECONDS);
  const attempt = view.attempt > 1 ? `  ·  attempt ${view.attempt}` : '';
  if (view.state === 'complete') return `Objective held — mission complete${attempt}  ·  P to play again`;
  if (view.state === 'failed') return `Squad wiped — mission failed${attempt}  ·  P to try again`;
  if (!view.clear) return `Objective: clear the compound  ·  held ${held}/${hold} s${attempt}`;
  return `Objective: hold the compound  ·  held ${held}/${hold} s${attempt}`;
}
