/**
 * The armour leaves (U-079): `shellLocked` and `dodgeShell`, `armourFight` and `fightArmour`.
 *
 * A tank's cannon locks a point for its tell and then shells it (U-068); a bot inside that shell's blast leaves it
 * (`dodgeShell`) before anything else it was doing. And the only things that hurt a tank are a rocket, C4 and a claymore
 * (U-066), so the bot that carries one goes for the tank (`fightArmour`): a rocket at a visible tank in its band, led by
 * the tank's pace; C4 or a claymore thrown at one that is stopped, C4 set off once it lies by the hull and everyone is
 * clear of it. The rest of the squad fights as it did. The searches are `ai/armour.ts`'s; the throws go through the
 * human's path (`throwAt`) and the detonator (`detonate`) in `Session.aiHands`.
 */
import { PROJECTILE_IDS } from '@sandline/shared';
import type { BrainMemory, BrainRegistry } from '../Brain.ts';
import { ARMOUR, chooseRocket, choosePlacement, dodgePoint } from '../armour.ts';
import { type ArmourView, type CombatBody, isCombatBody } from './combat.ts';

const ROCKET = (PROJECTILE_IDS as readonly string[]).indexOf('rocket');
const C4 = (PROJECTILE_IDS as readonly string[]).indexOf('c4');
const CLAYMORE = (PROJECTILE_IDS as readonly string[]).indexOf('claymore');

type Vec3 = { x: number; y: number; z: number };

