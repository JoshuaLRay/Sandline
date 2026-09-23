/**
 * Group tactics (T-3.21): the group's blackboard, pin detection, roles and the
 * flank route, over fixture members and the range's committed cover and mesh.
 * The whole manoeuvre is measured by `pinned` (tools/src/scenarios); these pin
 * its pieces.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTargetMemory, requireWorld, rememberSeen } from '@sandline/shared';
import { CoverSystem } from './cover.ts';
import { EnemyGroup, GROUP, type GroupMember, parseGroupConfig, pricedLength, seesConcealed, seesGround } from './group.ts';
import RAW_GROUP from './group.json' with { type: 'json' };
import { type NavMesh, initNav, pathLength } from './nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from './nav/bakedNav.ts';

const range = requireWorld('range');
/** The low wall's south face, middle: where the scenario's soldier lies. */
const TARGET = { x: -9, y: 0, z: -1.6 };

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A member that knows the target at `TARGET`, seen or not. */
function member(netId: number, at: { x: number; z: number }, visible: boolean, now: number): GroupMember {
  const memory = createTargetMemory();
  rememberSeen(memory, 1, TARGET, now, false);
  memory.entries.get(1)!.visible = visible;
  return { netId, state: { x: at.x, y: 0, z: at.z }, alive: true, memory, target: 1 };
}

describe('group tuning (T-3.21)', () => {
  it('parses the committed data and refuses bad rows', () => {
    expect(parseGroupConfig(RAW_GROUP)).toEqual(GROUP);
    expect(() => parseGroupConfig({ ...RAW_GROUP, luck: 1 })).toThrow(/luck/);
    expect(() => parseGroupConfig({ ...RAW_GROUP, flankExposureCost: 0.5 })).toThrow(/flankExposureCost/);
    expect(() => parseGroupConfig({ ...RAW_GROUP, flankMaxM: 2 })).toThrow(/flankMaxM/);
  });
});

describe('sight of the concealed side (T-3.21)', () => {
  it('is seen round the end of the low wall, not over its top from in front', () => {
    // Crate C's west face, off to the east and level with the soldier: round the end.
    expect(seesConcealed({ x: 5.95, y: 0, z: -2.75 }, TARGET, range.boxes)).toBe(true);
    // Straight north of the wall, 5 m back: the wall is in the way of the low body.
    expect(seesConcealed({ x: -9, y: 0, z: 4.6 }, TARGET, range.boxes)).toBe(false);
  });

  it('prices only the ground the target can see', () => {
    // Behind the west walls is out of its sight; the open lane is in it.
    expect(seesGround(TARGET, { x: -9.5, y: 0, z: 7 }, range.boxes)).toBe(false);
    expect(seesGround(TARGET, { x: 0, y: 0, z: 2 }, range.boxes)).toBe(true);
    // In west wall A's shadow — clear of the doorway's line, which it sees straight through.
    const behind = [{ x: -13, y: 0, z: 7 }, { x: -10.5, y: 0, z: 7 }];
    const open = [{ x: -3, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }];
    expect(pricedLength(behind, TARGET, range.boxes, 8)).toBeCloseTo(2.5, 1);
    expect(seesGround(TARGET, { x: -8.4, y: 0, z: 7 }, range.boxes)).toBe(true); // the doorway's line
    expect(pricedLength(open, TARGET, range.boxes, 8)).toBeCloseTo(48, 1);
  });
});

