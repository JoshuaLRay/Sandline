import { describe, expect, it } from 'vitest';
import { boxFrom, DEFAULT_MOVE_CONFIG } from '@sandline/shared';
import { spawnGround } from './spawnGround.ts';

const boxes = [boxFrom({ id: 'ceiling', x: 0, y: 5.5, z: 0, w: 20, d: 20, h: 2.5 }, 'cover')];
const point = { x: 0, y: 0, z: 0 };
const nearest = (p: typeof point) => ({ point: { ...p, y: p.y + .1 } });

describe('spawn projection across stacked floors (U-108)', () => {
  it('keeps an explicit basement below the roof, with or without navigation', () => {
    expect(spawnGround(point, 0, boxes, DEFAULT_MOVE_CONFIG, nearest)?.y).toBeCloseTo(.1);
    expect(spawnGround(point, 0, boxes, DEFAULT_MOVE_CONFIG)?.y).toBe(0);
    expect(spawnGround(point, 8, boxes, DEFAULT_MOVE_CONFIG, nearest)?.y).toBeCloseTo(8.1);
  });
  it('rejects unsupported, off-mesh and wrong-storey projections instead of falling back', () => {
    expect(spawnGround(point, 4, boxes, DEFAULT_MOVE_CONFIG, nearest)).toBeNull();
    expect(spawnGround(point, 0, boxes, DEFAULT_MOVE_CONFIG, () => ({ point: { ...point, y: 8 } }))).toBeNull();
    expect(spawnGround(point, 0, boxes, DEFAULT_MOVE_CONFIG, () => ({ point: { ...point, x: 2 } }))).toBeNull();
    expect(spawnGround(point, 0, boxes, DEFAULT_MOVE_CONFIG, () => null)).toBeNull();
  });
  it('preserves old highest-surface selection and the no-nav legacy fallback', () => {
    expect(spawnGround(point, undefined, boxes, DEFAULT_MOVE_CONFIG, nearest)?.y).toBeCloseTo(8.1);
    expect(spawnGround(point, undefined, boxes, DEFAULT_MOVE_CONFIG)).toEqual(point);
  });
});