function flat(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

/** The tank whose lock this body stands in, nearest first, or null. */
function lockOn(body: CombatBody): { view: ArmourView; to: Vec3 } | null {
  const now = body.combat.now();
  for (const view of body.combat.armour()) {
    if (!view.tell || now >= view.tell.until) continue;
    const to = dodgePoint(body.state, view);
    if (to) return { view, to };
  }
  return null;
}

/** The nearest tank this body has in sight now, or null. */
function seenArmour(body: CombatBody): ArmourView | null {
  let best: ArmourView | null = null;
  let bestD = Infinity;
  for (const view of body.combat.armour()) {
    if (body.memory.entries.get(view.netId)?.visible !== true) continue;
    const d = flat(body.state, view);
    if (d < bestD) {
      bestD = d;
      best = view;
    }
  }
  return best;
}

/** The anti-armour item it carries and has some of: a PROJECTILE_IDS index, or −1. */
function carried(body: CombatBody): number {
  for (const kind of [ROCKET, C4, CLAYMORE]) if (kind >= 0 && (body.pouch[kind] ?? 0) > 0) return kind;
  return -1;
}

/** C4 it has out already, whose word it still holds. */
function chargesOut(body: CombatBody): readonly Vec3[] {
  return C4 >= 0 ? body.combat.placed(body.netId, C4) : [];
}

/** Every hand a leaf here owns, set (nothing from another leaf is left standing). */
function stand(bb: { set<K extends keyof BrainMemory>(key: K, value: BrainMemory[K]): void }, intent: BrainMemory['intent']): void {
  bb.set('intent', intent);
  bb.set('fireAt', null);
  bb.set('suppressAt', null);
  bb.set('reload', false);
  bb.set('crouch', false);
  bb.set('lookAt', null);
  bb.set('interact', false);
}

export function registerArmourLeaves(registry: BrainRegistry): BrainRegistry {
  return registry
    .condition('shellLocked', ({ ctx }) => isCombatBody(ctx) && lockOn(ctx) !== null)
    /** Run out of the locked shell's blast: sprint, firing nothing. */
    .action('dodgeShell', ({ ctx, blackboard }) => {
      if (!isCombatBody(ctx)) return 'failure';
      const lock = lockOn(ctx);
      if (!lock) return 'failure';
      stand(blackboard, { goal: lock.to, pace: 'sprint' });
      return 'running';
    })
    .condition('armourFight', ({ ctx }) => {
      if (!isCombatBody(ctx)) return false;
      if (chargesOut(ctx).length > 0) return true;
      return carried(ctx) >= 0 && seenArmour(ctx) !== null;
    })
    .action('fightArmour', ({ ctx, blackboard }) => {
      if (!isCombatBody(ctx)) return 'failure';
      const now = ctx.combat.now();
      const friends = ctx.combat.friendsOf(ctx.netId, ctx.faction);
      const view = seenArmour(ctx) ?? ctx.combat.armour()[0] ?? null;

      // C4 down: set it off once it lies by the hull and nobody is in its blast, else wait it out where it is.
      const out = chargesOut(ctx);
      if (out.length > 0) {
        const def = ctx.combat.projectileDef(C4);
        if (!def || !view) return 'failure';
        const clear = def.blastRadiusM + ARMOUR.safetyMarginM;
        const safe = out.every((c) => flat(c, ctx.state) > clear && friends.every((f) => flat(c, f) > clear));
        const near = out.some((c) => flat(c, view.centre) <= ARMOUR.detonateWithinM);
        if (blackboard.get('phase') !== 'charge') {
          blackboard.set('phase', 'charge');
          blackboard.set('phaseAt', now);
        }
        const waited = now - blackboard.get('phaseAt') >= ARMOUR.detonateAfterSeconds;
        stand(blackboard, null);
        if (safe && (near || waited)) {
          blackboard.set('detonate', C4);
          blackboard.set('phase', null);
        }
        return 'running';
      }

      const kind = carried(ctx);
      if (kind < 0 || !view || ctx.memory.entries.get(view.netId)?.visible !== true) return 'failure';
      const def = ctx.combat.projectileDef(kind);
      if (!def || ctx.state.vault) return 'failure';
      const range = flat(ctx.state, view);
      const [min, max] = kind === ROCKET ? [ARMOUR.rocketMinRangeM, ARMOUR.rocketMaxRangeM] : [ARMOUR.chargeMinRangeM, ARMOUR.chargeMaxRangeM];
      if (range > max) {
        stand(blackboard, { goal: { x: view.x, y: view.y, z: view.z }, pace: 'sprint' });
        return 'running';
      }
      if (range < min) {
        const away = { x: ctx.state.x + ((ctx.state.x - view.x) / (range || 1)) * 6, y: ctx.state.y, z: ctx.state.z + ((ctx.state.z - view.z) / (range || 1)) * 6 };
        stand(blackboard, { goal: away, pace: 'sprint' });
        return 'running';
      }
      if (now < blackboard.get('throwNextAt') || now < ctx.nextThrowAt) {
        stand(blackboard, null);
        return 'running';
      }
      if (kind !== ROCKET && view.speedMps > ARMOUR.chargeMaxTankSpeedMps) {
        stand(blackboard, null);
        return 'running';
      }
      let throwAt: { projectile: number; yaw: number; pitch: number } | null = null;
      if (kind === ROCKET) {
        const shot = chooseRocket(def, ctx.state, view, friends, ctx.combat.projectileWorld());
        if (shot) throwAt = { projectile: kind, yaw: shot.yaw, pitch: shot.pitch };
      } else {
        // A claymore goes short of the hull, on the bot's side, facing it; C4 on the hull's foot.
        const back = kind === CLAYMORE ? ARMOUR.claymoreAheadM + view.radiusM : 0;
        const spot = { x: view.x + ((ctx.state.x - view.x) / (range || 1)) * back, y: view.y, z: view.z + ((ctx.state.z - view.z) / (range || 1)) * back };
        const place = choosePlacement(def, ctx.state, spot, ARMOUR.chargeReachM, friends, ctx.combat.projectileWorld());
        if (place) throwAt = { projectile: kind, yaw: place.yaw, pitch: place.pitch };
      }
      blackboard.set('throwNextAt', now + ARMOUR.retrySeconds);
      stand(blackboard, null);
      if (!throwAt) return 'failure';
      blackboard.set('throwAt', throwAt);
      return 'success';
    });
}
