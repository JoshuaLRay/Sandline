import { describe, expect, it } from 'vitest';
import GREYBOX_01 from '../data/levels/greybox-01.json' with { type: 'json' };
import { encounterFor } from './encounters.ts';
import { LevelDataError, expandLevel, pieceBoxes, turn } from './level.ts';
import { WORLD_IDS, loadLevel, loadWorld, requireWorld } from './world.ts';

const WALL = 'wall-plaster-4m';
const level = (extra: Record<string, unknown> = {}) => ({ id: 'yard', format: 1, boxes: [], pieces: [], ...extra });
const wallAt = (rot: unknown, x = 0, z = 0) => level({ pieces: [{ id: 'w', piece: WALL, x, z, rot }] });

describe('level format v1 (T-4.09)', () => {
  it('greybox-01 as a level of free boxes is the world it was: every box, the floor and the mission', () => {
    const raw = GREYBOX_01 as unknown as Record<string, unknown>;
    const asWorldFile = { id: raw['id'], floor: raw['floor'], cover: raw['boxes'], mission: raw['mission'] };
    const fromLevel = requireWorld('greybox-01');
    const fromWorld = loadWorld(asWorldFile);
    expect({ ...fromLevel, encounter: null }).toEqual(fromWorld);
    expect(fromLevel.boxes.length).toBe(28);
    expect(fromLevel.pieces).toEqual([]);
    expect(fromLevel.encounter).toBe('greybox-01');
  });

  it('names an encounter that exists, for every committed level', () => {
    for (const id of WORLD_IDS) {
      const world = requireWorld(id);
      if (world.encounter !== null) expect(encounterFor(world.encounter), `level '${id}'`).toBeDefined();
    }
  });

  it('turns quarter turns exactly: +Z to +X at 90°', () => {
    expect(turn(0, 1, 90)).toEqual([1, -0]);
    expect(turn(1, 0, 90)).toEqual([0, -1]);
    expect(turn(1, 2, 180)).toEqual([-1, -2]);
    expect(turn(1, 2, 270)).toEqual([-2, 1]);
  });

  it('places a piece’s collision boxes with it, turned with it', () => {
    const at0 = loadLevel(wallAt(0, 10, 20)).boxes;
    expect(at0.map((b) => [b.id, b.piece, b.minX, b.maxX, b.minZ, b.maxZ, b.minY, b.maxY])).toEqual([
      ['w/0', 'w', 8, 12, 19.82, 20.18, 0, 0.3],
      ['w/1', 'w', 8, 12, 19.85, 20.15, 0.3, 2.9],
      ['w/2', 'w', 8, 12, 19.81, 20.19, 2.9, 3],
    ]);
    const at90 = loadLevel(wallAt(90, 10, 20)).boxes;
    // The 4 m run now lies along z, the 0.36 m plinth across x.
    expect(at90[0]).toMatchObject({ minX: 9.82, maxX: 10.18, minZ: 18, maxZ: 22, minY: 0, maxY: 0.3 });
    expect(at90.map((b) => b.maxZ - b.minZ)).toEqual([4, 4, 4]);
    const at180 = loadLevel(wallAt(180)).boxes;
    const at270 = loadLevel(wallAt(270)).boxes;
    // The wall is symmetric, so a half turn is the same boxes; three quarters the same as one.
    expect(at180.map((b) => [b.minX, b.maxX, b.minZ, b.maxZ])).toEqual(loadLevel(wallAt(0)).boxes.map((b) => [b.minX, b.maxX, b.minZ, b.maxZ]));
    expect(at270.map((b) => [b.minX, b.maxX, b.minZ, b.maxZ])).toEqual(loadLevel(wallAt(90)).boxes.map((b) => [b.minX, b.maxX, b.minZ, b.maxZ]));
  });

  it('turns an off-centre box round the piece’s origin, not its own centre', () => {
    const manifest = {
      version: 1 as const,
      assets: [{ id: 'bench', class: 'prop', source: 'assets/src/bench.glb', file: 'assets/bench.glb', inputHash: 'a'.repeat(64), hash: 'a'.repeat(64), bytes: 1, triangles: 12, bones: 0, materials: 1, textures: [], lods: 1, collision: [{ min: [1, 0, 0] as [number, number, number], max: [2, 1, 3] as [number, number, number] }] }],
    };
    const [box] = pieceBoxes({ id: 'b', piece: 'bench', x: 0, y: 0, z: 0, rot: 90 }, manifest);
    // x 1..2, z 0..3 turned +Z→+X: x' = z → 0..3, z' = −x → −2..−1.
    expect(box).toMatchObject({ x: 1.5, z: -1.5, w: 3, d: 1 });
  });

  it('puts free boxes first and the pieces’ after, so a level with no pieces is its free boxes in order', () => {
    const world = loadLevel(level({ boxes: [{ id: 'crate', x: 0, y: 0, z: 5, w: 1, h: 1, d: 1 }], pieces: [{ id: 'w', piece: WALL, x: 0, z: 0 }] }));
    expect(world.boxes.map((b) => b.id)).toEqual(['crate', 'w/0', 'w/1', 'w/2']);
    expect(world.boxes[0]!.piece).toBeUndefined();
    expect(world.pieces).toEqual([{ id: 'w', piece: WALL, x: 0, y: 0, z: 0, rot: 0 }]);
  });

  it('refuses a turn that is not a quarter turn — collision stays axis-aligned', () => {
    for (const rot of [45, 30, 91, -90, 360, '90']) expect(() => loadLevel(wallAt(rot)), String(rot)).toThrow(/not a quarter turn/);
  });

  it('refuses what a level cannot place, by name', () => {
    expect(() => loadLevel(level({ pieces: [{ id: 'w', piece: 'tank', x: 0, z: 0 }] }))).toThrow(/no asset 'tank'/);
    expect(() => loadLevel(level({ pieces: [{ id: 'w', piece: 'soldier', x: 0, z: 0 }] }))).toThrow(/is a character/);
    expect(() => loadLevel(level({ pieces: [{ id: 'w', piece: WALL, x: 0, z: 0 }, { id: 'w', piece: WALL, x: 5, z: 0 }] }))).toThrow(/used twice/);
    expect(() => loadLevel(level({ pieces: [{ id: 'w', piece: WALL, x: 0, z: 0, scale: 2 }] }))).toThrow(/unknown key 'scale'/);
    expect(() => loadLevel(level({ pieces: [{ id: 'w', piece: WALL, x: Number.NaN, z: 0 }] }))).toThrow(/finite/);
    expect(() => loadLevel({ ...level(), format: 2 })).toThrow(/format 2 is not 1/);
    expect(() => loadLevel({ ...level(), cover: [] })).toThrow(/unknown key 'cover'/);
    expect(() => loadLevel({ ...level(), encounter: 7 })).toThrow(LevelDataError);
    // And a free box is refused as a world's would be.
    expect(() => loadLevel(level({ boxes: [{ id: 'x', x: 0, y: 0, z: 0, w: 0, h: 1, d: 1 }] }))).toThrow(/non-positive size/);
  });

  it('refuses a piece whose boxes collide with a free box by id', () => {
    expect(() => loadLevel(level({ boxes: [{ id: 'w/0', x: 0, y: 0, z: 9, w: 1, h: 1, d: 1 }], pieces: [{ id: 'w', piece: WALL, x: 0, z: 0 }] }))).toThrow(/duplicate id 'w\/0'/);
  });

  it('expands to a world file loadWorld reads, with nothing lost', () => {
    const e = expandLevel(wallAt(90, 3, 4));
    expect(e.cover).toHaveLength(3);
    expect(e.pieces[0]).toMatchObject({ rot: 90, x: 3, z: 4 });
    expect(e.encounter).toBeNull();
  });
});
