/** Exact exposed faces of the generated box union. Internal rock strata must
 * not spend software-WebGL fill rate drawing thousands of invisible walls.
 */
import { boxFrom, type BoxSpec } from '@sandline/shared';
type Rect = { loU: number; hiU: number; loV: number; hiV: number };
const EPS = 1e-7;
function subtract(a: Rect, b: Rect): Rect[] {
  const loU = Math.max(a.loU, b.loU), hiU = Math.min(a.hiU, b.hiU);
  const loV = Math.max(a.loV, b.loV), hiV = Math.min(a.hiV, b.hiV);
  if (hiU - loU <= EPS || hiV - loV <= EPS) return [a];
  const out: Rect[] = [];
  if (loU - a.loU > EPS) out.push({ ...a, hiU: loU });
  if (a.hiU - hiU > EPS) out.push({ ...a, loU: hiU });
  if (loV - a.loV > EPS) out.push({ loU, hiU, loV: a.loV, hiV: loV });
  if (a.hiV - hiV > EPS) out.push({ loU, hiU, loV: hiV, hiV: a.hiV });
  return out;
}

// Plan grid of candidate neighbours. A box can hide part of another's face
// only if their bounds touch, so each box is tested against the boxes sharing
// a cell with it, in index order, which keeps the output identical.
const CELL_M = 4;
function neighbours(boxes: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[]) {
  const cell = (n: number) => Math.floor(n / CELL_M);
  const grid = new Map<string, number[]>();
  const cells = (b: typeof boxes[number]) => {
    const keys: string[] = [];
    for (let x = cell(b.minX - EPS); x <= cell(b.maxX + EPS); x++) for (let z = cell(b.minZ - EPS); z <= cell(b.maxZ + EPS); z++) keys.push(`${x},${z}`);
    return keys;
  };
  boxes.forEach((b, i) => { for (const k of cells(b)) { const list = grid.get(k); if (list) list.push(i); else grid.set(k, [i]); } });
  return (i: number) => [...new Set(cells(boxes[i]!).flatMap((k) => grid.get(k)!))].sort((a, b) => a - b);
}

/** Walking floors are sand, rock is grey-green; U-160's temporary caps read
 * blue-grey so a reviewer can tell them from permanent rock. */
function colourOf(id: string): number[] {
  if (id === 'insertion-foundation' || id.startsWith('road-support-')) return [.51, .45, .35];
  if (id === 'hollow-overhang') return [.24, .26, .21];
  if (id.startsWith('road-cap-')) return [.36, .42, .5];
  return [.32, .34, .27];
}

export function insertionSurface(specs: readonly BoxSpec[]) {
  const boxes = specs.map((b) => boxFrom(b, 'cover'));
  const lo = boxes.map((b) => [b.minX, b.minY, b.minZ]);
  const hi = boxes.map((b) => [b.maxX, b.maxY, b.maxZ]);
  const near = neighbours(boxes);
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], indices: number[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const candidates = near(i);
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const plane = sign < 0 ? lo[i]![axis]! : hi[i]![axis]!;
      let faces: Rect[] = [{ loU: lo[i]![u]!, hiU: hi[i]![u]!, loV: lo[i]![v]!, hiV: hi[i]![v]! }];
      for (const j of candidates) {
        if (!faces.length) break;
        if (i === j) continue;
        const ownsCoplanar = j < i && Math.abs((sign < 0 ? lo[j]![axis]! : hi[j]![axis]!) - plane) < EPS;
        if (!ownsCoplanar && (lo[j]![axis]! > plane + sign * EPS || hi[j]![axis]! < plane + sign * EPS)) continue;
        if (hi[j]![u]! <= lo[i]![u]! + EPS || lo[j]![u]! >= hi[i]![u]! - EPS ||
            hi[j]![v]! <= lo[i]![v]! + EPS || lo[j]![v]! >= hi[i]![v]! - EPS) continue;
        const cover = { loU: lo[j]![u]!, hiU: hi[j]![u]!, loV: lo[j]![v]!, hiV: hi[j]![v]! };
        faces = faces.flatMap((f) => subtract(f, cover));
      }
      for (const f of faces) {
        const start = positions.length / 3;
        const colour = colourOf(boxes[i]!.id);
        for (const [a, b] of [[f.loU, f.loV], [f.hiU, f.loV], [f.hiU, f.hiV], [f.loU, f.hiV]]) {
          const p = [0, 0, 0], n = [0, 0, 0];
          p[axis] = plane; p[u] = a!; p[v] = b!; n[axis] = sign;
          // Weld arithmetic roundoff before Float32 upload; far smaller than
          // the construction's 0.05 m skin tolerance.
          positions.push(...p.map((value) => Math.round(value * 100000) / 100000)); normals.push(...n); colours.push(...colour);
        }
        indices.push(...(sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((n) => n + start));
      }
    }
  }
  return { positions, normals, colours, indices };
}
