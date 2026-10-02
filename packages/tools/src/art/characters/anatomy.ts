/** Deterministic anatomical/cloth surfaces shared by the procedural characters.
 * Landmarks are in metres and stay on the existing 17-bone bind skeleton.
 * Shape detail is geometry; no sculpting, downloaded meshes or baked images. */
import { HUMANOID_BONES, type HumanoidBoneName } from '../../../../client/src/character/humanoidRig.ts';
import { JOINTS } from '../../../../client/src/character/humanoidSoldier.ts';
import { clothDisplacement, type Garment } from './garments.ts';
import { SkinBuilder, type Region, type Ring, type Vec3 } from './skin.ts';

const index = (name: HumanoidBoneName): number => HUMANOID_BONES.indexOf(name);
const weight = (a: HumanoidBoneName, b: HumanoidBoneName, t: number): Ring['bones'] => [[index(a), 1 - t], [index(b), t]];
const one = (a: HumanoidBoneName): Ring['bones'] => [[index(a), 1]];
const bell = (x: number, centre: number, width: number): number => Math.exp(-(((x - centre) / width) ** 2));

/** Eye sockets recede behind a projecting brow; nose bridge/tip, cheekbones,
 * lips and chin are independently shaped rather than painted onto an egg. */
export function anatomicalHead(beard = false): Ring[] {
  const sections = [
    [1.85, .018, .02, .02], [1.825, .069, .073, .08], [1.79, .086, .092, .10],
    [1.74, .09, .097, .104], [1.705, .087, .089, .10], [1.69, .089, .087, .096],
    [1.676, .086, .079, .093], [1.66, .091, .081, .091], [1.645, .088, .077, .086],
    [1.633, .082, .079, .083], [1.62, .078, .077, .079], [1.608, .076, .076, .073],
    [1.595, .078, .079, .069], [1.578, .066, .079, .061], [1.565, .052, .06, .055],
    [1.548, .05, .047, .052], [1.53, .05, .047, .051],
  ];
  return sections.map(([y, rx, rzF, rzB]) => ({
    y: y!, rx: rx!, rzF: rzF!, rzB: rzB!, bones: y! > 1.565 ? one('head') : weight('head', 'neck', .45),
    surface: (t: number, p: Vec3): Vec3 => {
      const front = bell(t, .5, .19);
      const nose = bell(t, .5, .027) * (.028 * bell(y!, 1.65, .025) + .012 * bell(y!, 1.68, .03));
      const sockets = (bell(t, .445, .023) + bell(t, .555, .023)) * .010 * bell(y!, 1.674, .012);
      const brow = (bell(t, .444, .036) + bell(t, .556, .036)) * .011 * bell(y!, 1.692, .009);
      const cheek = (bell(t, .405, .04) + bell(t, .595, .04)) * .008 * bell(y!, 1.653, .017);
      const mouth = .003 * bell(t, .5, .055) * bell(y!, 1.607, .009);
      const ear = (bell(t, .25, .022) + bell(t, .75, .022)) * .012 * bell(y!, 1.665, .028);
      return [p[0] + Math.sign(p[0]) * (ear - .005 * bell(y!, 1.71, .026) * bell(t % .5, .17, .08)), p[1], p[2] + front * (nose - sockets + brow + cheek + mouth + (beard ? .008 * bell(y!, 1.59, .03) : 0))];
    },
  }));
}

/** Rounded deltoid connects diagonally from under the collar into the sleeve.
 * No broad horizontal end-cap at the shoulder; the first cap is hidden in the
 * neck/chest. The axis then returns to the arm bone before the elbow. */
