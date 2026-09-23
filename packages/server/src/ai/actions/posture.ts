/**
 * Posture (T-3.32): what an enemy does with nothing to fight — the posture
 * its encounter group spawned it with (`data/encounters/*.json`), taken on
 * spawn and gone back to when the fight is over. The rifleman's and the
 * MG's trees end in `atEase` where they used to end in `standDown`; an enemy
 * spawned with no posture (a test's, the QA page's) stands down exactly as
 * before.
 *
 * - **hold** — at its post (where it spawned), facing its `face` point;
 *   pushed or walked off it, back to it.
 * - **patrol** — its post, then each route point, round again, walking.
 * - **garrison** — the best cover inside its area against its `face` point
 *   (the squad's start), else the area's middle; down behind it when it is
 *   low. It also fights from inside the area (`coverNear`, as a friendly
 *   bot's cover is held near its formation place).
 */
import type { BtFrame, GroundArea } from '@sandline/shared';
import { DEFAULT_MUZZLE_RIG } from '@sandline/shared';
import type { BrainBody, BrainMemory, BrainRegistry } from '../Brain.ts';
import { type CombatBody, type Vec3, across, isCombatBody } from './combat.ts';

type Frame = BtFrame<BrainBody, BrainMemory>;

/** A posture as an enemy carries it: resolved to points when it spawned. */
export interface EnemyPosture {
  kind: 'hold' | 'patrol' | 'garrison';
  /** Where it spawned: a hold's post, a patrol's first point. */
  post: { x: number; y: number; z: number };
  /** What it faces standing: a hold's `face`, a garrison's threat. */
  face: { x: number; z: number };
  /** A patrol's points after its post. */
  route: readonly { x: number; z: number }[];
  /** A garrison's area. */
  area: GroundArea | null;
  /** The patrol point it is walking to: 0 its post, i the route's (i − 1)th. */
  leg: number;
}

/** A soldier with a posture. */
export interface PostureBody extends CombatBody {
  readonly posture: EnemyPosture | null;
}

function hasPosture(body: BrainBody): body is PostureBody {
  return isCombatBody(body) && 'posture' in body && (body as { posture: unknown }).posture != null;
}

/** Near enough a patrol point to turn for the next, metres. */
export const PATROL_TURN_M = 1.2;
/** A holder this far off its post walks back, metres. */
export const HOLD_SLACK_M = 0.6;
/** How near a point counts as there: the fighting leaves' own measure. */
const THERE_M = 0.4;

function idle(frame: Frame, lookAt: Vec3 | null, crouch = false): void {
  const bb = frame.blackboard;
  bb.set('fireAt', null);
  bb.set('suppressAt', null);
  bb.set('reload', false);
  bb.set('crouch', crouch);
  bb.set('lookAt', lookAt);
  bb.set('interact', false);
  bb.set('phase', null);
}

function eyeAt(p: { x: number; z: number }, y: number): Vec3 {
  return { x: p.x, y: y + DEFAULT_MUZZLE_RIG.eyeHeight, z: p.z };
}

/** A patrol's point `leg`: its post, or a route point. */
export function patrolPoint(posture: EnemyPosture, leg: number): { x: number; y: number; z: number } {
  if (leg === 0) return posture.post;
  const p = posture.route[leg - 1]!;
  return { x: p.x, y: posture.post.y, z: p.z };
}

export function registerPostureLeaves(registry: BrainRegistry): BrainRegistry {
  return registry.action('atEase', (frame) => {
    const body = frame.ctx;
    // A fight's cover is given up, except a garrison's, which keeps its point.
    if (isCombatBody(body) && !(hasPosture(body) && body.posture!.kind === 'garrison')) body.combat.cover?.release(body.netId);
    if (!hasPosture(body)) {
      // No posture: stand down, as the trees did before T-3.32.
      frame.blackboard.set('intent', null);
      idle(frame, null);
      return 'running';
    }
    const p = body.posture!;
    const y = body.state.y;
    if (p.kind === 'hold') {
      const face = eyeAt(p.face, y);
      if (across(body.state, p.post) > HOLD_SLACK_M) {
        frame.blackboard.set('intent', { goal: { ...p.post }, pace: 'walk' });
        idle(frame, face);
        return 'running';
      }
      frame.blackboard.set('intent', null);
      idle(frame, face);
      return 'running';
    }
    if (p.kind === 'patrol') {
      const legs = p.route.length + 1;
      if (across(body.state, patrolPoint(p, p.leg)) <= PATROL_TURN_M) p.leg = (p.leg + 1) % legs;
      frame.blackboard.set('intent', { goal: patrolPoint(p, p.leg), pace: 'walk' });
      idle(frame, null);
      return 'running';
    }
    // Garrison: cover inside the area against the face, else its middle.
    const area = p.area!;
    const threat = eyeAt(p.face, y);
    const cover = body.combat.cover;
    let goal: Vec3 = { x: area.x, y, z: area.z };
    let low = false;
    if (cover) {
      const inside = (q: { x: number; z: number }) => Math.sqrt((q.x - area.x) ** 2 + (q.z - area.z) ** 2) <= area.radius;
      let held = cover.heldPoint(body.netId);
      if (!held || !inside(held)) {
        held = cover.choose(body.netId, { from: body.state, threats: [threat], friends: body.combat.friendsOf(body.netId, body.faction), combat: false, accept: inside })?.point ?? null;
      }
      if (held) {
        goal = held;
        low = held.height === 'low';
      }
    }
    if (across(body.state, goal) > THERE_M) {
      frame.blackboard.set('intent', { goal: { x: goal.x, y: goal.y, z: goal.z }, pace: 'walk' });
      idle(frame, null);
      return 'running';
    }
    frame.blackboard.set('intent', null);
    idle(frame, threat, low);
    return 'running';
  });
}
