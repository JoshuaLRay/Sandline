/**
 * Taking a prisoner (U-062): an enemy the session has sent to a downed character.
 *
 * The session picks the capturer and times the channel (`Session.updateCaptures`); the leaf only carries it out,
 * as `useLever` does for a lever: walk to the character, sprinting while far and shooting at what it can on the
 * way, then kneel over them with its hands on them (`interact`) and off the trigger. It never fires at the
 * downed character themselves: U-031's target rule is untouched.
 */
import type { BrainRegistry } from '../Brain.ts';
import { isCombatBody } from './combat.ts';

/** Stop this fraction of the reach from the character: well inside it, so a step's drift does not take it out. */
export const CAPTURE_STOP_FRACTION = 0.6;
/** Farther than this and it runs, metres. */
const SPRINT_BEYOND_M = 6;

export function registerCaptureLeaves(registry: BrainRegistry): BrainRegistry {
  return registry
    .condition('hasCaptureJob', ({ ctx }) => isCombatBody(ctx) && (ctx.captureJob?.() ?? null) !== null)
    .action('holdPrisoner', ({ ctx, blackboard }) => {
      if (!isCombatBody(ctx)) return 'failure';
      const job = ctx.captureJob?.() ?? null;
      if (!job) return 'failure';
      blackboard.set('suppressAt', null);
      blackboard.set('reload', false);
      blackboard.set('phase', null);
      const d = Math.hypot(ctx.state.x - job.x, ctx.state.z - job.z);
      if (d > job.reachM * CAPTURE_STOP_FRACTION) {
        blackboard.set('interact', false);
        blackboard.set('crouch', false);
        blackboard.set('lookAt', null);
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
