/**
 * The friendly bot's leaves (T-3.25): `follow`, what `data/trees/friendly.json`
 * runs.
 *
 * A bot slot's brain body is the session's `Slot`, and the session hands each
 * one a view of the squad's formation (`SquadView`). `follow` asks it for this
 * slot's place and walks there at the pace it says; standing still when there
 * is none (it leads, or there is nowhere on the mesh to stand) or when it has
 * arrived with the lead stopped. It never finishes: following is what a
 * friendly bot does when there is nothing else to do.
 *
 * T-3.26: `downedMate` and `revive` — to a downed squadmate nobody else has,
 * then hold interact where a human would, through the same held-E path, range
 * and timer (`Session.updateRevives`). The fight itself is the rifleman's
 * leaves (`actions/rifleman.ts`), on the slot's own `CombatBody`.
 */
import { type BotOrder, type OrderPoint, SQUAD } from '@sandline/shared';
import type { BrainBody, BrainRegistry } from '../Brain.ts';
import type { FormationPlace } from '../friendly/formation.ts';

/** A downed squadmate a bot could revive (T-3.26). */
export interface DownedMate {
  index: number;
  x: number;
  y: number;
  z: number;
  /** How near a reviver must be to start and keep a revive, metres (the human's range). */
  reachM: number;
}

/** A bot's standing order and how it is going (T-3.28). */
export interface ActiveOrder extends BotOrder {
  status: 'active' | 'done';
  /** Where a hold holds: its point, or where the bot stood when told. */
  anchor: OrderPoint;
}

/** Someone an order names, as a bot may know of them: where, and how they are. */
export interface NamedSoldier {
  netId: number;
  /** Slot index, or −1 for an enemy. */
  index: number;
  x: number;
  y: number;
  z: number;
  downed: boolean;
  dead: boolean;
}

/** The squad as a slot's brain sees it. */
export interface SquadView {
  place(slotIndex: number): FormationPlace | null;
  /** T-3.26: the nearest downed squadmate within `reviveSeekM` that nobody else is reviving, or null. */
  downedNear(slotIndex: number): DownedMate | null;
  /** T-3.28: the order this slot's bot is under, or null. */
  order(slotIndex: number): ActiveOrder | null;
  /** T-3.28: how it went — done, or failed and why. */
  report(slotIndex: number, outcome: 'done' | 'failed', reason: string): void;
  /** T-3.28: whether the mesh has a way from here to there. */
  reachable(from: OrderPoint, to: OrderPoint): boolean;
  /** T-3.28: a soldier an order names, by netId, or null for nobody. */
  soldier(netId: number): NamedSoldier | null;
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
  return registry
    .action('follow', ({ ctx, blackboard }) => {
      if (!isSquadBody(ctx)) return 'failure';
      const place = ctx.squad.place(ctx.index);
      blackboard.set('intent', place?.intent ?? null);
      blackboard.set('lookAt', null);
      blackboard.set('fireAt', null);
      blackboard.set('crouch', false);
      blackboard.set('interact', false);
      return 'running';
    })
    .condition('downedMate', ({ ctx }) => isSquadBody(ctx) && ctx.squad.downedNear(ctx.index) !== null)
    /** To the downed squadmate, then hold interact beside it until it is up. */
    .action('revive', ({ ctx, blackboard }) => {
      if (!isSquadBody(ctx)) return 'failure';
      const mate = ctx.squad.downedNear(ctx.index);
      if (!mate) return 'failure';
      blackboard.set('fireAt', null);
      blackboard.set('suppressAt', null);
      blackboard.set('reload', false);
      blackboard.set('lookAt', null);
      const reach = mate.reachM * SQUAD.bot.reviveReachFraction;
      const d = Math.sqrt((ctx.state.x - mate.x) ** 2 + (ctx.state.z - mate.z) ** 2);
      if (d > reach) {
        blackboard.set('interact', false);
        blackboard.set('crouch', false);
        blackboard.set('intent', { goal: { x: mate.x, y: mate.y, z: mate.z }, pace: d > 4 ? 'sprint' : 'walk' });
        return 'running';
      }
      // There: kneel beside it and hold interact, as a human would.
      blackboard.set('intent', null);
      blackboard.set('crouch', true);
      blackboard.set('interact', true);
      return 'running';
    });
}