describe('pinning and roles (T-3.21)', () => {
  it('pins a target once no member has seen it for pinSeconds, and hands out a suppressor and a flanker', () => {
    const cover = new CoverSystem(bakedCoverFor('range'), range.boxes);
    const group = new EnemyGroup(1);
    const world = { cover, boxes: range.boxes, mesh };
    const a = { x: -7.5, z: 12 };
    const b = { x: -3, z: 12 };
    group.think([member(10, a, true, 0), member(11, b, false, 0)], world, 0);
    expect(group.target).toBe(1);
    expect(group.concealedSince).toBeNull();
    expect(group.roles.size).toBe(0);
    // Out of sight from here on.
    group.think([member(10, a, false, 0.1), member(11, b, false, 0.1)], world, 0.1);
    expect(group.pinned(0.1 + GROUP.pinSeconds - 0.01)).toBe(false);
    const t = 0.1 + GROUP.pinSeconds;
    group.think([member(10, a, false, t), member(11, b, false, t)], world, t);
    expect(group.pinned(t)).toBe(true);
    expect(new Set(group.roles.values())).toEqual(new Set(['suppressor', 'flanker']));
    const flank = group.flank!;
    expect(flank).not.toBeNull();
    expect(cover.holder(cover.points.indexOf(flank.point))).toBe(flank.netId);
    expect(seesConcealed(flank.point, TARGET, range.boxes)).toBe(true);
    // Aim just over the wall at where it lay.
    expect(group.suppressPoint()).toEqual({ x: TARGET.x, y: TARGET.y + GROUP.suppressAimUpM, z: TARGET.z });
    // Its peeking does not reshuffle them.
    group.think([member(10, a, true, t + 0.1), member(11, b, false, t + 0.1)], world, t + 0.1);
    expect(group.roles.size).toBe(2);
  });

  it('hands out nothing with one member, and ends the flank when the flanker dies', () => {
    const cover = new CoverSystem(bakedCoverFor('range'), range.boxes);
    const world = { cover, boxes: range.boxes, mesh };
    const alone = new EnemyGroup(2);
    alone.think([member(20, { x: -7.5, z: 12 }, false, 0)], world, 0);
    alone.think([member(20, { x: -7.5, z: 12 }, false, 5)], world, 5);
    expect(alone.roles.size).toBe(0);

    const group = new EnemyGroup(3);
    const members = [member(30, { x: -7.5, z: 12 }, false, 0), member(31, { x: -3, z: 12 }, false, 0)];
    group.think(members, world, 0);
    group.think(members, world, 5);
    const flanker = group.flank!.netId;
    group.think(members.map((m) => (m.netId === flanker ? { ...m, alive: false } : m)), world, 5.1);
    expect(group.flank).toBeNull();
    expect(cover.heldPoint(flanker)).toBeNull();
    expect(group.roles.size).toBe(0);
  });

  it('routes the flank out of the target’s sight where it can: less seen than the direct way', () => {
    const cover = new CoverSystem(bakedCoverFor('range'), range.boxes);
    const group = new EnemyGroup(4);
    const world = { cover, boxes: range.boxes, mesh };
    // From behind the west walls, where the direct way runs out through the doorway.
    const members = [member(40, { x: -13.6, z: 5.5 }, false, 0), member(41, { x: -9.6, z: 12 }, false, 0)];
    group.think(members, world, 0);
    group.think(members, world, 5);
    const flank = group.flank!;
    const from = members.find((m) => m.netId === flank.netId)!.state;
    const direct = mesh.path(from, flank.point)!.points;
    const seen = (pts: readonly { x: number; y: number; z: number }[]) => pricedLength(pts, TARGET, range.boxes, 2) - pathLength(pts);
    console.log(`flank route: ${pathLength([from, ...flank.route]).toFixed(1)} m, seen ${seen([from, ...flank.route]).toFixed(1)} m; direct ${pathLength(direct).toFixed(1)} m, seen ${seen(direct).toFixed(1)} m`);
    expect(seen([from, ...flank.route])).toBeLessThan(seen(direct));
  });
});

describe('the avoiding path on the mesh (T-3.21)', () => {
  it('goes round penalised ground, and leaves the mesh as it found it', () => {
    const a = { x: 0, y: 0, z: 20 };
    const b = { x: 0, y: 0, z: -10 };
    const before = pathLength(mesh.path(a, b)!.points);
    const band = (p: { centre: { x: number; z: number } }) => Math.abs(p.centre.x) < 6 && p.centre.z > -5 && p.centre.z < 15;
    const round = mesh.pathAvoiding(a, b, band, 10)!;
    expect(pathLength(round.points)).toBeGreaterThan(before + 5);
    expect(round.points.some((p) => Math.abs(p.x) >= 6)).toBe(true);
    // Nothing penalised: the same path as ever.
    expect(pathLength(mesh.pathAvoiding(a, b, () => false, 10)!.points)).toBeCloseTo(before, 6);
    expect(pathLength(mesh.path(a, b)!.points)).toBeCloseTo(before, 6);
  });

  it('lists every ground polygon with its corners', () => {
    const polys = mesh.polygons();
    expect(polys.length).toBeGreaterThan(100);
    for (const p of polys) expect(p.corners.length).toBeGreaterThanOrEqual(3);
  });
});

