import { describe, expect, it } from 'vitest';
import { loadWorld, parseEncounter, requireWorld } from '@sandline/shared';
import { Spawner, type SpawnerHost } from './spawner.ts';

const world = loadWorld({ id: 'staged-spawner', floor: { halfExtent: 40 }, cover: [],
  mission: { ...requireWorld('greybox-01').mission!, spawnZones: [{ id: 'z', on: 'objective', x: 0, z: 0, radius: 10 }] } });
const encounter = parseEncounter({ world: world.id, aliveCap: 3, probes: [1], areas: {}, groups: [
  { id: 'reserve', zone: 'z', staged: true, members: [{ archetype: 'rifleman', count: 2 }], posture: { kind: 'hold' }, trigger: { kind: 'script' },
    sockets: [10, 20].map((x) => ({ id: `C${x}`, archetype: 'rifleman', feet: { x, y: 0, z: 10 }, face: { x, z: 0 } })) },
  { id: 'later', zone: 'z', members: [{ archetype: 'rifleman', count: 2 }], fixedCount: true, posture: { kind: 'hold' }, trigger: { kind: 'script' } },
] }, () => world);
function host() {
  const alive = new Map<number, Parameters<SpawnerHost['spawn']>[1]>(); const releases: number[] = []; let serial = 0;
  const h: SpawnerHost = { humanEyes: () => [], squadFeet: () => [], enemyFeet: () => [...alive.values()], isAlive: (id) => alive.has(id),
    spawn: (_a, at) => { alive.set(++serial, at); return serial; }, release: (id) => releases.push(id) };
  return { h, alive, releases };
}
describe('staged spawner accounting (U-131)', () => {
  it('counts dormant members toward the living cap, fixes their size and initializes once', () => {
    const h = host(); const sp = new Spawner(encounter, world, h.h, undefined, { waveSize: () => 1, aliveCap: () => 3, waveDue: () => false }, true);
    sp.initialize(); sp.initialize(); expect(sp.spawnedBy('reserve')).toHaveLength(2);
    expect([...h.alive.values()].every((e) => e.inactive)).toBe(true); expect(sp.fired('reserve')).toBe(false);
    sp.activate('later', 0); sp.step(0); expect(h.alive.size).toBe(3); expect(sp.pending).toBe(1);
    h.alive.delete(sp.spawnedBy('reserve')[0]!); sp.step(1); expect(sp.pending).toBe(0);
    expect(sp.activate('reserve', 2)).toBe(true); expect(h.releases).toEqual([sp.spawnedBy('reserve')[1]!]);
    expect(sp.activate('reserve', 3)).toBe(false); expect(sp.spawnedBy('reserve')).toHaveLength(2);
  });
  it('recognises total pre-release destruction and consumes release without spawning replacements', () => {
    const h = host(); const sp = new Spawner(encounter, world, h.h); sp.initialize(); h.alive.clear();
    expect(sp.dead('reserve')).toBe(true); expect(sp.broken('reserve')).toBe(true);
    expect(sp.activate('reserve', 5)).toBe(true); sp.step(20); expect(h.alive.size).toBe(0); expect(h.releases).toHaveLength(0);
    expect(sp.wavesOf('reserve')).toEqual([0]); expect(sp.log).toHaveLength(2);
  });
  it('does not place a restored legacy queue during pre-input initialization', () => {
    const h = host(); const sp = new Spawner(encounter, world, h.h); sp.initialize(); sp.activate('later', 0);
    const saved = sp.checkpoint(); const next = host(); const resumed = new Spawner(encounter, world, next.h);
    resumed.restore(saved, new Map()); resumed.initialize(); expect(next.alive.size).toBe(0); expect(resumed.pending).toBe(2);
    resumed.step(1); expect(next.alive.size).toBe(2);
  });
  it('refuses initial placement held by occupancy or the host hard cap instead of allowing later pop-in', () => {
    const occupied = host(); occupied.h.enemyFeet = () => [{ x: 10, y: 0, z: 10 }];
    expect(() => new Spawner(encounter, world, occupied.h).initialize()).toThrow(/before input/);
    const capped = host(); capped.h.spawn = () => null;
    expect(() => new Spawner(encounter, world, capped.h).initialize()).toThrow(/before input/);
  });
});
