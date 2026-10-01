/**
 * The escorted character's leaves (U-075): `escortStays`/`escortStay`, `escortGoes`/`escortGo`, `escortFollow`, what
 * `data/trees/escort.json` runs.
 *
 * He is an enemy-list entity on the squad's side (`EnemyDef.friendly`) with no gun to fire, so the leaves only set a
 * movement intent. The session gives his body an `EscortView`: where the squad is, and the last order the players gave
 * him (`stay`, `go` to a point, or `follow`, the default).
 */
import type { BrainBody, BrainRegistry } from '../Brain.ts';

export interface EscortOrder {
  kind: 'follow' | 'stay' | 'go';
  /** Where a `go` goes. */
  point: { x: number; y: number; z: number } | null;
}

export interface EscortView {
  /** The nearest living squad member to him, or null when none stands. */
  nearestSquad(): { x: number; y: number; z: number } | null;
  order(): EscortOrder;
}

export interface EscortBody extends BrainBody {
  readonly escort: EscortView;
}

export function isEscortBody(body: BrainBody): body is EscortBody {
  return 'escort' in body && (body as { escort?: unknown }).escort != null;
}

/** How near a `go` has to get, metres, before he counts as there. */
const ARRIVED_M = 1.5;

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

export function registerEscortLeaves(registry: BrainRegistry): BrainRegistry {
  const idle = (blackboard: { set(key: string, value: unknown): void }): void => {
    blackboard.set('fireAt', null);
    blackboard.set('suppressAt', null);
    blackboard.set('lookAt', null);
    blackboard.set('reload', false);
    blackboard.set('interact', false);
    blackboard.set('crouch', false);
  };
  return registry
    .condition('escortStays', ({ ctx }) => isEscortBody(ctx) && ctx.escort.order().kind === 'stay')
    .action('escortStay', ({ blackboard }) => {
      idle(blackboard);
      blackboard.set('intent', null);
      return 'running';
    })
    .condition('escortGoes', ({ ctx }) => isEscortBody(ctx) && ctx.escort.order().kind === 'go' && ctx.escort.order().point !== null)
    .action('escortGo', ({ ctx, blackboard }) => {
      if (!isEscortBody(ctx)) return 'failure';
      const point = ctx.escort.order().point;
      idle(blackboard);
      if (!point || distance(ctx.state, point) <= ARRIVED_M) {
        blackboard.set('intent', null);
        return 'running';
      }
      blackboard.set('intent', { goal: { ...point }, pace: 'walk' });
      return 'running';
    })
    .action('escortFollow', ({ ctx, blackboard }, args) => {
      if (!isEscortBody(ctx)) return 'failure';
      idle(blackboard);
      const keep = typeof args['keepM'] === 'number' ? args['keepM'] : 3;
      const lead = ctx.escort.nearestSquad();
      if (!lead) {
        blackboard.set('intent', null);
        return 'running';
      }
      const d = distance(ctx.state, lead);
      if (d <= keep) {
        blackboard.set('intent', null);
        return 'running';
      }
      // Fall behind and he runs to catch up; near, he walks with them.
      blackboard.set('intent', { goal: { x: lead.x, y: lead.y, z: lead.z }, pace: d > keep + 8 ? 'sprint' : 'walk' });
      return 'running';
    });
}
