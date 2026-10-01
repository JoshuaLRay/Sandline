/**
 * The mission's HUD line (T-3.34; a sequence of objective types since
 * T-4.14): one line, from the host's `Mission` message alone — nothing here
 * decides whether an objective is done.
 */
import { PROGRESSION, TICK_SECONDS, type MissionDef, type MissionView, type SoldierProgress } from '@sandline/shared';

/** The key that asks the host to start the mission again once it is over. */
export const RESTART_KEY = 'KeyP';
export const FULL_RESTART_KEY = 'KeyO';

const secs = (ticks: number, round: (n: number) => number = Math.floor) => round(ticks * TICK_SECONDS);

/** What an objective's view says: the fields `MissionView` and one of its `open` entries share. */
type ObjectiveFields = Pick<MissionView, 'type' | 'label' | 'phase' | 'satisfied' | 'progress' | 'goal'>;

/** What the current objective asks, and how far along it is. */
function objectiveText(view: ObjectiveFields): string {
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
    case 'upload':
      return uploadText(view);
    case 'rescue':
      // U-063: nobody held completes it at once; otherwise the hold is the clock.
      return view.satisfied ? `freeing ${view.label}  ·  ${clock}  ·  keep holding E` : `free ${view.label}  ·  hold E beside them  ·  ${secs(view.goal, Math.round)} s`;
  }
}

/**
 * U-009: an upload says which of its phases it is in and what to do about
 * it — start it, it is running on its own, it was stopped (and whether it
 * kept what it had sent).
 */
function uploadText(view: ObjectiveFields): string {
  const percent = `${Math.floor((100 * view.progress) / Math.max(1, view.goal))}%`;
  switch (view.phase) {
    case 'idle':
      return `start the upload at ${view.label}  ·  E at the terminal`;
    case 'active':
      return `uploading from ${view.label}  ·  ${percent}  ·  ${secs(view.goal - view.progress, Math.ceil)} s left  ·  no need to stay`;
    case 'interrupted':
      return `upload interrupted at ${percent}  ·  E at ${view.label} to restart it`;
  }
}

/** U-074: the upload still to finish, whether it is the objective described or one of a stage's several. */
function openUpload(view: MissionView): (ObjectiveFields & { index: number }) | null {
  if (view.open) {
    const up = view.open.find((o) => o.type === 'upload' && !o.done);
    return up ?? null;
  }
  return view.type === 'upload' ? { index: view.objective, type: view.type, label: view.label, phase: view.phase, satisfied: view.satisfied, progress: view.progress, goal: view.goal } : null;
}

/**
 * U-009: the interact prompt at an upload's terminal — within its reach of
 * the eye, while the upload waits to be started or restarted. The terminal
 * is the mission data's (`mission`, the world's committed one), matched to
 * the host's objective by index, type and label; a mission the page does
 * not have gives no prompt. A hint only: the host judges the press, the line
 * to the panel included.
 */
export function uploadPrompt(view: MissionView | null, mission: MissionDef | undefined, eye: { x: number; y: number; z: number }): string {
  const up = view ? openUpload(view) : null;
  if (!view || !up || view.state !== 'progress' || up.phase === 'active') return '';
  const def = mission?.objectives[up.index];
  if (def?.type !== 'upload' || def.label !== up.label) return '';
  const t = def.terminal;
  if (Math.hypot(eye.x - t.x, eye.y - t.y, eye.z - t.z) > def.reachM) return '';
  return up.phase === 'idle' ? 'E  START THE UPLOAD' : 'E  RESTART THE UPLOAD';
}

/**
 * What the HUD shows for this state; empty with no mission. `leverPercent`
 * (U-010) is how far an enemy is through pulling a running upload's lever,
 * from the host's snapshot: while it is pulling, the line says so.
 */
export function missionLine(view: MissionView | null, leverPercent = 0): string {
  if (!view) return '';
  const attempt = view.attempt > 1 ? `  ·  attempt ${view.attempt}` : '';
  if (view.state === 'complete') return `Mission complete${attempt}  ·  P to play again`;
  if (view.state === 'failed') {
    const why = view.failureReason === 'soldier-dead' ? 'A soldier died'
      : view.failureReason === 'all-downed' ? 'All six soldiers are down'
      : view.failureReason === 'area-overrun' ? `${view.label} overrun`
      : view.failureReason === 'time-limit' ? 'Time ran out'
      : view.failureReason === 'protected-lost' ? 'Protected target lost'
      : 'Squad lost';
    return `Mission failed: ${why}${attempt}  ·  P: last checkpoint  ·  O: restart mission`;
  }
  const up = openUpload(view);
  const lever = up && up.phase === 'active' && leverPercent > 0 ? `  ·  ENEMY AT THE LEVER ${Math.min(100, Math.floor(leverPercent))}% — stop them` : '';
  // U-074: a stage with several objectives lists them all, the finished ones ticked and the optional ones named.
  if (view.open) {
    const items = view.open.map((o) => `${o.done ? '✓ ' : ''}${objectiveText(o)}${o.optional ? ' (optional)' : ''}`);
    return `Objectives: ${items.join('   |   ')}${lever}${attempt}`;
  }
  const step = view.objectives > 1 ? ` ${view.objective + 1}/${view.objectives}` : '';
  return `Objective${step}: ${objectiveText(view)}${lever}${attempt}`;
}

/** Mission-end credit comes only from the host, including any other slots you played. */
export function afterActionXp(view: MissionView | null, soldiers: readonly SoldierProgress[], localSlot: number): string {
  if (!view || view.state === 'progress') return '';
  return soldiers.filter((soldier) => soldier.slot === localSlot || soldier.earned > 0)
    .map((soldier) => `Soldier ${soldier.slot + 1}: you earned ${soldier.earned} XP · ${PROGRESSION.ranks[soldier.rank]?.name ?? 'Unknown rank'} · ${soldier.xp} XP total`)
    .join('\n');
}
