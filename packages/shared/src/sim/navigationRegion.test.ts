import { describe, expect, it } from 'vitest';
import { parseNavigationRegion, regionContains, regionContainsSegment } from './navigationRegion.ts';
import { loadWorld, requireWorld } from './world.ts';
import { parseEncounter } from './encounters.ts';
const box = (minX: number, maxX: number) => ({ minX, maxX, minY: -.3, maxY: .3, minZ: -5, maxZ: 5 });
describe('navigation region geometry (U-130)', () => {
  it('keeps identical x/z on different floors separate', () => {
    expect(regionContains([box(-5, 5)], { x: 0, y: 0, z: 0 })).toBe(true);
    expect(regionContains([box(-5, 5)], { x: 0, y: 8, z: 0 })).toBe(false);
  });
  it('checks entire segments, including holes much smaller than a sampling interval', () => {
    const a = { x: -4, y: 0, z: 0 }, b = { x: 4, y: 0, z: 0 };
    expect(regionContainsSegment([box(-5, 0), box(0, 5)], a, b)).toBe(true);
    expect(regionContainsSegment([box(-5, .001), box(.002, 5)], a, b)).toBe(false);
    expect(regionContainsSegment([box(-5, 5)], a, { ...b, y: 8 })).toBe(false);
  });
  it('validates bounded finite prisms and rejects unknown/missing/reversed fields', () => {
    expect(parseNavigationRegion('region', [box(-5, 5)])).toEqual([box(-5, 5)]);
    for (const raw of [[], [box(5, -5)], [{ ...box(-5, 5), typo: true }], [{ ...box(-5, 5), maxY: NaN }], [{ ...box(-5, 5), maxX: 600 }], [{ minX: 0 }]]) expect(() => parseNavigationRegion('region', raw)).toThrow(/region/);
  });
});
const world = loadWorld({ id: 'patrol-schema', floor: { halfExtent: 30 }, cover: [{ id: 'slab', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 }], mission: requireWorld('greybox-01').mission });
const raw = () => ({ world: world.id, aliveCap: 2, probes: [1], areas: {}, regions: { basement: [box(-5, 5)] }, groups: [{ id: 'g', zone: 'behind-objective', members: [{ archetype: 'rifleman', count: 2 }], posture: { kind: 'hold' }, trigger: { kind: 'start' }, sockets: [
  { id: 'patroller', archetype: 'rifleman', feet: { x: 0, y: 0, z: 0 }, face: { x: 0, z: -4 }, combatRegion: 'basement', patrol: { route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }] } },
  { id: 'holder', archetype: 'rifleman', feet: { x: 4, y: 0, z: 0 }, face: { x: 0, z: -4 }, combatRegion: 'basement' },
] }] });
const parse = (r: unknown) => parseEncounter(r, () => world);
describe('per-member patrol/region authoring (U-130)', () => {
  it('gives only the assigned member a 3D patrol with a default three-second pause', () => {
    const e = parse(raw());
    expect(e.groups[0]!.sockets![0]!.patrol!.pauseSeconds).toBe(3);
    expect(e.groups[0]!.sockets![1]!.patrol).toBeUndefined();
    const named = raw();
    Object.defineProperty(named.regions, '__proto__', { value: named.regions.basement, enumerable: true });
    named.groups[0]!.sockets[0]!.combatRegion = '__proto__';
    const parsed = parse(JSON.parse(JSON.stringify(named)));
    expect(Object.hasOwn(parsed.regions!, '__proto__')).toBe(true);
    expect(parsed.groups[0]!.sockets![0]!.combatRegion).toBe('__proto__');
  });
  it('rejects unknown regions and feet/patrols on the wrong floor or outside their region', () => {
    const r = raw(); r.groups[0]!.sockets[0]!.combatRegion = 'roof'; expect(() => parse(r)).toThrow(/named navigation region/);
    const wrong = raw(); wrong.groups[0]!.sockets[0]!.patrol!.route[1]!.y = 8; expect(() => parse(wrong)).toThrow(/outside combat region/);
    const outside = raw(); outside.groups[0]!.sockets[0]!.feet.x = 7; expect(() => parse(outside)).toThrow(/outside combat region/);
  });
  it('requires initial phase at the socket, finite supported points and bounded routes', () => {
    const r = raw(); r.groups[0]!.sockets[0]!.patrol!.route[0]!.z = 1; expect(() => parse(r)).toThrow(/first point/);
    const unsupported = raw(); unsupported.groups[0]!.sockets[0]!.patrol!.route[1]!.y = 4; expect(() => parse(unsupported)).toThrow(/unsupported/);
    const short = raw(); short.groups[0]!.sockets[0]!.patrol!.route.pop(); expect(() => parse(short)).toThrow(/2–64/);
    const bad = raw(); Object.assign(bad.groups[0]!.sockets[0]!.patrol!, { pauseSeconds: Infinity }); expect(() => parse(bad)).toThrow(/number/);
  });
});
