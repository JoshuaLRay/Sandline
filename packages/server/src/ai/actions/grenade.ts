/**
 * The grenade leaves (T-3.22): `grenadeTarget` and `throwGrenade`.
 *
 * The condition says whether this think is one to throw on — a grenade in the
 * pouch, the cooldown spent, and a target that has sat still in cover long
 * enough (`throw.ts`). The action searches the arc and, if one reaches the
 * target and spares every friend, asks the session for it on the blackboard
 * (`throwAt`): the session throws it through a human's path, from the same
 * pouch and on the same cooldown. A search that finds nothing fails, so the
 * fight goes on as before, and is not tried again for `retrySeconds`; one
 * that throws waits `againSeconds`, so the first can go off before a second
 * follows it. Nobody known to be downed is a grenade target.
 */
import { PROJECTILE_IDS } from '@sandline/shared';
import type { BrainRegistry } from '../Brain.ts';
import { THROW, chooseThrow, isGrenadeTarget, knownFeet, stillFor, throwEye } from '../throw.ts';
import { type CombatBody, isCombatBody } from './combat.ts';

const PROJECTILE = (PROJECTILE_IDS as readonly string[]).indexOf(THROW.projectile);
if (PROJECTILE < 0) throw new Error(`throw.projectile "${THROW.projectile}" is not a projectile`);

/** Where it believes its target's feet are, or null. */
function targetFeet(body: CombatBody) {
  if (body.target === null) return null;
  const entry = body.memory.entries.get(body.target);
  return entry ? knownFeet(entry, body.state.y) : null;
}

/** A grenade in the pouch and the hand free to throw it. */
function canThrow(body: CombatBody): boolean {
  if (body.state.vault) return false;
  if ((body.pouch[PROJECTILE] ?? 0) <= 0) return false;
  return body.combat.now() >= body.nextThrowAt && body.combat.projectileDef(PROJECTILE) !== null;
}

export function registerGrenadeLeaves(registry: BrainRegistry): BrainRegistry {
  return (
    registry
      .condition('grenadeTarget', ({ ctx, blackboard }) => {
        if (!isCombatBody(ctx) || !canThrow(ctx)) return false;
        const now = ctx.combat.now();
        if (now < blackboard.get('throwNextAt')) return false;
        if (ctx.target === null || ctx.memory.entries.get(ctx.target)?.downed !== false) return false;
        const feet = targetFeet(ctx);
        return feet !== null && isGrenadeTarget(ctx.state, feet, stillFor(ctx.still, ctx.target, now), ctx.combat.boxes);
      })
      /** Search the arc; success once a throw is asked for, failure when none will do. */
      .action('throwGrenade', ({ ctx, blackboard }) => {
        if (!isCombatBody(ctx) || !canThrow(ctx)) return 'failure';
        const feet = targetFeet(ctx);
        const def = ctx.combat.projectileDef(PROJECTILE);
        if (feet === null || def === null) return 'failure';
        const now = ctx.combat.now();
        blackboard.set('throwNextAt', now + THROW.retrySeconds);
        const friends = [{ x: ctx.state.x, y: ctx.state.y, z: ctx.state.z }, ...ctx.combat.friendsOf(ctx.netId, ctx.faction)];
        const choice = chooseThrow(def, throwEye(ctx.state), feet, friends, ctx.combat.projectileWorld());
        if (choice === null) return 'failure';
        // Stand where it is for the throw: the arc was searched from here.
        blackboard.set('intent', null);
        blackboard.set('fireAt', null);
        blackboard.set('suppressAt', null);
        blackboard.set('throwAt', { projectile: PROJECTILE, yaw: choice.yaw, pitch: choice.pitch });
        blackboard.set('throwNextAt', now + THROW.againSeconds);
        return 'success';
      })
  );
}