export function anatomicalSleeve(s: 1 | -1, loose = 1): Ring[] {
  const side = s > 0 ? 'left' : 'right';
  const upper = `upper-arm-${side}` as const;
  const lower = `lower-arm-${side}` as const;
  const cx = JOINTS[upper][0];
  const sections = [
    [1.515, s * .10, .02, .035], [1.505, s * .13, .03, .049],
    [1.49, s * .153, .044, .062], [1.475, s * .171, .055, .072],
    [1.455, s * .184, .069, .078], [1.435, s * .193, .077, .082],
    [1.405, cx, .079, .082], [1.355, cx, .073, .077],
    [1.30, cx, .069, .073], [1.255, cx, .065, .069],
    [1.215, cx, .065, .068], [1.18, cx, .061, .064],
    [1.15, cx, .065, .068], [1.12, cx, .063, .066],
    [1.085, cx, .061, .064], [1.045, cx, .059, .062],
    [1.01, cx, .057, .058], [.975, cx, .055, .057], [.95, cx, .048, .05],
  ];
  return refineCloth(sections.map(([y, x, rx, rz]) => ({
    y: y!, cx: x!, rx: rx! * loose, rzF: rz! * loose,
    bones: y! > 1.40 ? weight('chest', upper, Math.min(.95, (1.515 - y!) / .11)) : y! > 1.22 ? one(upper) : y! < 1.10 ? one(lower) : weight(upper, lower, Math.min(1, (1.22 - y!) / .12)),
    surface: (t: number, p: Vec3): Vec3 => {
      const fold = clothDisplacement('sleeve', t, y!, s);
      const a = Math.PI + t * Math.PI * 2;
      return [p[0] + fold * Math.sin(a), p[1] - (y! > 1.44 ? .01 * Math.abs(Math.sin(a)) : 0), p[2] + fold * Math.cos(a)];
    },
  })), .022, 'sleeve', s);
}

/** Waist envelope narrows at the belt and expands over the iliac crest.
 * Its lower sides blend to the corresponding thigh before the fork. */
function anatomicalPelvis(): Ring[] {
  const sections = [
    [.985, .16, .114, .119], [.955, .176, .123, .131],
    [.915, .19, .128, .143], [.875, .193, .119, .14],
  ];
  return sections.map(([y, rx, f, back], i) => ({
    y: y!, rx: rx!, rzF: f!, rzB: back!, bones: one('hips'),
    ...(i > 1 ? { skinAt: (t: number) => {
      const a = Math.sin(Math.PI + t * Math.PI * 2);
      return weight('hips', a > 0 ? 'upper-leg-left' : 'upper-leg-right', (i - 1) * .15 * Math.abs(a));
    } } : {}),
  }));
}

/** Baggy trousers swell at thigh and calf and gather above the boot. */
export function anatomicalTrousers(s: 1 | -1): Ring[] {
  const side = s > 0 ? 'left' : 'right';
  const upper = `upper-leg-${side}` as const;
  const lower = `lower-leg-${side}` as const;
  const cx = JOINTS[upper][0];
  const sections = [
    [.92, .095, .115, .124], [.875, .103, .12, .127], [.83, .108, .124, .126],
    [.78, .108, .122, .12], [.73, .094, .117, .115], [.68, .092, .11, .109],
    [.63, .09, .105, .105], [.59, .088, .1, .097], [.55, .083, .096, .087],
    [.515, .079, .099, .079], [.48, .077, .095, .079], [.445, .08, .091, .087],
    [.41, .083, .087, .096], [.365, .083, .084, .102], [.32, .08, .08, .098],
    [.28, .079, .083, .087], [.25, .076, .088, .083], [.23, .079, .084, .083],
    [.21, .066, .072, .074],
  ];
  return refineCloth(sections.map(([y, rx, f, back]) => ({
    y: y!, cx, rx: rx!, rzF: f!, rzB: back!,
    bones: y! > .85 ? weight('hips', upper, .65) : y! > .56 ? one(upper) : y! < .41 ? one(lower) : weight(upper, lower, (.56 - y!) / .15),
    surface: (t: number, p: Vec3): Vec3 => {
      const a = Math.PI + t * Math.PI * 2;
      const d = clothDisplacement('trousers', t, y!, s);
      const x = p[0] + d * Math.sin(a);
      // Inner seam keeps separation between legs even under outward folds.
      return [s * Math.max(.014, s * x), p[1] + .002 * Math.sin(t * 12 + s), p[2] + d * Math.cos(a)];
    },
  })), .021, 'trousers', s);
}

