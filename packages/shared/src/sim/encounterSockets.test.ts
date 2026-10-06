import { describe, expect, it } from 'vitest';
import { loadWorld, requireWorld } from './world.ts';
import { parseEncounter } from './encounters.ts';

const world = loadWorld({ id: 'socket-validation', floor: { halfExtent: 60 }, cover: [
  { id: 'slab', x: 0, y: 5.5, z: 0, w: 80, d: 80, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 80, d: 80, h: 2 },
], mission: { ...requireWorld('greybox-01').mission!, spawnZones: [{ id: 'z', on: 'objective', x: 50, z: 0, radius: 1 }] } });
const socket = (id: string, x: number, y: number) => ({ id, archetype: 'rifleman', feet: { x, y, z: 0 }, face: { x, z: -10 } });
const raw = () => ({ world: world.id, aliveCap: 32, probes: [1], areas: {}, groups: [{
  id: 'guards', zone: 'z', members: [{ archetype: 'rifleman', count: 3 }], posture: { kind: 'hold' }, trigger: { kind: 'start' },
  sockets: [socket('G0', 0, 0), socket('G8', 0, 8), socket('G16', 0, 16)],
}] });
const parse = (r: unknown) => parseEncounter(r, () => world);
describe('authored enemy sockets (U-129)', () => {
  it('keeps exact floor-separated feet, names and facing; fixes counts', () => {
    const g = parse(raw()).groups[0]!;
    expect(g.sockets).toEqual(raw().groups[0]!.sockets);
    expect(g.fixedCount).toBe(true);
  });
  it.each([2, 5.6, 15])('rejects unsupported/interior y=%s instead of snapping to another floor', (y) => {
    const r = raw(); r.groups[0]!.sockets[0]!.feet.y = y;
    expect(() => parse(r)).toThrow(/support|clearance/);
  });
  it('rejects duplicate IDs across groups, overlapping feet and malformed data', () => {
    const r = raw(); r.groups.push({ ...r.groups[0]!, id: 'other' });
    expect(() => parse(r)).toThrow(/unique member/);
    const overlap = raw(); overlap.groups[0]!.sockets[1]!.feet.y = 0;
    expect(() => parse(overlap)).toThrow(/overlaps/);
    const bad = raw(); Object.assign(bad.groups[0]!.sockets[0]!, { typo: true });
    expect(() => parse(bad)).toThrow(/unknown key/);
    const invalid = raw(); invalid.groups[0]!.sockets[0]!.feet.x = NaN;
    expect(() => parse(invalid)).toThrow(/number/);
  });
  it('requires exact ordered archetype/count correspondence and no repeat waves', () => {
    const r = raw(); r.groups[0]!.sockets.pop(); expect(() => parse(r)).toThrow(/one socket/);
    const mismatch = raw(); mismatch.groups[0]!.sockets[0]!.archetype = 'mg'; expect(() => parse(mismatch)).toThrow(/member order/);
    const wave = raw(); Object.assign(wave.groups[0]!, { waves: { count: 2, everySeconds: 1, minSeconds: 1, maxSeconds: 1 } }); expect(() => parse(wave)).toThrow(/one wave/);
    const budget = raw(); Object.assign(budget.groups[0]!, { fixedCount: false }); expect(() => parse(budget)).toThrow(/fixed counts/);
    const cap = raw(); cap.aliveCap = 2; expect(() => parse(cap)).toThrow(/exceed aliveCap/);
  });
  it('requires standing clearance and floor/wire limits', () => {
    const low = loadWorld({ id: 'low-socket', floor: { halfExtent: 60 }, cover: [{ id: 'ceiling', x: 0, y: 1, z: 0, w: 4, d: 4, h: 1 }], mission: world.mission });
    const r = raw(); r.world = low.id; r.groups[0]!.members[0]!.count = 1; r.groups[0]!.sockets = [socket('LOW', 0, 0)];
    expect(() => parseEncounter(r, () => low)).toThrow(/clearance/);
    const outside = raw(); outside.groups[0]!.sockets[0]!.feet.x = 70; expect(() => parse(outside)).toThrow(/outside floor/);
  });
});
