/**
 * Delta compression (T-1.04, ADR-012).
 *
 * A client acknowledges the last snapshot it applied; the server encodes the
 * next one against that baseline, sending only what changed. This is what keeps
 * the budget at ~18 KB/s per player instead of resending the world 30 times a
 * second.
 *
 * Change detection compares WIRE INTEGERS, so a float jittering below the
 * quantization step is not "changed". Comparing raw floats instead would mark
 * fields dirty forever and quietly defeat the whole mechanism.
 */
import type { BitReader, BitWriter } from './BitStream.ts';
import { COMPONENT_MASK_BITS, SCHEMAS } from './schema.ts';
import {
  type ComponentLevels,
  type EntitySnapshot,
  type WorldSnapshot,
  componentMask,
  readEntity,
  writeEntity,
} from './snapshot.ts';

/**
 * Whether a delta has a baseline is carried as an explicit BIT, not as a
 * sentinel tick value.
 *
 * The obvious shortcut — "baseline tick 0 means none" — is wrong, because tick
 * 0 is a perfectly valid tick. The server's very first delta baselines against
 * tick 0, and a receiver reading that sentinel would discard every baseline
 * entity and then fail on the first update referencing one. One bit costs
 * nothing and removes the ambiguity entirely.
 */

function sameComponents(a: ComponentLevels, b: ComponentLevels): boolean {
  if (componentMask(a) !== componentMask(b)) return false;
  for (const s of SCHEMAS) {
    const av = a[s.id];
    const bv = b[s.id];
    if (av === undefined) continue;
    for (let i = 0; i < (bv as readonly number[]).length; i++) {
      if (av[i] !== (bv as readonly number[])[i]) return false;
    }
  }
  return true;
}

export function writeDelta(w: BitWriter, current: WorldSnapshot, baseline: WorldSnapshot | null): void {
  w.writeVarUint(current.tick);
  w.writeBool(baseline !== null);
  if (baseline) w.writeVarUint(baseline.tick);

  if (!baseline) {
    w.writeVarUint(current.entities.length);
    for (const e of current.entities) writeEntity(w, e);
    w.writeVarUint(0); // despawns
    w.writeVarUint(0); // updates
    return;
  }

  const before = new Map(baseline.entities.map((e) => [e.netId, e]));
  const after = new Map(current.entities.map((e) => [e.netId, e]));

  const spawns = current.entities.filter((e) => !before.has(e.netId));
  const despawns = baseline.entities.filter((e) => !after.has(e.netId)).map((e) => e.netId);
  const updates = current.entities.filter((e) => {
    const prev = before.get(e.netId);
    return prev !== undefined && !sameComponents(prev.components, e.components);
  });

  w.writeVarUint(spawns.length);
  for (const e of spawns) writeEntity(w, e);

  w.writeVarUint(despawns.length);
  for (const id of despawns) w.writeVarUint(id);

  w.writeVarUint(updates.length);
  for (const e of updates) {
    const prev = before.get(e.netId) as EntitySnapshot;
    w.writeVarUint(e.netId);

    // Which components changed or appeared since the baseline.
    let changedMask = 0;
    for (const s of SCHEMAS) {
      const now = e.components[s.id];
      if (now === undefined) continue;
      const was = prev.components[s.id];
      if (was === undefined || s.fields.some((_, i) => was[i] !== now[i])) changedMask |= 1 << s.id;
    }
    w.writeBits(changedMask, COMPONENT_MASK_BITS);

    for (const s of SCHEMAS) {
      if ((changedMask & (1 << s.id)) === 0) continue;
      const now = e.components[s.id] as readonly number[];
      const was = prev.components[s.id];

      // Per-field mask: a player who moved but did not turn sends 3 of 5 fields.
      let fieldMask = 0;
      s.fields.forEach((_, i) => {
        if (was === undefined || was[i] !== now[i]) fieldMask |= 1 << i;
      });
      w.writeBits(fieldMask, s.fields.length);
      s.fields.forEach((f, i) => {
        if (fieldMask & (1 << i)) w.writeBits(now[i] as number, f.bits);
      });
    }
  }
}

export function readDelta(r: BitReader, baseline: WorldSnapshot | null): WorldSnapshot {
  const tick = r.readVarUint();
  const hasBaseline = r.readBool();
  const baselineTick = hasBaseline ? r.readVarUint() : -1;

  if (hasBaseline && (!baseline || baseline.tick !== baselineTick)) {
    throw new RangeError(
      `delta expects baseline tick ${baselineTick}, caller supplied ${baseline ? baseline.tick : 'none'}`,
    );
  }
  if (!hasBaseline && baseline) {
    throw new RangeError('delta is a full snapshot but a baseline was supplied');
  }

  const byId = new Map<number, EntitySnapshot>(
    !hasBaseline || !baseline
      ? []
      : baseline.entities.map((e) => [e.netId, { netId: e.netId, components: { ...e.components } }]),
  );

  const spawnCount = r.readVarUint();
  for (let i = 0; i < spawnCount; i++) {
    const e = readEntity(r);
    byId.set(e.netId, e);
  }

  const despawnCount = r.readVarUint();
  for (let i = 0; i < despawnCount; i++) byId.delete(r.readVarUint());

  const updateCount = r.readVarUint();
  for (let i = 0; i < updateCount; i++) {
    const netId = r.readVarUint();
    const changedMask = r.readBits(COMPONENT_MASK_BITS);
    const target = byId.get(netId);
    if (!target) throw new RangeError(`delta updates unknown entity ${netId} (baseline mismatch)`);

    const components: Record<number, number[]> = {};
    for (const [k, v] of Object.entries(target.components)) components[Number(k)] = [...v];

    for (const s of SCHEMAS) {
      if ((changedMask & (1 << s.id)) === 0) continue;
      const fieldMask = r.readBits(s.fields.length);
      const existing = components[s.id];
      const values = existing ? [...existing] : s.fields.map(() => 0);
      s.fields.forEach((f, idx) => {
        if (fieldMask & (1 << idx)) values[idx] = r.readBits(f.bits);
      });
      components[s.id] = values;
    }
    byId.set(netId, { netId, components });
  }

  return { tick, entities: [...byId.values()] };
}

/**
 * Per-client baseline ring buffer, keyed by tick.
 *
 * Bounded on purpose: a client that stops acknowledging must not grow server
 * memory without limit. Once its last ack falls out of the window it gets a
 * full snapshot instead, which is correct and self-healing.
 */
export class SnapshotHistory {
  private readonly ring: (WorldSnapshot | null)[];

  constructor(private readonly capacity = 64) {
    this.ring = new Array<WorldSnapshot | null>(capacity).fill(null);
  }

  store(snap: WorldSnapshot): void {
    this.ring[snap.tick % this.capacity] = snap;
  }

  /** The snapshot for `tick`, or null if it has aged out of the window. */
  get(tick: number): WorldSnapshot | null {
    const found = this.ring[tick % this.capacity];
    return found && found.tick === tick ? found : null;
  }

  clear(): void {
    this.ring.fill(null);
  }
}
