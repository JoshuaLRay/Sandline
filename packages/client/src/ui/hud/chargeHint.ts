/**
 * U-182: what the HUD says when placed charges are drawn — how they go in, and the two detonators: right click for
 * the oldest charge out (one per click, in the order they were placed), R for every one at once. A sensor is placed
 * too but never goes off, so it gets no hint.
 */
import type { ProjectileDef } from '@sandline/shared';

export function chargeHint(def: Pick<ProjectileDef, 'name' | 'kind' | 'blastDamage' | 'senseM'>, throws: boolean): string | null {
  if (def.kind !== 'placed' || def.senseM > 0 || def.blastDamage <= 0) return null;
  return `${def.name}: fire to ${throws ? 'throw' : 'place'} · right click sets off the oldest · R sets off all`;
}
