import { describe, expect, it } from 'vitest';
import { loadLevel, loadWorld, requireWorld } from './world.ts';

describe('map content revisions (U-135)', () => {
  const world = { id: 'revision-test', cover: [] };
  const level = { id: 'revision-test', format: 1, boxes: [], pieces: [] };

  it('defaults existing world/level data to 1, independently of level format', () => {
    expect(loadWorld(world).mapRevision).toBe(1);
    expect(loadLevel(level).mapRevision).toBe(1);
    expect(requireWorld('qalat-road').mapRevision).toBe(1);
  });

  it('retains the authored revision through level expansion and world loading', () => {
    expect(loadWorld({ ...world, mapRevision: 2 }).mapRevision).toBe(2);
    expect(loadLevel({ ...level, mapRevision: 2 }).mapRevision).toBe(2);
    expect(loadLevel({ ...level, mapRevision: Number.MAX_SAFE_INTEGER }).mapRevision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, false])('refuses invalid revision %s in both content formats', (mapRevision) => {
    expect(() => loadWorld({ ...world, mapRevision })).toThrow(/mapRevision.*positive safe integer/);
    expect(() => loadLevel({ ...level, mapRevision })).toThrow(/mapRevision.*positive safe integer/);
  });

  it('keeps strict level unknown-key validation', () => {
    expect(() => loadLevel({ ...level, mapRevison: 2 })).toThrow(/unknown key 'mapRevison'/);
  });
});
