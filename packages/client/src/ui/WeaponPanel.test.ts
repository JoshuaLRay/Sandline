/**
 * The paste-back block must carry every field a weapon has, or tuning in the
 * harness silently loses whatever field was added last (it lost T-2.08 and
 * T-2.09's for a day). Node-only: JSON_ORDER needs no DOM.
 */
import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@sandline/shared';
import { JSON_ORDER, OPTIONAL_FIELDS } from './WeaponPanel.ts';

describe('weapon panel paste-back (T-2.12 prep)', () => {
  it('lists every field of every shipped weapon exactly once, and nothing else', () => {
    for (const def of Object.values(WEAPONS)) {
      const keys = Object.keys(def).sort();
      // Every field the weapon has, and every field but the optional ones it lacks.
      expect(JSON_ORDER.filter((k) => !OPTIONAL_FIELDS.includes(k) || k in def).sort()).toEqual(keys);
    }
    // Each optional field is shipped on at least one weapon, so the list is not stale.
    for (const k of OPTIONAL_FIELDS) expect(Object.values(WEAPONS).some((d) => k in d), k).toBe(true);
    expect(new Set(JSON_ORDER).size).toBe(JSON_ORDER.length);
  });
});
