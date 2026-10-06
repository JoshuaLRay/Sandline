import { describe, expect, it } from 'vitest';
import { loadWorld, requireWorld } from './world.ts';
import { parseEncounter } from './encounters.ts';

const world = loadWorld({ id: 'staged-schema', floor: { halfExtent: 40 }, cover: [
  { id: 'road', x: 0, y: 5, z: 0, w: 60, d: 60, h: 3 },
], mission: { ...requireWorld('greybox-01').mission!, spawnZones: [{ id: 'z', on: 'objective', x: -35, z: 0, radius: .1 }] } });
const raw = () => ({ world: world.id, aliveCap: 2, probes: [1], areas: {}, groups: [{
  id: 'tank', zone: 'z', members: [{ archetype: 'tank', count: 1 }], staged: true,
  posture: { kind: 'hold' }, trigger: { kind: 'script' },
  sockets: [{ id: 'T', archetype: 'tank', feet: { x: 0, y: 8, z: 0 }, face: { x: 0, z: 10 } }],
  path: [{ x: 0, y: 8, z: 10 }],
}] });
const parse = (r: unknown) => parseEncounter(r, () => world);
describe('staged encounter contract (U-131)', () => {
  it('validates an exact elevated tank and its path from the socket, independent of the legacy zone', () => {
    expect(parse(raw()).groups[0]).toMatchObject({ staged: true, fixedCount: true, sockets: raw().groups[0]!.sockets });
  });
  it('rejects staging without fixed sockets, repeat waves and malformed state', () => {
    const noSocket = raw(); Reflect.deleteProperty(noSocket.groups[0]!, 'sockets');
    expect(() => parse(noSocket)).toThrow(/fixed sockets/);
    const scaled = raw(); Object.assign(scaled.groups[0]!, { fixedCount: false }); expect(() => parse(scaled)).toThrow(/fixed sockets/);
    const repeated = raw(); Object.assign(repeated.groups[0]!, { waves: { count: 2, everySeconds: 1, minSeconds: 1, maxSeconds: 1 } }); expect(() => parse(repeated)).toThrow(/one wave/);
    const bad = raw(); Object.assign(bad.groups[0]!, { staged: 'true' }); expect(() => parse(bad)).toThrow(/boolean/);
  });
  it('rejects unsupported tank feet, hull obstruction and a path starting on the wrong storey', () => {
    const unsupported = raw(); unsupported.groups[0]!.sockets[0]!.feet.y = 9;
    expect(() => parse(unsupported)).toThrow(/vehicle support/);
    const edge = raw(); edge.groups[0]!.sockets[0]!.feet.x = 29;
    expect(() => parse(edge)).toThrow(/vehicle support/);
    const wrongPath = raw(); wrongPath.groups[0]!.path[0]!.y = 0;
    expect(() => parse(wrongPath)).toThrow(/vehicle support/);
    const blocked = loadWorld({ id: world.id, floor: { halfExtent: 40 }, mission: world.mission,
      cover: [{ id: 'road', x: 0, y: 5, z: 0, w: 60, d: 60, h: 3 }, { id: 'wall', x: 0, y: 8, z: 2, w: 4, d: 1, h: 5 }] });
    expect(() => parseEncounter(raw(), () => blocked)).toThrow(/vehicle support/);
  });
  it('refuses a soldier inside the tank footprint and includes both in the fixed cap', () => {
    const r = raw(); r.groups.push({ ...r.groups[0]!, id: 'other', path: [], members: [{ archetype: 'rifleman', count: 1 }], sockets: [{ id: 'R', archetype: 'rifleman', feet: { x: 0, y: 8, z: 1 }, face: { x: 0, z: 10 } }] });
    expect(() => parse(r)).toThrow(/overlaps/);
    const count = raw(); count.groups[0]!.members[0]!.count = 2; count.groups[0]!.sockets.push({ ...count.groups[0]!.sockets[0]!, id: 'T2', feet: { x: 10, y: 8, z: 0 } }); count.aliveCap = 1;
    expect(() => parse(count)).toThrow(/exceed aliveCap/);
  });
  it('validates one-way infantry orders and rejects ambiguous patrols or unstaged advance', () => {
    const g = { id: 'r', zone: 'z', staged: true, members: [{ archetype: 'rifleman', count: 1 }], posture: { kind: 'hold' }, trigger: { kind: 'script' },
      sockets: [{ id: 'R', archetype: 'rifleman', feet: { x: 0, y: 8, z: 0 }, face: { x: 0, z: 10 }, advance: [{ x: 0, y: 8, z: 0 }, { x: 0, y: 8, z: 5 }] }] };
    expect(parse({ ...raw(), groups: [g] }).groups[0]!.sockets![0]!.advance).toEqual(g.sockets[0]!.advance);
    expect(() => parse({ ...raw(), groups: [{ ...g, staged: false }] })).toThrow(/requires a staged/);
    Object.assign(g.sockets[0]!, { patrol: { route: g.sockets[0]!.advance, pauseSeconds: 3 } });
    expect(() => parse({ ...raw(), groups: [g] })).toThrow(/without patrol/);
  });
});
