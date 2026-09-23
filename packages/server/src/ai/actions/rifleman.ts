/**
 * The rifleman's fight (T-3.20): the leaves `data/trees/rifleman.json` names.
 *
 * The tree decides WHICH of these runs; each leaf only does its one thing and
 * writes the hands and stance it wants onto the blackboard (`BrainMemory`):
 * where to walk (`intent`), whom to shoot (`fireAt`), whether to crouch, to
 * reload, and what to face while walking (`lookAt`). The session turns those
 * into a `MoveInput` and trigger pulls through the same paths a player's go
 * (§7.9 rule 1). Every leaf sets every field it owns on every tick it runs, so
 * a pre-empted leaf leaves nothing behind that the next one did not choose.
 *
 * Numbers a playtest will want to move are the tree's `args` (standing rule
 * 4), not constants here; the cover it takes is T-3.19's query.
 */
import { BRAIN_TICKS_PER_SECOND, type BrainBody, type BrainMemory, type BrainRegistry } from '../Brain.ts';
import { COVER, firingPosition } from '../cover.ts';
import type { BtArgs, BtFrame } from '@sandline/shared';
import { suppressionLevel } from '@sandline/shared';
import { type CombatBody, type Vec3, across, isCombatBody, threatEye } from './combat.ts';

type Frame = BtFrame<BrainBody, BrainMemory>;

/** Past this, the walk to cover is a sprint along the path; inside it, a walk facing the threat. */
const SPRINT_BEYOND_M = 3;
/**
 * How close to a point (a cover point, a firing position) counts as there:
 * the path follower's own arrival radius (0.25 m, measured to the goal as
 * snapped onto the mesh) plus the 0.1 m a baked point may sit off the mesh
 * (T-3.18's `onMesh`), and a little over. Any tighter and a soldier the
 * follower has already stopped never counts as arrived; the cover query
 * probes the body's full width (T-3.19), so this much slack does not leave a
 * shoulder out. Not the cover system's `arriveM`, which is how near a holder
 * must come before leaving releases it.
 */
const THERE_M = 0.4;
/** A step out of high cover, or back, that has not got there in this long goes on regardless. */
const STEP_SECONDS = 1.2;

function num(args: BtArgs, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === 'number' ? v : fallback;
}

/** Hands down: nothing to shoot, nothing to reload, stance and gaze as given. */
function hands(frame: Frame, crouch: boolean, lookAt: Vec3 | null): void {
  frame.blackboard.set('fireAt', null);
  frame.blackboard.set('reload', false);
  frame.blackboard.set('crouch', crouch);
  frame.blackboard.set('lookAt', lookAt);
}

function heldPoint(body: CombatBody) {
  return body.combat.cover?.heldPoint(body.netId) ?? null;
}

/**
 * At its point — or out on a peek from it (`peeking`): a soldier stepping out
 * of high cover to fire is still fighting from that cover, and must not be
 * sent back to it by the very step that makes it useful.
 */
function inCover(body: CombatBody, peeking = false): boolean {
  const point = heldPoint(body);
  if (point === null) return false;
  const off = across(body.state, point);
  return off <= THERE_M || (peeking && off <= COVER.sideStepM + THERE_M * 2);
}

function lowAmmo(body: CombatBody, fraction: number): boolean {
  return body.weaponState.reloadEndsAt > body.combat.now() || body.weaponState.ammo <= body.weapon.magSize * fraction;
}

function pressured(body: CombatBody, args: BtArgs): boolean {
  const now = body.combat.now();
  return suppressionLevel(body.suppression, now) >= num(args, 'suppression', 0.3) || now - body.lastDamagedAt < num(args, 'hurtSeconds', 1.5);
}

/** Walk to `goal`: a sprint along the path when far, a walk facing `face` when close. */
function walkTo(frame: Frame, body: CombatBody, goal: Vec3, face: Vec3 | null): void {
  const far = across(body.state, goal) > SPRINT_BEYOND_M;
  frame.blackboard.set('intent', { goal: { x: goal.x, y: goal.y, z: goal.z }, pace: far ? 'sprint' : 'walk' });
  frame.blackboard.set('lookAt', far ? null : face);
}

