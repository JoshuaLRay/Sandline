/**
 * The lever (U-010): an enemy the session has sent to cut a running upload.
 *
 * The session picks the user — one at a time, of the upload's encounter
 * group, one it can path to — and gives it the job (`CombatBody.leverJob`);
 * it takes the job back when the user dies, cannot get there, or the upload
 * stops running. The leaf only carries it out:
 *
 * - **there yet?** Not within the lever's reach of it (a margin inside, so
 *   standing still at the edge still counts): walk to it, sprinting while
 *   far, still shooting at what it can see on the way — a saboteur is a
 *   soldier, not a sleepwalker.
 * - **there:** stop, kneel, hands on the lever (`interact`) and off the
 *   trigger. The session holds the timer, as it does a revive's, and decides
 *   whether the pull counts — alive, in reach, a clear line to the lever.
 */
import type { BrainRegistry } from '../Brain.ts';
import { isCombatBody } from './combat.ts';

/** Stop this fraction of the reach from the lever: well inside it, so a step's drift does not take it out. */
export const LEVER_STOP_FRACTION = 0.6;
/** Farther than this and it runs, metres. */
const SPRINT_BEYOND_M = 6;

export function registerLeverLeaves(registry: BrainRegistry): BrainRegistry {
  return registry
    .condition('hasLeverJob', ({ ctx }) => isCombatBody(ctx) && (ctx.leverJob?.() ?? null) !== null)
    .action('useLever', ({ ctx, blackboard }) => {
      if (!isCombatBody(ctx)) return 'failure';
      const job = ctx.leverJob?.() ?? null;
      if (!job) return 'failure';
      blackboard.set('suppressAt', null);
      blackboard.set('reload', false);
      blackboard.set('phase', null);
      const d = Math.hypot(ctx.state.x - job.x, ctx.state.z - job.z);
      if (d > job.reachM * LEVER_STOP_FRACTION) {
        blackboard.set('interact', false);
        blackboard.set('crouch', false);
        blackboard.set('lookAt', null);
        // On the way it fights what it can: its target, if the session's fire path has a line to it.
        blackboard.set('fireAt', ctx.target);
        blackboard.set('intent', { goal: { x: job.x, y: job.y, z: job.z }, pace: d > SPRINT_BEYOND_M ? 'sprint' : 'walk' });
        return 'running';
      }
      blackboard.set('intent', null);
      blackboard.set('fireAt', null);
      blackboard.set('crouch', true);
      blackboard.set('lookAt', { x: job.x, y: job.y, z: job.z });
      blackboard.set('interact', true);
      return 'running';
    });
}