/** A single closed trouser shell forks at the groin into both thighs. Waist
 * halves attach to the outside thigh semicircles; inner semicircles bridge
 * through a raised inseam. There is no separate pelvis slab or dangling cap. */
export function buildTrouserFork(b: SkinBuilder, region: Region): void {
  const sides = 24;
  const cols = sides + 1;
  const waist = anatomicalPelvis();
  const waistStart = b.out.positions.length / 3;
  b.loft(waist, { sides, region, heightRange: [.985, .21] });
  const rim = waistStart + (waist.length - 1) * cols;
  const legs: number[] = [];
  for (const s of [-1, 1] as const) {
    const upper = s > 0 ? 'upper-leg-left' : 'upper-leg-right';
    const rings = anatomicalTrousers(s).filter((r) => r.y < .85);
    rings.unshift({
      y: .852, cx: s * .11, rx: .11, rzF: .12, rzB: .126,
      bones: weight('hips', upper, .65),
      surface: (t, p) => {
        const inward = Math.max(0, -s * Math.sin(Math.PI + t * Math.PI * 2));
        return [p[0], p[1] - .012 * inward ** 2, p[2]];
      },
    });
    legs.push(b.out.positions.length / 3);
    const middle = (region.u0 + region.u1) / 2;
    const legRegion = s < 0 ? { ...region, u1: middle } : { ...region, u0: middle };
    b.loft(rings, { sides, region: legRegion, heightRange: [.985, .21] });
  }
  const [right, left] = legs as [number, number];
  const triangles: number[] = [];
  const quad = (a: number, c: number, d: number, e: number): void => { triangles.push(a, c, d, a, d, e); };
  // Winding follows the torso's top-to-bottom outer surface.
  for (let i = 0; i < sides / 2; i++) {
    quad(rim + i, right + i, right + i + 1, rim + i + 1);
    quad(rim + 12 + i, left + 12 + i, left + 13 + i, rim + 13 + i);
  }
  // Front and back crotch gussets link the two branches into one shell.
  triangles.push(rim + 12, right + 12, left + 12);
  triangles.push(rim, left, right);
  for (let i = 0; i < 12; i++) quad(right + 12 + i, right + 13 + i, left + 11 - i, left + 12 - i);
  b.stitch(triangles);
}

/** Sampling dense enough to model the narrow creases rather than only paint them. */
function refineCloth(rings: Ring[], spacing: number, kind: Garment, side: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!, b = rings[i + 1]!;
    const count = Math.ceil((a.y - b.y) / spacing);
    for (let j = 0; j < count; j++) {
      const k = j / count;
      const lerp = (v: number, w: number): number => v + (w - v) * k;
      out.push({ ...a, y: lerp(a.y, b.y), cx: lerp(a.cx ?? 0, b.cx ?? 0),
        rx: lerp(a.rx, b.rx), rzF: lerp(a.rzF, b.rzF), rzB: lerp(a.rzB ?? a.rzF, b.rzB ?? b.rzF),
        surface: (t, p) => {
          // Sample the analytic field at the new section height, rather than
          // interpolating creases away between the old coarse sections.
          const d = clothDisplacement(kind, t, p[1], side);
          const a = Math.PI + t * Math.PI * 2;
          const x = p[0] + Math.sin(a) * d;
          const y = kind === 'sleeve' ? p[1] - (p[1] > 1.44 ? .01 * Math.abs(Math.sin(a)) : 0)
            : p[1] + .002 * Math.sin(t * 12 + side);
          return [kind === 'trousers' ? side * Math.max(.014, side * x) : x, y, p[2] + Math.cos(a) * d];
        },
      });
    }
  }
  out.push(rings[rings.length - 1]!);
  return out;
}
