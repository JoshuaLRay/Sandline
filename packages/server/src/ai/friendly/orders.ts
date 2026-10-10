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
 * - U-154: a move or a hold given with a facing — the way its giver was
 *   looking — watches along it once there, while it has no threat to face; a
 *   threat it knows of, seen or remembered, still turns it. The facing only
 *   steers the gaze: what it may fire at is untouched, so fire discipline
 *   holds as before, and an attack order replaces the move or hold outright.
 * - **regroup** — back to its formation place; done once inside its band.
 * - **revive** — to the named squadmate and hold interact, through the
 *   human's revive path. Up: done. Dead, or nobody: failed.
 */
import { type BtFrame, DAMAGE, DEFAULT_MUZZLE_RIG, type OrderPoint, SQUAD, type WorldBox, alongFacing, formationBand, rayWorld, suppressionLevel } from '@sandline/shared';
import type { BrainBody, BrainMemory, BrainRegistry } from '../Brain.ts';
import { type CombatBody, isCombatBody, threatEye } from '../actions/combat.ts';
import { type ActiveOrder, type SquadBody, isSquadBody } from '../actions/friendly.ts';
import { near, within } from '../floor.ts';

type Frame = BtFrame<BrainBody, BrainMemory>;
type Body = SquadBody & CombatBody;
type Vec3 = { x: number; y: number; z: number };

/** A move's cover is within this of its point, metres. */
export const MOVE_COVER_M = 6;
/** How near a goal counts as there: the fighting leaves' own measure (`actions/rifleman.ts`). */
const THERE_M = 0.4;
/** Beyond this, a bot under orders runs. */
const SPRINT_BEYOND_M = 3;
/** U-154: how far out along its facing a bot looks: any distance gives the bearing; this keeps it well clear of its own feet. */
const FACING_LOOK_M = 10;

function isBody(ctx: BrainBody): ctx is Body {
  return isSquadBody(ctx) && isCombatBody(ctx);
}

function orderOf(ctx: Body, kind: ActiveOrder['order']): ActiveOrder | null {
  const order = ctx.squad.order(ctx.index);
  return order && order.order === kind ? order : null;
}

/** Every hand an order leaf owns, set: nothing it did not choose is left from another leaf. */
function hands(frame: Frame, h: { intent?: { goal: Vec3; pace: 'walk' | 'sprint' } | null; fireAt?: number | null; crouch?: boolean; lookAt?: Vec3 | null; interact?: boolean; rise?: boolean }): void {
  const bb = frame.blackboard;
  bb.set('intent', h.intent ?? null);
  bb.set('fireAt', h.fireAt ?? null);
  bb.set('suppressAt', null);
  bb.set('reload', false);
  bb.set('crouch', h.crouch ?? false);
  bb.set('lookAt', h.lookAt ?? null);
  bb.set('interact', h.interact ?? false);
  bb.set('rise', h.rise ?? false);
  bb.set('phase', null);
}

/** Far enough to run to: beyond `SPRINT_BEYOND_M`, or on another floor (U-123: the way there is round by the stairs). */
function far(from: Vec3, goal: Vec3): boolean {
  return !within(from, goal, SPRINT_BEYOND_M);
}

