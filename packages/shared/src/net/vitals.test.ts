/**
 * T-2.15. The Health component's six fields have exactly two ends —
 * `encodeVitals` on the server and `decodeVitals` on the client — and the
 * schema between them. This proves the three agree, through the real bit
 * writer, at the field widths the wire actually has.
 */
import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter } from './BitStream.ts';
import { COMPONENT_IDS } from '../ecs/components.ts';
import { readEntity, writeEntity } from './snapshot.ts';
import {
  type DamageConfig,
  NO_REVIVER_SLOT,
  REVIVE_PROGRESS_LEVELS,
  applyDamage,
  createHealth,
  decodeVitals,
  encodeVitals,
  expireBleedOut,
} from '../sim/damage.ts';

const CONFIG: DamageConfig = {
  maxHealth: 100,
  respawnSeconds: 5,
  downed: { bleedOutSeconds: 20, reviveSeconds: 3, reviveRangeM: 1.5, reviveHealthFraction: 0.4 },
  zones: {
    head: { multiplier: 2, minFraction: 0.8 },
    torso: { multiplier: 1, minFraction: 0.4 },
    limb: { multiplier: 0.5, minFraction: 0 },
  },
};
const H = COMPONENT_IDS.Health;

function roundTrip(levels: number[]) {
  const w = new BitWriter();
  writeEntity(w, { netId: 9, components: { [H]: levels } });
  const back = readEntity(new BitReader(w.toUint8Array()));
  return decodeVitals(back.components[H] as number[]);
}

describe('vitals on the wire (T-2.13, T-2.15)', () => {
  it('carries a downed soldier being revived: state, timer, progress and reviver', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 10, CONFIG);
    const v = roundTrip(encodeVitals(h, 12, 2 / 3, 4, CONFIG));
    expect(v).toEqual({
      current: 0,
      max: 100,
      vitality: 'downed',
      timer: 18,
      reviveProgress: Math.round((2 / 3) * REVIVE_PROGRESS_LEVELS) / REVIVE_PROGRESS_LEVELS,
      reviverSlot: 4,
    });
  });

  it('carries "nobody" as null, and alive as zeros', () => {
    const h = createHealth(CONFIG);
    const levels = encodeVitals(h, 0, 0, null, CONFIG);
    expect(levels[5]).toBe(NO_REVIVER_SLOT);
    expect(roundTrip(levels)).toEqual({ current: 100, max: 100, vitality: 'alive', timer: 0, reviveProgress: 0, reviverSlot: null });
  });

  it('caps the timer at the field width and the progress at one', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 0, { ...CONFIG, downed: { ...CONFIG.downed, bleedOutSeconds: 200 } });
    const v = roundTrip(encodeVitals(h, 0, 7, 0, { ...CONFIG, downed: { ...CONFIG.downed, bleedOutSeconds: 200 } }));
    expect(v.timer).toBe(63);
    expect(v.reviveProgress).toBe(1);
    expect(v.reviverSlot).toBe(0);
  });

  it('reads a dead soldier with the respawn timer', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 0, CONFIG);
    expireBleedOut(h, 20, CONFIG);
    expect(roundTrip(encodeVitals(h, 21.5, 0, null, CONFIG))).toMatchObject({ vitality: 'dead', timer: 4 });
  });

  it('tolerates a short array from an older sender', () => {
    expect(decodeVitals([50, 100])).toEqual({ current: 50, max: 100, vitality: 'alive', timer: 0, reviveProgress: 0, reviverSlot: null });
  });
});
