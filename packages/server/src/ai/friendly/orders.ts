/**
 * Bots carry out orders (T-3.28): the leaves the friendly tree's order
 * branches run, ahead of fighting and following (`data/trees/friendly.json`).
 *
 * The order is the session's (T-3.27), read through the slot's `SquadView`;
 * each leaf sets the hands it owns every think, as the rifleman's do, and
 * says how the order went (`SquadView.report`):
 *
 * - **move** — to the point, into the best cover within `MOVE_COVER_M` of it
 *   against the likeliest threat (the target it knows, else nothing and it
 *   stands on the point). Unreachable: failed, at once. Arrived: done — and it
 *   stays, holding there and firing at what it sees, until told otherwise.
 * - **attack** — the named enemy is its target (the session sees to that).
 *   A clear line from its eye: stand and fire. None: to the best cover
 *   point's firing position on it, else straight at it, firing once a line
 *   opens. Dead: done. No way to it: failed.
 * - **hold** — stays at its anchor (the order's point, else where it stood
 *   when told), standing to fire at what it sees; nothing moves it but a new
 *   order. It never finishes.
 * - **regroup** — back to its formation place; done once inside its band.
 * - **revive** — to the named squadmate and hold interact, through the
 *   human's revive path. Up: done. Dead, or nobody: failed.
 */
import { type BtFrame, DAMAGE, DEFAULT_MUZZLE_RIG, type OrderPoint, SQUAD, type WorldBox, formationBand, rayWorld } from '@sandline/shared';
import type { BrainBody, BrainMemory, BrainRegistry } from '../Brain.ts';
import { type CombatBody, isCombatBody, threatEye } from '../actions/combat.ts';
import { type ActiveOrder, type SquadBody, isSquadBody } from '../actions/friendly.ts';

type Frame = BtFrame<BrainBody, BrainMemory>;
type Body = SquadBody & CombatBody;
type Vec3 = { x: number; y: number; z: number };

/** A move's cover is within this of its point, metres. */
export const MOVE_COVER_M = 6;
/** How near a goal counts as there: the fighting leaves' own measure (`actions/rifleman.ts`). */
export const THERE_M = 0.4;
/** Beyond this, a bot under orders runs. */
const SPRINT_BEYOND_M = 3;

