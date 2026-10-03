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
import { type BotOrder, type OrderPoint, type SquadAggression, SQUAD, DEFAULT_MUZZLE_RIG, formationBand, suppressionLevel } from '@sandline/shared';
import type { BrainBody, BrainRegistry } from '../Brain.ts';
import type { FormationPlace } from '../friendly/formation.ts';
import { isCombatBody } from './combat.ts';

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
  aggression?(slotIndex: number): SquadAggression;
  canEngage?(slotIndex: number, target: number | null): boolean;
  /** T-3.26: the nearest downed squadmate within `reviveSeekM` that nobody else is reviving, or null. */
  downedNear(slotIndex: number): DownedMate | null;
  /** U-053: the nearest hurt (not downed) squadmate this bot, with kits, would heal, or null. */
  hurtNear?(slotIndex: number): DownedMate | null;
  /** U-084: whether this slot's bot is hurt below `bot.kitBelowFraction` of its health, upright, and has a health kit to use on itself. */
  needsKit?(slotIndex: number): boolean;
  /** T-3.28: the order this slot's bot is under, or null. */
  order(slotIndex: number): ActiveOrder | null;
  /** T-3.28: how it went — done, or failed and why. */
  report(slotIndex: number, outcome: 'done' | 'failed', reason: string): void;
  /** T-3.28: whether the mesh has a way from here to there. */
  reachable(from: OrderPoint, to: OrderPoint): boolean;
  /** T-3.28: a soldier an order names, by netId, or null for nobody. */
  soldier(netId: number): NamedSoldier | null;
  /** U-011: the terminal of an upload waiting to be started (or restarted), and its reach; null when none waits. */
  terminal?(): { x: number; y: number; z: number; reachM: number } | null;
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
    .condition('autonomousFight', ({ ctx }) => !isSquadBody(ctx) || (ctx.squad.aggression?.(ctx.index) ?? 'aggressive') !== 'hold-fire')
    .action('advanceContact', ({ ctx, blackboard }) => {
      if (!isSquadBody(ctx) || !isCombatBody(ctx) || (ctx.squad.aggression?.(ctx.index) ?? 'aggressive') !== 'aggressive' || ctx.target === null) return 'failure';
      const entry = ctx.memory.entries.get(ctx.target);
      const place = ctx.squad.place(ctx.index);
      // A heard shot alone is not a visually identified contact.
      if (!entry || entry.confidence < 1 || entry.visible || !place) return 'failure';
      const dx = entry.x - place.goal.x; const dz = entry.z - place.goal.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) return 'failure';
      const distance = Math.min(length, formationBand(place.offset));
      const goal = { x: place.goal.x + dx / length * distance, y: place.goal.y, z: place.goal.z + dz / length * distance };
      if (Math.sqrt((goal.x - ctx.state.x) ** 2 + (goal.z - ctx.state.z) ** 2) <= SQUAD.arriveM || !ctx.squad.reachable(ctx.state, goal)) return 'failure';
      blackboard.set('intent', { goal, pace: 'walk' });
      blackboard.set('fireAt', null); blackboard.set('suppressAt', null);
      blackboard.set('lookAt', null); blackboard.set('crouch', false); blackboard.set('interact', false);
      return 'running';
    })
    .action('follow', ({ ctx, blackboard }) => {
      if (!isSquadBody(ctx)) return 'failure';
      const place = ctx.squad.place(ctx.index);
      blackboard.set('intent', place?.intent ?? null);
      blackboard.set('lookAt', null);
      blackboard.set('fireAt', null);
      blackboard.set('suppressAt', null);
      blackboard.set('throwAt', null);
      blackboard.set('detonate', null);
      blackboard.set('phase', null);
      blackboard.set('crouch', false);
      blackboard.set('interact', false);
      // Hold fire and Defensive still protect themselves, without acquiring
      // an offensive target or leaving their chosen formation footprint.
      if (isCombatBody(ctx) && (ctx.squad.aggression?.(ctx.index) ?? 'aggressive') !== 'aggressive') {
        const now = ctx.combat.now();
        const pressured = suppressionLevel(ctx.suppression, now) >= SQUAD.bot.underFire.suppression || now - ctx.lastDamagedAt < SQUAD.bot.underFire.hurtSeconds;
        if (pressured && ctx.combat.cover) {
          const threats = [...ctx.memory.entries.values()].filter((e) => e.threatAt !== null && now - e.threatAt <= SQUAD.bot.underFire.threatSeconds)
            .map((e) => ({ x: e.x, y: e.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: e.z }));
          const refuge = threats.length === 0 ? null : ctx.combat.cover.choose(ctx.netId, { from: ctx.state, threats, friends: ctx.combat.friendsOf(ctx.netId, ctx.faction), combat: false,
            accept: (p) => !place || Math.sqrt((p.x - place.goal.x) ** 2 + (p.z - place.goal.z) ** 2) <= formationBand(place.offset) })?.point;
          if (refuge) {
            const distance = Math.sqrt((refuge.x - ctx.state.x) ** 2 + (refuge.z - ctx.state.z) ** 2);
            blackboard.set('intent', distance > SQUAD.arriveM ? { goal: refuge, pace: 'walk' } : null);
            blackboard.set('crouch', distance <= SQUAD.arriveM && refuge.height === 'low');
          }
        }
      }
      return 'running';
    })
    .condition('hurtMate', ({ ctx }) => isSquadBody(ctx) && (ctx.squad.hurtNear?.(ctx.index) ?? null) !== null)
    /** To the hurt squadmate, then hold the use of a health kit beside them until they are healed or it is interrupted (U-053). */
    .action('heal', ({ ctx, blackboard }) => {
      if (!isSquadBody(ctx)) return 'failure';
      const mate = ctx.squad.hurtNear?.(ctx.index) ?? null;
      if (!mate) return 'failure';
      blackboard.set('fireAt', null);
      blackboard.set('suppressAt', null);
      blackboard.set('reload', false);
      blackboard.set('lookAt', null);
      blackboard.set('interact', false);
      const reach = mate.reachM * SQUAD.bot.reviveReachFraction;
      const d = Math.sqrt((ctx.state.x - mate.x) ** 2 + (ctx.state.z - mate.z) ** 2);
      if (d > reach) {
        blackboard.set('useKit', false);
        blackboard.set('crouch', false);
        blackboard.set('intent', { goal: { x: mate.x, y: mate.y, z: mate.z }, pace: d > 4 ? 'sprint' : 'walk' });
        return 'running';
      }
      blackboard.set('intent', null);
      blackboard.set('crouch', false);
      blackboard.set('useKit', true);
      return 'running';
    })
    /**
     * U-084: hurt, with a kit, and no order that has it on the move or in a fight — none, a hold, or a move it has
     * finished — so it can stand where it is and use the kit on itself.
     */
    .condition('kitSelf', ({ ctx }) => {
      if (!isSquadBody(ctx) || !ctx.squad.needsKit?.(ctx.index)) return false;
      const order = ctx.squad.order(ctx.index);
      return order === null || order.order === 'hold' || (order.order === 'move' && order.status === 'done');
    })
    /** Stand and hold the use of a health kit on itself until it is healed or hurt again (the session's kit path). */
    .action('healSelf', ({ ctx, blackboard }) => {
      if (!isSquadBody(ctx)) return 'failure';
      blackboard.set('intent', null);
      blackboard.set('fireAt', null);
      blackboard.set('suppressAt', null);
      blackboard.set('reload', false);
      blackboard.set('lookAt', null);
      blackboard.set('interact', false);
      blackboard.set('crouch', false);
      blackboard.set('useKit', true);
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
