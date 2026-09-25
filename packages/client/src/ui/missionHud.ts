/**
 * The mission's HUD line (T-3.34; a sequence of objective types since
 * T-4.14): one line, from the host's `Mission` message alone — nothing here
 * decides whether an objective is done.
 */
import { PROGRESSION, TICK_SECONDS, type MissionView, type SoldierProgress } from '@sandline/shared';

/** The key that asks the host to start the mission again once it is over. */
export const RESTART_KEY = 'KeyP';

const secs = (ticks: number, round: (n: number) => number = Math.floor) => round(ticks * TICK_SECONDS);

/** What the current objective asks, and how far along it is. */
function objectiveText(view: MissionView): string {
  const clock = `${secs(view.progress)}/${secs(view.goal, Math.round)} s`;
  switch (view.type) {
    case 'clear-and-hold':
      return view.satisfied ? `hold ${view.label}  ·  held ${clock}` : `clear ${view.label}  ·  held ${clock}`;
    case 'reach':
      return `reach ${view.label}  ·  ${view.progress}/${view.goal} there`;
    case 'destroy':
      return `destroy ${view.label}  ·  ${view.progress}/${view.goal} down`;
    case 'defend':
      return `defend ${view.label}  ·  ${clock}${view.satisfied ? '' : '  ·  overrun!'}`;
    case 'survive':
      return `survive ${view.label}  ·  ${clock}`;
  }
}

/** What the HUD shows for this state; empty with no mission. */
export function missionLine(view: MissionView | null): string {
  if (!view) return '';
  const attempt = view.attempt > 1 ? `  ·  attempt ${view.attempt}` : '';
  if (view.state === 'complete') return `Mission complete${attempt}  ·  P to play again`;
  if (view.state === 'failed') {
    const why = view.type === 'defend' && !view.satisfied ? `${view.label} overrun` : 'Squad wiped';
    return `${why[0]!.toUpperCase()}${why.slice(1)} — mission failed${attempt}  ·  P to try again`;
  }
  const step = view.objectives > 1 ? ` ${view.objective + 1}/${view.objectives}` : '';
  return `Objective${step}: ${objectiveText(view)}${attempt}`;
}

/** Mission-end credit comes only from the host, including any other slots you played. */
export function afterActionXp(view: MissionView | null, soldiers: readonly SoldierProgress[], localSlot: number): string {
  if (!view || view.state === 'progress') return '';
  return soldiers.filter((soldier) => soldier.slot === localSlot || soldier.earned > 0)
    .map((soldier) => `Soldier ${soldier.slot + 1}: you earned ${soldier.earned} XP · ${PROGRESSION.ranks[soldier.rank]?.name ?? 'Unknown rank'} · ${soldier.xp} XP total`)
    .join('\n');
}
