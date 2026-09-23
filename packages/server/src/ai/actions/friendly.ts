/**
 * The friendly bot's leaves (T-3.25): `follow`, what `data/trees/friendly.json`
 * runs.
 *
 * A bot slot's brain body is the session's `Slot`, and the session hands each
 * one a view of the squad's formation (`SquadView`). `follow` asks it for this
 * slot's place and walks there at the pace it says; standing still when there
 * is none (it leads, or there is nowhere on the mesh to stand) or when it has
 * arrived with the lead stopped. It never finishes: following is what a
 * friendly bot does until a later tree gives it something else (T-3.26).
 */
import type { BrainBody, BrainRegistry } from '../Brain.ts';
import type { FormationPlace } from '../friendly/formation.ts';

/** The squad as a slot's brain sees it. */
export interface SquadView {
  place(slotIndex: number): FormationPlace | null;
}

/** A slot the session gave a squad view: a bot that can follow. */
export interface SquadBody extends BrainBody {
  readonly index: number;
  readonly squad: SquadView;
}

export function isSquadBody(body: BrainBody): body is SquadBody {
  return 'squad' in body && (body as { squad?: unknown }).squad != null && typeof (body as { index?: unknown }).index === 'number';
}

export function registerFriendlyLeaves(registry: BrainRegistry): BrainRegistry {
  return registry.action('follow', ({ ctx, blackboard }) => {
    if (!isSquadBody(ctx)) return 'failure';
    const place = ctx.squad.place(ctx.index);
    blackboard.set('intent', place?.intent ?? null);
    blackboard.set('lookAt', null);
    return 'running';
  });
}
