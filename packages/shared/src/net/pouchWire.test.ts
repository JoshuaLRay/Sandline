/**
 * U-024: the pouch counts ride the snapshot's Weapon component, three bits
 * each. The data is held to what the wire carries — a projectile carried, or
 * a class's pouch, deeper than the wire would be silently clipped — and the
 * component carries one count per projectile, after the fields it had.
 */
import { describe, expect, it } from 'vitest';
import { CLASSES } from '../sim/classes.ts';
import { PROJECTILE_IDS, getProjectile } from '../index.ts';
import { COMPONENT_IDS } from '../ecs/components.ts';
import { POUCH_COUNT_MAX, schemaById } from './schema.ts';

describe('pouch counts on the wire (U-024)', () => {
  it('fit every projectile carried and every class pouch', () => {
    for (const id of PROJECTILE_IDS) expect(getProjectile(id).carried, id).toBeLessThanOrEqual(POUCH_COUNT_MAX);
    for (const def of Object.values(CLASSES.classes)) for (const n of def.pouch) expect(n, def.id).toBeLessThanOrEqual(POUCH_COUNT_MAX);
  });

  it('follow the weapon, the reload and the item in hand, one per projectile in PROJECTILE_IDS order', () => {
    const names = schemaById(COMPONENT_IDS.Weapon).fields.map((f) => f.name);
    // U-028's magazine count follows them.
    expect(names).toEqual(['index', 'reloadProgress', 'pouch', ...PROJECTILE_IDS.map((id) => `left_${id}`), 'ammo', 'primary', 'secondary', 'noPistol', 'kits', 'kitProgress', 'equipment']);
  });
});