/** Register the rifleman's leaves on a brain registry. */
export function registerRiflemanLeaves(registry: BrainRegistry): BrainRegistry {
  return (
    registry
      // --- conditions -------------------------------------------------------
      .condition('hasThreat', ({ ctx }) => isCombatBody(ctx) && threatEye(ctx) !== null)
      /** Its point no longer hides it from the threat: the threat has come round (or it never had one to lose). */
      .condition('flanked', ({ ctx }) => {
        if (!isCombatBody(ctx) || !ctx.combat.cover || !heldPoint(ctx)) return false;
        const eye = threatEye(ctx);
        return eye !== null && !ctx.combat.cover.stillProtects(ctx.netId, [eye]);
      })
      .condition('inCover', ({ ctx, blackboard }) => isCombatBody(ctx) && inCover(ctx, blackboard.get('phase') !== null))
      .condition('lowAmmo', ({ ctx }, args) => isCombatBody(ctx) && lowAmmo(ctx, num(args, 'fraction', 0.3)))
      .condition('pressured', ({ ctx }, args) => isCombatBody(ctx) && pressured(ctx, args))
      /** Nobody has shot at it, near it or into it for `seconds`. */
      .condition('unopposed', ({ ctx }, args) => {
        if (!isCombatBody(ctx) || ctx.target === null) return false;
        const now = ctx.combat.now();
        const quiet = num(args, 'seconds', 4);
        const threatAt = ctx.memory.entries.get(ctx.target)?.threatAt ?? null;
        return (
          suppressionLevel(ctx.suppression, now) === 0 && now - ctx.lastDamagedAt > quiet && (threatAt === null || now - threatAt > quiet)
        );
      })

      // --- actions ----------------------------------------------------------
      /**
       * To cover: the point it holds while that still hides it, else the best
       * the query offers (T-3.19), reserved. Running on the way, success on
       * arrival, failure when there is none to be had.
       */
      .action('takeCover', (frame) => {
        const body = frame.ctx;
        if (!isCombatBody(body) || !body.combat.cover) return 'failure';
        const eye = threatEye(body);
        if (!eye) return 'failure';
        const cover = body.combat.cover;
        let point = heldPoint(body);
        if (!point || !cover.stillProtects(body.netId, [eye])) {
          point = cover.choose(body.netId, { from: body.state, threats: [eye], friends: body.combat.friendsOf(body.netId, body.faction) })?.point ?? null;
        }
        if (!point) return 'failure';
        hands(frame, false, null);
        if (across(body.state, point) <= THERE_M) {
          frame.blackboard.set('intent', null);
          return 'success';
        }
        walkTo(frame, body, point, eye);
        return 'running';
      })
      /** In cover, down: concealed in the point's stance, facing the threat, still. */
      .action('hide', (frame) => {
        const body = frame.ctx;
        if (!isCombatBody(body)) return 'failure';
        frame.blackboard.set('intent', null);
        hands(frame, heldPoint(body)?.height === 'low', threatEye(body));
        frame.blackboard.set('phase', null);
        return 'running';
      })
      /**
       * Peek, fire a burst, return. Over low cover that is standing up and
       * crouching again; out of high cover, a side step to the firing
       * position (T-3.19) and back. A burst is `burstSeconds`, cut short when
       * the magazine runs low; the session only pulls the trigger with a line
       * of sight, so a peek at nothing fires nothing.
       */
      .action('peek', {
        tick(frame, args) {
          const body = frame.ctx;
          if (!isCombatBody(body) || body.target === null) return 'failure';
          const point = heldPoint(body);
          const eye = threatEye(body);
          if (!point || !eye) return 'failure';
          const bb = frame.blackboard;
          const burstTicks = Math.round(num(args, 'burstSeconds', 1.2) * BRAIN_TICKS_PER_SECOND);
          const reserve = num(args, 'reserve', 0.3);
          bb.set('reload', false);
          const start = (phase: string) => {
            bb.set('phase', phase);
            bb.set('phaseAt', frame.tick);
          };
          if (bb.get('phase') === null) {
            if (point.height === 'low') start('firing');
            else {
              if (!firingPosition(point, eye, body.combat.boxes)) return 'failure';
              start('out');
            }
          }
          const phase = bb.get('phase');
          const stepTicks = Math.round(STEP_SECONDS * BRAIN_TICKS_PER_SECOND);
          if (phase === 'out') {
            const out = firingPosition(point, eye, body.combat.boxes);
            if (!out) {
              start('back');
            } else if (across(body.state, out) <= THERE_M || frame.tick - bb.get('phaseAt') >= stepTicks) {
              // There — or as near as the mesh lets it get; the session fires only with a line of sight.
              start('firing');
            } else {
              bb.set('intent', { goal: out, pace: 'walk' });
              bb.set('lookAt', eye);
              bb.set('crouch', false);
              bb.set('fireAt', null);
              return 'running';
            }
          }
          if (bb.get('phase') === 'firing') {
            const done = frame.tick - bb.get('phaseAt') >= burstTicks || lowAmmo(body, reserve);
            if (!done) {
              bb.set('intent', null);
              bb.set('crouch', false);
              bb.set('lookAt', eye);
              bb.set('fireAt', body.target);
              return 'running';
            }
            if (point.height === 'low') {
              bb.set('phase', null);
              hands(frame, true, eye);
              return 'success';
            }
            start('back');
          }
          // Back behind the high point.
          bb.set('fireAt', null);
          bb.set('crouch', false);
          if (across(body.state, point) <= THERE_M || frame.tick - bb.get('phaseAt') >= stepTicks) {
            bb.set('phase', null);
            bb.set('intent', null);
            bb.set('lookAt', eye);
            return 'success';
          }
          bb.set('intent', { goal: { x: point.x, y: point.y, z: point.z }, pace: 'walk' });
          bb.set('lookAt', eye);
          return 'running';
        },
        halt(frame) {
          const body = frame.ctx;
          const point = isCombatBody(body) ? heldPoint(body) : null;
          frame.blackboard.set('phase', null);
          frame.blackboard.set('fireAt', null);
          frame.blackboard.set('crouch', point?.height === 'low');
          // Cut short out of high cover: back to the point, not left standing in the open.
          if (point && point.height === 'high') frame.blackboard.set('intent', { goal: { x: point.x, y: point.y, z: point.z }, pace: 'walk' });
        },
      })
      /** Reload where it is — the tree only asks in cover — concealed, until the magazine is full. */
      .action('reload', {
        tick(frame) {
          const body = frame.ctx;
          if (!isCombatBody(body)) return 'failure';
          const point = heldPoint(body);
          const home = point !== null && across(body.state, point) <= THERE_M;
          // Back to the point first — a peek out of high cover cut short by
          // the magazine leaves it standing out past the edge.
          frame.blackboard.set('intent', point && !home ? { goal: { x: point.x, y: point.y, z: point.z }, pace: 'walk' } : null);
          hands(frame, point?.height === 'low', threatEye(body));
          frame.blackboard.set('phase', null);
          const full = body.weaponState.ammo >= body.weapon.magSize && body.weaponState.reloadEndsAt <= body.combat.now();
          if (full) return 'success';
          // Down first, then the hands: the reload waits until it is on its
          // point and, behind low cover, until the crouch has taken, so it
          // never starts with the head up.
          const concealed = home && (point?.height !== 'low' || body.state.crouched);
          frame.blackboard.set('reload', concealed);
          return 'running';
        },
        halt(frame) {
          frame.blackboard.set('reload', false);
        },
      })
      /**
       * Unopposed: take a point at least `minGainM` nearer the target, if one
       * hides it — not past `closestM` of it. Succeeds having reserved it
       * (takeCover then walks there); fails, keeping its point, when there is
       * none.
       */
      .action('advance', (frame, args) => {
        const body = frame.ctx;
        if (!isCombatBody(body) || !body.combat.cover) return 'failure';
        const eye = threatEye(body);
        const here = heldPoint(body) ?? body.state;
        if (!eye) return 'failure';
        const now = across(here, eye);
        const gain = num(args, 'minGainM', 4);
        const closest = num(args, 'closestM', 10);
        const query = {
          from: body.state,
          threats: [eye],
          friends: body.combat.friendsOf(body.netId, body.faction),
          accept: (p: Vec3) => {
            const d = across(p, eye);
            return d <= now - gain && d >= closest;
          },
        };
        // Look before letting go of the point it has: choosing releases it.
        if (body.combat.cover.rank(query, body.netId).length === 0) return 'failure';
        return body.combat.cover.choose(body.netId, query) ? 'success' : 'failure';
      })
      /** No cover to be had: stand and fight where it is. */
      .action('engageOpen', {
        tick(frame) {
          const body = frame.ctx;
          if (!isCombatBody(body) || body.target === null) return 'failure';
          frame.blackboard.set('intent', null);
          hands(frame, false, threatEye(body));
          frame.blackboard.set('fireAt', body.target);
          return 'running';
        },
        halt(frame) {
          frame.blackboard.set('fireAt', null);
        },
      })
      /** Nothing known to fight: hands down, cover given up, standing still. */
      .action('standDown', (frame) => {
        const body = frame.ctx;
        if (isCombatBody(body)) body.combat.cover?.release(body.netId);
        frame.blackboard.set('intent', null);
        frame.blackboard.set('phase', null);
        hands(frame, false, null);
        return 'running';
      })
  );
}

/** For the tests: the leaves' reading of a body, without a tree. */
export const riflemanReads = { inCover, lowAmmo, pressured };
