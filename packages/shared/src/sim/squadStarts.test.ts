import { describe, expect, it } from 'vitest';
import { loadWorld, loadLevel } from './world.ts';

const starts = [-10, -6].flatMap((z) =>
  [-6, -2, 2].map((x) => ({ x, y: 8, z })),
);
const deck = { id: 'deck', x: 0, y: 5.5, z: 0, w: 40, h: 2.5, d: 40 };
const raw = () => ({
  id: 'start-fixture',
  floor: { halfExtent: 40 },
  cover: [deck],
  squadStarts: structuredClone(starts),
});

describe('authored squad starts (U-110)', () => {
  it('keeps all six 3D feet in slot order through world and level loading', () => {
    expect(loadWorld(raw()).squadStarts).toEqual(starts);
    const { cover, ...rest } = raw();
    expect(
      loadLevel({ ...rest, format: 1, boxes: cover, pieces: [] }).squadStarts,
    ).toEqual(starts);
    expect(loadWorld({ id: 'legacy', cover: [] }).squadStarts).toBeUndefined();
  });

  it('requires six finite supported placements with standing clearance', () => {
    expect(() =>
      loadWorld({ ...raw(), squadStarts: starts.slice(0, 5) }),
    ).toThrow(/six/);
    for (const point of [
      { x: NaN },
      { y: Infinity },
      { z: 1000 },
      { y: 4 },
      { y: 9 },
    ]) {
      const data = raw();
      Object.assign(data.squadStarts[0]!, point);
      expect(() => loadWorld(data)).toThrow(/squadStarts\[0\]/);
    }
    expect(() =>
      loadWorld({
        ...raw(),
        cover: [
          deck,
          { id: 'ceiling', x: 0, y: 9.5, z: -10, w: 20, h: 1, d: 2 },
        ],
      }),
    ).toThrow(/clearance/);
    expect(() =>
      loadWorld({ ...raw(), squadStarts: starts.map(() => starts[0]) }),
    ).toThrow(/overlaps/);
    expect(() =>
      loadWorld({
        ...raw(),
        squadStarts: starts.map((s, i) => (i ? s : { ...s, typo: 8 })),
      }),
    ).toThrow(/unknown key/);
  });

  it('supports the named lower storey beneath an upper floor and refuses an unsupported ledge', () => {
    expect(
      loadWorld({
        ...raw(),
        squadStarts: starts.map((p) => ({ ...p, y: 0 })),
      }).squadStarts?.every((p) => p.y === 0),
    ).toBe(true);
    const data = raw();
    data.squadStarts[0]!.x = 19.9;
    expect(() => loadWorld(data)).toThrow(/support/);
  });
});