function flat(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function isBody(ctx: BrainBody): ctx is Body {
  return isSquadBody(ctx) && isCombatBody(ctx);
}

function orderOf(ctx: Body, kind: ActiveOrder['order']): ActiveOrder | null {
  const order = ctx.squad.order(ctx.index);
  return order && order.order === kind ? order : null;
}

/** Every hand an order leaf owns, set: nothing it did not choose is left from another leaf. */
function hands(frame: Frame, h: { intent?: { goal: Vec3; pace: 'walk' | 'sprint' } | null; fireAt?: number | null; crouch?: boolean; lookAt?: Vec3 | null; interact?: boolean }): void {
  const bb = frame.blackboard;
  bb.set('intent', h.intent ?? null);
  bb.set('fireAt', h.fireAt ?? null);
  bb.set('suppressAt', null);
  bb.set('reload', false);
  bb.set('crouch', h.crouch ?? false);
  bb.set('lookAt', h.lookAt ?? null);
  bb.set('interact', h.interact ?? false);
  bb.set('phase', null);
}

/** Walk to `goal`, or run when it is far. */
function walk(goal: Vec3, from: Vec3): { goal: Vec3; pace: 'walk' | 'sprint' } {
  return { goal: { x: goal.x, y: goal.y, z: goal.z }, pace: flat(from, goal) > SPRINT_BEYOND_M ? 'sprint' : 'walk' };
}

/** The target it has chosen, if it sees it now: what it may fire at. */
function seenTarget(ctx: Body): number | null {
  const t = ctx.target;
  return t !== null && ctx.memory.entries.get(t)?.visible === true ? t : null;
}

/** A standing eye over these feet. */
function eyeOf(feet: Vec3): Vec3 {
  return { x: feet.x, y: feet.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: feet.z };
}

/** Nothing of the world between two points. */
function clearLine(from: Vec3, to: Vec3, boxes: readonly WorldBox[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-6) return true;
  return rayWorld({ origin: from, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length }, boxes) === null;
}

function point(p: OrderPoint): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

export function registerOrderLeaves(registry: BrainRegistry): BrainRegistry {
  return (
    registry
      /** The bot is under an order of `kind`. */
      .condition('ordered', ({ ctx }, args) => isBody(ctx) && ctx.squad.order(ctx.index)?.order === args['kind'])

      .action('orderMove', (frame) => {
        const ctx = frame.ctx;
        if (!isBody(ctx)) return 'failure';
        const order = orderOf(ctx, 'move');
        if (!order || !order.point) return 'failure';
        const to = point(order.point);
        if (order.status === 'active' && !ctx.squad.reachable(ctx.state, to)) {
          ctx.squad.report(ctx.index, 'failed', 'unreachable');
          hands(frame, {});
          return 'failure';
        }
        // The best cover near the point against the likeliest threat, reserved and kept while it still hides it.
        const eye = threatEye(ctx);
        const cover = ctx.combat.cover;
        let goal: Vec3 = to;
        let low = false;
        if (cover && eye) {
          const near = (p: Vec3) => flat(p, to) <= MOVE_COVER_M;
          let held = cover.heldPoint(ctx.netId);
          if (!held || !near(held) || !cover.stillProtects(ctx.netId, [eye])) {
            held = cover.choose(ctx.netId, { from: ctx.state, threats: [eye], friends: ctx.combat.friendsOf(ctx.netId, ctx.faction), combat: false, accept: near })?.point ?? null;
          }
          if (held) {
            goal = held;
            low = held.height === 'low';
          }
        }
        if (flat(ctx.state, goal) > THERE_M) {
          hands(frame, { intent: walk(goal, ctx.state), fireAt: seenTarget(ctx), lookAt: flat(ctx.state, goal) > SPRINT_BEYOND_M ? null : eye });
          return 'running';
        }
        // There: down behind it, facing the threat, firing at what shows.
        const target = seenTarget(ctx);
        hands(frame, { crouch: low && target === null, lookAt: eye, fireAt: target });
        if (order.status === 'active') ctx.squad.report(ctx.index, 'done', goal === to ? 'at the point' : 'in cover at the point');
        return 'running';
      })

      .action('orderAttack', (frame) => {
        const ctx = frame.ctx;
        if (!isBody(ctx)) return 'failure';
        const order = orderOf(ctx, 'attack');
        if (!order || order.target === null) return 'failure';
        const enemy = ctx.squad.soldier(order.target);
        if (!enemy || enemy.dead) {
          ctx.squad.report(ctx.index, 'done', 'target down');
          hands(frame, {});
          return 'success';
        }
        const at = { x: enemy.x, y: enemy.y, z: enemy.z };
        if (!ctx.squad.reachable(ctx.state, at)) {
          ctx.squad.report(ctx.index, 'failed', 'unreachable');
          hands(frame, {});
          return 'failure';
        }
        const eye = ctx.combat.eyeOf(order.target) ?? { x: at.x, y: at.y + 1.6, z: at.z };
        // A line to it from its own eye: stand and fire (the session pulls the trigger on sight).
        if (clearLine(eyeOf(ctx.state), eye, ctx.combat.boxes)) {
          hands(frame, { fireAt: order.target, lookAt: eye });
          return 'running';
        }
        // No line: to a firing position on it, else straight at it — firing the moment a line opens.
        const cover = ctx.combat.cover;
        let goal: Vec3 = at;
        if (cover) {
          const choice = cover.rank({ from: ctx.state, threats: [eye], friends: ctx.combat.friendsOf(ctx.netId, ctx.faction), combat: true }, ctx.netId)[0];
          if (choice?.firingFrom) goal = choice.firingFrom;
        }
        hands(frame, { intent: walk(goal, ctx.state), fireAt: order.target, lookAt: flat(ctx.state, goal) > SPRINT_BEYOND_M ? null : eye });
        return 'running';
      })

      .action('orderHold', (frame) => {
        const ctx = frame.ctx;
        if (!isBody(ctx)) return 'failure';
        const order = orderOf(ctx, 'hold');
        if (!order) return 'failure';
        const anchor = point(order.anchor);
        const target = seenTarget(ctx);
        const eye = threatEye(ctx);
        if (flat(ctx.state, anchor) > THERE_M * 1.5) {
          hands(frame, { intent: walk(anchor, ctx.state), fireAt: target, lookAt: eye });
          return 'running';
        }
        // Holding: standing to fire at what it sees, facing the threat; contact does not move it.
        hands(frame, { fireAt: target, lookAt: eye });
        return 'running';
      })

      .action('orderRegroup', (frame) => {
        const ctx = frame.ctx;
        if (!isBody(ctx)) return 'failure';
        if (!orderOf(ctx, 'regroup')) return 'failure';
        const place = ctx.squad.place(ctx.index);
        if (!place) {
          ctx.squad.report(ctx.index, 'done', 'nobody to regroup on');
          hands(frame, {});
          return 'success';
        }
        if (flat(ctx.state, place.goal) <= formationBand(place.offset)) {
          ctx.squad.report(ctx.index, 'done', 'in formation');
          hands(frame, {});
          return 'success';
        }
        hands(frame, { intent: { goal: place.goal, pace: 'sprint' } });
        return 'running';
      })

      .action('orderRevive', (frame) => {
        const ctx = frame.ctx;
        if (!isBody(ctx)) return 'failure';
        const order = orderOf(ctx, 'revive');
        if (!order || order.target === null) return 'failure';
        const mate = ctx.squad.soldier(order.target);
        if (!mate || mate.index < 0) {
          ctx.squad.report(ctx.index, 'failed', 'no such squadmate');
          hands(frame, {});
          return 'failure';
        }
        if (mate.dead) {
          ctx.squad.report(ctx.index, 'failed', 'died');
          hands(frame, {});
          return 'failure';
        }
        if (!mate.downed) {
          ctx.squad.report(ctx.index, 'done', 'up');
          hands(frame, {});
          return 'success';
        }
        const at = { x: mate.x, y: mate.y, z: mate.z };
        if (!ctx.squad.reachable(ctx.state, at)) {
          ctx.squad.report(ctx.index, 'failed', 'unreachable');
          hands(frame, {});
          return 'failure';
        }
        const reach = DAMAGE.downed.reviveRangeM * SQUAD.bot.reviveReachFraction;
        if (flat(ctx.state, at) > reach) {
          hands(frame, { intent: walk(at, ctx.state) });
          return 'running';
        }
        // Beside it: kneel and hold interact, as a human would.
        hands(frame, { crouch: true, interact: true });
        return 'running';
      })
  );
}
