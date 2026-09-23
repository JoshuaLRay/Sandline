import { describe, expect, it } from 'vitest';
import {
  ENEMIES,
  ENEMY_ARCHETYPE_BITS,
  ENEMY_SHAPES,
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

const ACCURACY = {
  baseConeDeg: 1.5,
  distanceDoublingM: 30,
  speedFactorPerMps: 0.2,
  suppressionFactor: 1,
  acquireFactor: 2,
  settleSeconds: 1,
  maxConeDeg: 8,
  holdBloomDeg: 1,
  burstRounds: 5,
  burstPauseSeconds: 0.4,
  hitBand: { rangeM: 20, min: 0.3, max: 0.6 },
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
  accuracy: ACCURACY,
};

/** What a parsed row adds to the authored one: no role preference and no archetype block, unless given. */
const PARSED_EXTRAS = { prefersRole: null, deploy: null, launcher: null, scope: null, command: null };

const table = (row: Record<string, unknown>) => ({ rifleman: row });

/** One row of each of the five shapes (T-3.23): the rifleman's none, and each of the others' own block. */
const SHAPED: Record<string, Record<string, unknown>> = {
  rifleman: ROW,
  mg: { ...ROW, id: 'mg', prefersRole: 'suppressor', deploy: { seconds: 1.5, movingSpeedMps: 0.2 } },
  rpg: { ...ROW, id: 'rpg', launcher: { projectile: 'rocket' } },
  sniper: { ...ROW, id: 'sniper', weapon: 'marksman', scope: { aimSeconds: 2 } },
  officer: { ...ROW, id: 'officer', weapon: 'sidearm', prefersRole: 'flanker', command: { radiusM: 30 } },
};

describe('enemy archetypes (T-3.10)', () => {
  it('parses a full row', () => {
    expect(parseEnemyTable(table(ROW))['rifleman']).toEqual({ ...ROW, ...PARSED_EXTRAS });
  });

  it('validates the committed data: exactly the two slice archetypes (ADR-015), none downable', () => {
    expect(Object.keys(ENEMIES)).toEqual(['rifleman', 'mg']);
    expect(ENEMY_IDS.slice(0, 2)).toEqual(['rifleman', 'mg']);
    expect(getEnemy('rifleman').tree).toBe('rifleman');
    expect(getEnemy('mg').tree).toBe('mg');
    expect(getEnemy('mg').weapon).toBe('lmg');
    expect(getEnemy('mg').prefersRole).toBe('suppressor');
    expect(getEnemy('mg').deploy?.seconds).toBeGreaterThan(0);
    for (const id of Object.keys(ENEMIES)) {
      const def = getEnemy(id);
      expect(def.downable).toBe(false);
      expect(def.corpseSeconds).toBeGreaterThan(0);
      expect(enemyByIndex(enemyIndex(id))).toBe(def);
    }
    expect(ENEMY_IDS.length).toBeLessThanOrEqual(1 << ENEMY_ARCHETYPE_BITS);
    expect(enemyByIndex(ENEMY_IDS.length)).toBeNull();
    // In the wire order, absent from the data: an index nothing is built for.
    expect(enemyByIndex(enemyIndex('rpg'))).toBeNull();
    expect(() => getEnemy('sniper')).toThrow(/sniper/);
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
    ['an unknown accuracy key', { accuracy: { ...ACCURACY, luck: 1 } }, /luck/],
    ['a zero doubling distance', { accuracy: { ...ACCURACY, distanceDoublingM: 0 } }, /distanceDoublingM/],
    ['an acquire factor that narrows', { accuracy: { ...ACCURACY, acquireFactor: 0.5 } }, /acquireFactor/],
    ['a ceiling under the base cone', { accuracy: { ...ACCURACY, maxConeDeg: 1 } }, /maxConeDeg/],
    ['a burst of no rounds', { accuracy: { ...ACCURACY, burstRounds: 0 } }, /burstRounds/],
    ['a negative burst pause', { accuracy: { ...ACCURACY, burstPauseSeconds: -1 } }, /burstPauseSeconds/],
    ['a missing hit band', { accuracy: { ...ACCURACY, hitBand: undefined } }, /hitBand/],
    ['a hit band upside down', { accuracy: { ...ACCURACY, hitBand: { rangeM: 20, min: 0.7, max: 0.2 } } }, /min is above max/],
    ['a hit rate past 1', { accuracy: { ...ACCURACY, hitBand: { rangeM: 20, min: 0.2, max: 1.2 } } }, /max/],
  ])('refuses %s', (_label, change, message) => {
    expect(() => parseEnemyTable(table({ ...ROW, ...change }))).toThrow(message);
  });

  it('refuses an archetype outside the wire order, and a table with none', () => {
    expect(() => parseEnemyTable({ ...table(ROW), grenadier: { ...ROW, id: 'grenadier' } })).toThrow(/grenadier/);
    expect(() => parseEnemyTable({})).toThrow(/no archetypes/);
  });
});

describe('the five archetype shapes (T-3.23)', () => {
  it('accepts a row of every shape, each block parsed onto its own archetype alone', () => {
    const parsed = parseEnemyTable(SHAPED);
    expect(Object.keys(parsed)).toEqual([...ENEMY_IDS]);
    for (const id of ENEMY_IDS) {
      const shape = ENEMY_SHAPES[id];
      for (const block of ['deploy', 'launcher', 'scope', 'command'] as const) {
        if (block === shape) expect(parsed[id]![block]).toEqual(SHAPED[id]![block]);
        else expect(parsed[id]![block]).toBeNull();
      }
    }
    expect(parsed['mg']!.prefersRole).toBe('suppressor');
    expect(parsed['officer']!.prefersRole).toBe('flanker');
    expect(parsed['rifleman']!.prefersRole).toBeNull();
  });

  it.each([
    ['an MG with no deploy block', 'mg', { deploy: undefined }, /needs a "deploy"/],
    ['an RPG with no launcher', 'rpg', { launcher: undefined }, /needs a "launcher"/],
    ['a sniper with no scope', 'sniper', { scope: undefined }, /needs a "scope"/],
    ['an officer with no command', 'officer', { command: undefined }, /needs a "command"/],
    ['a rifleman that deploys', 'rifleman', { deploy: { seconds: 1, movingSpeedMps: 0.2 } }, /"deploy" is not a rifleman's/],
    ['an MG with a scope', 'mg', { scope: { aimSeconds: 1 } }, /"scope" is not a mg's/],
    ['an RPG firing something that is not a projectile', 'rpg', { launcher: { projectile: 'brick' } }, /brick/],
    ['a deploy block with an unknown key', 'mg', { deploy: { seconds: 1, movingSpeedMps: 0.2, tripod: true } }, /tripod/],
    ['a negative deploy time', 'mg', { deploy: { seconds: -1, movingSpeedMps: 0.2 } }, /seconds/],
    ['a role nobody hands out', 'mg', { prefersRole: 'cook' }, /prefersRole/],
    ['a weapon in no table', 'mg', { weapon: 'railgun' }, /railgun/],
  ])('refuses %s', (_label, id, change, message) => {
    expect(() => parseEnemyTable({ [id]: { ...SHAPED[id], ...change } })).toThrow(message);
  });

  it('takes a weapon from any row of the table, not only the players\' loadout', () => {
    expect(parseEnemyTable({ mg: { ...SHAPED['mg'], weapon: 'lmg' } })['mg']!.weapon).toBe('lmg');
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
