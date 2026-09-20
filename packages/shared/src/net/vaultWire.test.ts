/**
 * T-2.21. The Vault component has two ends and a schema between them; this
 * proves the three agree through the real bit writer at the real widths.
 */
import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter } from './BitStream.ts';
import { COMPONENT_IDS } from '../ecs/components.ts';
import { readEntity, writeEntity } from './snapshot.ts';
import { vaultFromLevels, vaultToLevels } from './vaultWire.ts';

const Vt = COMPONENT_IDS.Vault;

function roundTrip(levels: number[]) {
  const w = new BitWriter();
  writeEntity(w, { netId: 3, components: { [Vt]: levels } });
  return vaultFromLevels(readEntity(new BitReader(w.toUint8Array())).components[Vt] as number[]);
}

describe('vault on the wire (T-2.21)', () => {
  it('carries a vault in progress to position precision and the millisecond', () => {
    const v = roundTrip(vaultToLevels({ elapsed: 0.2333, yaw: 700, fromX: -9, fromY: 0, fromZ: -2.1875, topY: 1 }));
    expect(v).not.toBeNull();
    expect(v?.elapsed).toBeCloseTo(0.233, 6);
    expect(v?.yaw).toBe(700);
    expect(v?.fromX).toBeCloseTo(-9, 6);
    expect(v?.fromZ).toBeCloseTo(-2.1875, 6);
    expect(v?.topY).toBeCloseTo(1, 6);
  });

  it('carries "not vaulting" as null, and a missing component the same', () => {
    expect(roundTrip(vaultToLevels(null))).toBeNull();
    expect(vaultFromLevels(undefined)).toBeNull();
  });
});
