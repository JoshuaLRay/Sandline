import { describe, expect, it } from 'vitest';
import { getProjectile } from '@sandline/shared';
import { chargeHint } from './chargeHint.ts';

describe('the placed-charge hint (U-182)', () => {
  it('names both detonators for C4, thrown or placed', () => {
    expect(chargeHint(getProjectile('c4'), false)).toBe('C4 Charge: fire to place · right click sets off the oldest · R sets off all');
    expect(chargeHint(getProjectile('c4'), true)).toContain('fire to throw');
  });

  it('says nothing for a grenade, a rocket or the motion sensor', () => {
    for (const id of ['frag', 'rocket', 'smoke', 'sensor']) expect(chargeHint(getProjectile(id), false)).toBeNull();
  });
});