/** Walk to `goal`, or run when it is far. */
function walk(goal: Vec3, from: Vec3): { goal: Vec3; pace: 'walk' | 'sprint' } {
  return { goal: { x: goal.x, y: goal.y, z: goal.z }, pace: far(from, goal) ? 'sprint' : 'walk' };
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

/**
 * U-154: where a bot that is there looks — the threat, when it has one; else
 * along its order's facing, from its eye; else nowhere in particular (null:
 * as before facings, where it last turned).
 */
function watch(ctx: Body, order: ActiveOrder, threat: Vec3 | null): Vec3 | null {
  if (threat) return threat;
  return order.facing === undefined ? null : alongFacing(eyeOf(ctx.state), order.facing, FACING_LOOK_M);
}

/**
 * T-5.06: under fire — suppressed, or hurt in the last moment — by the
 * rifleman's measure (`actions/rifleman.ts` `pressured`), from the squad's
 * `bot.underFire` data.
 */
function underFire(ctx: Body): boolean {
  const now = ctx.combat.now();
  const u = SQUAD.bot.underFire;
  return suppressionLevel(ctx.suppression, now) >= u.suppression || now - ctx.lastDamagedAt < u.hurtSeconds;
}

/**
 * T-5.06: every eye it has reason to hide from — whoever has shot at it
 * lately, and its target — so cover taken under fire faces the gun that is
 * firing, not only the enemy it was sent at.
 */
function threatEyes(ctx: Body): Vec3[] {
  const now = ctx.combat.now();
  const eyes: Vec3[] = [];
  for (const entry of ctx.memory.entries.values()) {
    if (entry.threatAt === null || now - entry.threatAt > SQUAD.bot.underFire.threatSeconds) continue;
    const live = entry.visible ? ctx.combat.eyeOf(entry.netId) : null;
    eyes.push(live ?? { x: entry.x, y: entry.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: entry.z });
  }
  const eye = threatEye(ctx);
  if (eye) eyes.push(eye);
  return eyes;
}

/**
 * T-5.06: cover within `withinM` of `at` (U-123: `near`) that hides it from every threat,
 * the one it holds kept while it still does; null when there is none.
 */
function coverFrom(ctx: Body, at: Vec3, withinM: number, threats: Vec3[]): (Vec3 & { height: 'low' | 'high' }) | null {
  const cover = ctx.combat.cover;
  if (!cover || threats.length === 0) return null;
  const inReach = (p: Vec3) => near(p, at, withinM);
  const held = cover.heldPoint(ctx.netId);
  if (held && inReach(held) && cover.stillProtects(ctx.netId, threats)) return held;
  return cover.choose(ctx.netId, { from: ctx.state, threats, friends: ctx.combat.friendsOf(ctx.netId, ctx.faction), combat: true, accept: inReach })?.point ?? null;
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
          // U-123: `near`, so cover a storey above or below the point is not near it.
          const close = (p: Vec3) => near(p, to, MOVE_COVER_M);
          let held = cover.heldPoint(ctx.netId);
          if (!held || !close(held) || !cover.stillProtects(ctx.netId, [eye])) {
            held = cover.choose(ctx.netId, { from: ctx.state, threats: [eye], friends: ctx.combat.friendsOf(ctx.netId, ctx.faction), combat: false, accept: close })?.point ?? null;
          }
          if (held) {
            goal = held;
            low = held.height === 'low';
          }
        }
        // U-123: there means on the goal's floor too; passing beneath a raised goal is not arriving.
        if (!within(ctx.state, goal, THERE_M)) {
          // T-5.06: shot at on the way, it goes to ground near where it is and fights, moving on when the fire lets up.
          if (underFire(ctx) && !within(ctx.state, goal, MOVE_COVER_M)) {
            const refuge = coverFrom(ctx, ctx.state, SQUAD.bot.underFire.coverWithinM, threatEyes(ctx));
            if (refuge) {
              const target = seenTarget(ctx);
              if (!within(ctx.state, refuge, THERE_M)) hands(frame, { intent: walk(refuge, ctx.state), fireAt: target, lookAt: eye });
              else hands(frame, { crouch: refuge.height === 'low' && target === null, fireAt: target, lookAt: eye });
              return 'running';
            }
          }
          hands(frame, { intent: walk(goal, ctx.state), fireAt: seenTarget(ctx), lookAt: far(ctx.state, goal) ? null : eye });
          return 'running';
        }
        // There: down behind it, facing the threat (else the way it was told to watch, U-154), firing at what shows.
        const target = seenTarget(ctx);
        hands(frame, { crouch: low && target === null, lookAt: watch(ctx, order, eye), fireAt: target });
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
        // T-5.06: shot at on the way, it goes to ground first — cover near where it is, against whoever is firing
        // and its target — and fights from there; it advances again when the fire lets up.
        if (underFire(ctx)) {
          const refuge = coverFrom(ctx, ctx.state, SQUAD.bot.underFire.coverWithinM, threatEyes(ctx));
          if (refuge) {
            const target = seenTarget(ctx);
            if (!within(ctx.state, refuge, THERE_M)) hands(frame, { intent: walk(refuge, ctx.state), fireAt: order.target, lookAt: eye });
            else hands(frame, { crouch: refuge.height === 'low' && target === null, fireAt: order.target, lookAt: eye });
            return 'running';
          }
        }
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
        hands(frame, { intent: walk(goal, ctx.state), fireAt: order.target, lookAt: far(ctx.state, goal) ? null : eye });
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
        const held = ctx.combat.cover?.heldPoint(ctx.netId) ?? null;
        const inRefuge = held !== null && near(held, anchor, SQUAD.bot.underFire.holdCoverM) && within(ctx.state, held, THERE_M * 1.5);
        if (!within(ctx.state, anchor, THERE_M * 1.5) && !(inRefuge && underFire(ctx))) {
          hands(frame, { intent: walk(anchor, ctx.state), fireAt: target, lookAt: eye });
          return 'running';
        }
        // T-5.06: holding under fire, it takes cover close enough to still be holding — within `holdCoverM`
        // of the anchor — against whoever is firing, down behind it when it has nothing to shoot at.
        if (underFire(ctx)) {
          const refuge = coverFrom(ctx, anchor, SQUAD.bot.underFire.holdCoverM, threatEyes(ctx));
          if (refuge) {
            if (!within(ctx.state, refuge, THERE_M)) hands(frame, { intent: walk(refuge, ctx.state), fireAt: target, lookAt: eye });
            else hands(frame, { crouch: refuge.height === 'low' && target === null, fireAt: target, lookAt: eye });
            return 'running';
          }
        }
        // Holding: standing to fire at what it sees, facing the threat (else the way it was told to watch, U-154);
        // contact does not move it.
        // U-011: held at an upload's terminal while it waits, it starts it — hands on the panel, as a player's E.
        const terminal = ctx.squad.terminal?.() ?? null;
        const e = eyeOf(ctx.state);
        const press = terminal !== null && Math.hypot(e.x - terminal.x, e.y - terminal.y, e.z - terminal.z) <= terminal.reachM;
        hands(frame, { fireAt: press ? null : target, lookAt: press ? terminal : watch(ctx, order, eye), interact: press });
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
        if (within(ctx.state, place.goal, formationBand(place.offset))) {
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
        // U-123: beside it on its floor; kneeling beneath a squadmate on the deck above revives nobody.
        if (!within(ctx.state, at, reach)) {
          hands(frame, { intent: walk(at, ctx.state), rise: true });
          return 'running';
        }
        // Beside it: kneel and hold interact, as a human would — up from a held stance (U-153).
        hands(frame, { crouch: true, interact: true, rise: true });
        return 'running';
      })
  );
}
