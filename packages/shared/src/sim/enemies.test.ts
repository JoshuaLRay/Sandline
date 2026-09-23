import { describe, expect, it } from 'vitest';
import {
  ENEMIES,
  ENEMY_ARCHETYPE_BITS,
  ENEMY_IDS,
  ENEMY_NET_ID_LIMIT,
  FIRST_ENEMY_NET_ID,
  enemyByIndex,
  enemyIndex,
  getEnemy,
  isEnemyNetId,
  parseEnemyTable,
} from './enemies.ts';
import { FIRST_PROJECTILE_NET_ID } from './ballistics.ts';
import { RANGE_TARGETS, isRangeTarget } from './range.ts';
import { MAX_SLOTS } from '../net/Connection.ts';

/** A valid row of our own, so retuning enemies.json never changes what these prove. */
const PERCEPTION = {
  visionRangeM: 50,
  fovDeg: 90,
  detectAt: 0.5,
  nearRatePerSec: 2,
  farRatePerSec: 0.5,
  maxRatePerSec: 2,
  decayPerSec: 0.1,
  crouchFactor: 0.5,
  proneFactor: 0.2,
  movingSpeedMps: 1,
  movingFactor: 2,
  firingFactor: 2,
  edgeFactor: 0.5,
};

const ROW = {
  id: 'rifleman',
  name: 'Test rifleman',
  health: 120,
  weapon: 'carbine',
  tree: 'idle',
  downable: false,
  corpseSeconds: 4,
  perception: PERCEPTION,
  accuracy: { baseConeDeg: 1.5 },
};

const table = (row: Record<string, unknown>) => ({ rifleman: row });

describe('enemy archetypes (T-3.10)', () => {
  it('parses a full row', () => {
    expect(parseEnemyTable(table(ROW))['rifleman']).toEqual(ROW);
  });

  it('validates the committed data: every wire id present, none downable', () => {
    expect(Object.keys(ENEMIES)).toEqual([...ENEMY_IDS]);
    for (const id of ENEMY_IDS) {
      const def = getEnemy(id);
      expect(def.downable).toBe(false);
      expect(def.corpseSeconds).toBeGreaterThan(0);
      expect(enemyByIndex(enemyIndex(id))).toBe(def);
    }
    expect(ENEMY_IDS.length).toBeLessThanOrEqual(1 << ENEMY_ARCHETYPE_BITS);
    expect(enemyByIndex(ENEMY_IDS.length)).toBeNull();
    expect(() => getEnemy('nobody')).toThrow(/nobody/);
  });

  it.each([
    ['an unknown weapon', { weapon: 'railgun' }, /railgun/],
    ['an unknown tree', { tree: 'no-such-tree' }, /no-such-tree/],
    ['zero health', { health: 0 }, /health/],
    ['health past the wire field', { health: 5000 }, /health/],
    ['a negative corpse time', { corpseSeconds: -1 }, /corpseSeconds/],
    ['a non-boolean downable', { downable: 'no' }, /downable/],
    ['a mismatched id', { id: 'mg' }, /id field/],
    ['an unknown key', { armour: 3 }, /armour/],
    ['a missing perception block', { perception: undefined }, /perception/],
    ['an unknown perception key', { perception: { ...PERCEPTION, smell: 1 } }, /smell/],
    ['a missing perception number', { perception: { ...PERCEPTION, detectAt: undefined } }, /detectAt/],
    ['a zero detection threshold', { perception: { ...PERCEPTION, detectAt: 0 } }, /detectAt/],
    ['a crouch factor past 1', { perception: { ...PERCEPTION, crouchFactor: 1.5 } }, /crouchFactor/],
    ['far faster than near', { perception: { ...PERCEPTION, farRatePerSec: 3 } }, /farRatePerSec/],
    ['prone faster than crouched', { perception: { ...PERCEPTION, proneFactor: 0.6 } }, /proneFactor/],
    ['a missing accuracy number', { accuracy: {} }, /baseConeDeg/],
  ])('refuses %s', (_label, change, message) => {
    expect(() => parseEnemyTable(table({ ...ROW, ...change }))).toThrow(message);
  });

  it('refuses an archetype outside the wire order, and a wire id with no data', () => {
    expect(() => parseEnemyTable({ ...table(ROW), officer: { ...ROW, id: 'officer' } })).toThrow(/officer/);
    expect(() => parseEnemyTable({})).toThrow(/rifleman/);
  });
});

describe('enemy netIds (T-3.10)', () => {
  it('are a bounded band clear of slots, range targets and projectiles', () => {
    expect(isEnemyNetId(FIRST_ENEMY_NET_ID)).toBe(true);
    expect(isEnemyNetId(ENEMY_NET_ID_LIMIT - 1)).toBe(true);
    expect(isEnemyNetId(FIRST_ENEMY_NET_ID - 1)).toBe(false);
    expect(isEnemyNetId(ENEMY_NET_ID_LIMIT)).toBe(false);
    for (let slotNetId = 1; slotNetId <= MAX_SLOTS; slotNetId++) expect(isEnemyNetId(slotNetId)).toBe(false);
    for (const t of RANGE_TARGETS) expect(isEnemyNetId(t.netId)).toBe(false);
    expect(isEnemyNetId(FIRST_PROJECTILE_NET_ID)).toBe(false);
    // Projectiles count upward from above the band, so they can never reach it.
    expect(FIRST_PROJECTILE_NET_ID).toBeGreaterThanOrEqual(ENEMY_NET_ID_LIMIT);
    // And the range test stays bounded against enemies.
    expect(isRangeTarget(FIRST_ENEMY_NET_ID)).toBe(false);
    // Two varuint bytes cover the whole band.
    expect(ENEMY_NET_ID_LIMIT).toBeLessThanOrEqual(1 << 14);
  });
});
