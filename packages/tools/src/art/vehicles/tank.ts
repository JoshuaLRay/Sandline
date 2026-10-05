/**
 * U-126: the enemy's tank, modelled (ADR-018). A generic ex-Soviet medium tank of the period (ADR-020). It has:
 *   - a cast dome turret with a long gun under a canvas dust cover;
 *   - five big road wheels a side, an idler at the front and a sprocket at the back;
 *   - a track of separate links that sags onto the wheels, with no return rollers;
 *   - fenders carrying fuel tanks and stowage;
 *   - an engine deck of louvres and an unditching log across the back.
 * It carries no markings. It replaces U-070's boxes (`client/src/character/tankModel.ts`), which stay as the fallback.
 *
 * SIZED FROM THE DATA. The hull fills the box round the archetype's hull capsule (`enemies.json` → `tank.vehicle`):
 * its width, its front and its back. The turret turns about the turret capsule's axis and fits inside its radius.
 * The gun lies at the cannon muzzle's height. A change to that block rebuilds the tank, and `vehicles.test.ts`
 * fails until the committed copy is regenerated.
 *
 * WHAT IS NOT DATA. The gun is drawn past the data's muzzle, so it overhangs the nose as a real one does. The page
 * draws the flash at the drawn tip (`gunTip`); the server's shell still starts at the data's muzzle.
 *
 * Two meshes: the hull, with the running gear, and the turret, with the gun. The turret is built about its pivot
 * on the roof, so the page turns it with one rotation.
 */
import type { EnemyDef } from '@sandline/shared';
import { type BuiltMesh, PAINT, type P2, type V3, VehicleBuilder, mirrorX } from './mesh.ts';

/** The hull roof, where the turret sits. */
const ROOF = 1.6;
/** How far the drawn gun reaches past the hull's nose. */
const GUN_OVERHANG = 1.45;
const TRACK_WIDTH = 0.5;
const TRACK_THICK = 0.07;
const WHEEL_R = 0.36;
const WHEEL_Y = TRACK_THICK + WHEEL_R;
const IDLER = { y: 0.56, r: 0.25 };
const SPROCKET = { y: 0.56, r: 0.27, tip: 0.31, root: 0.245, teeth: 13 };
/** The length of a track link. */
const LINK = 0.16;

export interface TankDims {
  /** Half the hull capsule's width: the track's outer edge and the fenders reach it. */
  halfWidth: number;
  /** The hull capsule's front and back, z. */
  front: number;
  rear: number;
  /** The turret's pivot on the roof, in the tank's frame. */
  pivot: V3;
  turretRadius: number;
  /** The gun's height above the feet. */
  gunY: number;
  /** The turret capsule's top. */
  top: number;
}

export function tankDims(def: EnemyDef): TankDims {
  const v = def.vehicle;
  if (!v) throw new Error(`'${def.id}' is not a vehicle`);
  return {
    halfWidth: v.hull.radius,
    front: Math.max(v.hull.from[2], v.hull.to[2]) + v.hull.radius,
    rear: Math.min(v.hull.from[2], v.hull.to[2]) - v.hull.radius,
    pivot: [v.turret.from[0], ROOF, v.turret.from[2]],
    turretRadius: v.turret.radius,
    gunY: v.cannon.muzzle[1],
    top: Math.max(v.turret.from[1], v.turret.to[1]) + v.turret.radius,
  };
}

export interface TankMeshes {
  /** The hull and running gear, in the tank's frame (origin at its feet). */
  hull: BuiltMesh;
  /** The turret and gun, about the pivot. */
  turret: BuiltMesh;
  pivot: V3;
  /** The drawn muzzle, metres ahead of the pivot. */
  gunTip: number;
  /** The dome's base radius: its footprint on the roof, where the painter puts cast steel, not deck. */
  domeRadius: number;
  /** The gun's z from the pivot where it leaves the turret: everything ahead of it is gun, not turret. */
  gunRoot: number;
}

interface Circle {
  z: number;
  y: number;
  r: number;
}

/**
 * The line touching two circles with both on one side of it, as the angle of its normal from either centre (the
 * same for both): pointing up for a line over the circles when `over`, else down for one under them.
 */
function outerTangent(c1: Circle, c2: Circle, over: boolean): number {
  const phi = Math.atan2(c2.y - c1.y, c2.z - c1.z);
  const alpha = Math.acos((c1.r - c2.r) / Math.hypot(c2.z - c1.z, c2.y - c1.y));
  const [a, b] = [phi + alpha, phi - alpha];
  return over === Math.sin(a) > Math.sin(b) ? a : b;
}

/**
 * The track's centre line, a closed loop in (z, y), counter-clockwise seen from the tank's left: back over the wheel
 * tops (`wheels` run front to back), round the sprocket, forward under the wheels and round the idler. Where it
 * only rests on a wheel, the loop touches it without wrapping; between wheels it sags a little.
 */
function trackLoop(idler: Circle, wheels: readonly Circle[], sprocket: Circle): P2[] {
  const visits = [{ c: idler, over: true }, ...wheels.map((c) => ({ c, over: true })), { c: sprocket, over: false }, ...[...wheels].reverse().map((c) => ({ c, over: false }))];
  const n = visits.length;
  // Segment k runs from visit k to k + 1, over the circles on the top run and under them on the bottom.
  const theta = visits.map((v, k) => outerTangent(v.c, visits[(k + 1) % n]!.c, v.over));
  const on = (c: Circle, ang: number): P2 => [c.z + Math.cos(ang) * c.r, c.y + Math.sin(ang) * c.r];
  const out: P2[] = [];
  for (let k = 0; k < n; k++) {
    const { c, over } = visits[k]!;
    const from = theta[(k + n - 1) % n]!;
    let sweep = (((theta[k]! - from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // A small clockwise turn is the track bending up off a wheel it only rests on: no wrap.
    if (sweep > Math.PI * 1.5) sweep = 0;
    const steps = Math.max(1, Math.ceil(sweep / 0.2));
    for (let s = 0; s <= steps; s++) out.push(on(c, from + (sweep * s) / steps));
    const next = visits[(k + 1) % n]!;
    if (over && next.over && wheels.includes(c) && wheels.includes(next.c)) {
      const [a, b] = [on(c, theta[k]!), on(next.c, theta[k]!)];
      out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.025]);
    }
  }
  return out;
}

/** A closed polyline resampled into `n` equal steps. */
function resample(loop: readonly P2[], n: number): P2[] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < loop.length; i++) {
    const [a, b] = [loop[i]!, loop[(i + 1) % loop.length]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(l);
    total += l;
  }
  const out: P2[] = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total;
    while (walked + seg[i]! < want) walked += seg[i++]!;
    const t = (want - walked) / (seg[i]! || 1);
    const [a, b] = [loop[i]!, loop[(i + 1) % loop.length]!];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function loopLength(loop: readonly P2[]): number {
  let total = 0;
  for (let i = 0; i < loop.length; i++) {
    const [a, b] = [loop[i]!, loop[(i + 1) % loop.length]!];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/** The left side's running gear: road wheels, idler, sprocket and track, centred on the track at x = `tx`. */
function runningGear(b: VehicleBuilder, d: TankDims, tx: number): void {
  const idlerZ = d.front - 0.38;
  const sprocketZ = d.rear + 0.42;
  const first = idlerZ - 0.66;
  const last = sprocketZ + 0.78;
  const wheelZs = [0, 1, 2, 3, 4].map((k) => first + ((last - first) * k) / 4);

  // Road wheels: a rubber tyre, a pressed dish and a hub, profiled from the inside face out.
  wheelZs.forEach((z, k) => {
    b.lathe(
      [
        [-0.2, 0.3],
        [-0.2, WHEEL_R],
        [0.2, WHEEL_R],
        [0.2, 0.3],
        [0.17, 0.2],
        [0.205, 0.095],
        [0.245, 0.055],
        [0.25, 0],
      ],
      'x',
      [tx, WHEEL_Y, z],
      { sides: 14, surface: (j) => (j < 2 ? 'tyre' : 'wheel'), map: 'disc', discRadius: WHEEL_R, phase: k * 0.71 },
    );
  });
  // The idler: a plain steel wheel the track turns round at the front.
  b.lathe(
    [
      [-0.17, 0.2],
      [-0.17, IDLER.r],
      [0.17, IDLER.r],
      [0.17, 0.2],
      [0.15, 0.12],
      [0.19, 0.06],
      [0.21, 0],
    ],
    'x',
    [tx, IDLER.y, idlerZ],
    { sides: 12, surface: (j) => (j < 2 ? 'steel' : 'sprocket'), map: 'disc', discRadius: IDLER.r },
  );
  // The sprocket: two toothed rings on a drum. The teeth reach into the track and drive it.
  const star: P2[] = [];
  for (let i = 0; i < SPROCKET.teeth * 2; i++) {
    const a = (i / (SPROCKET.teeth * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? SPROCKET.tip : SPROCKET.root;
    star.push([sprocketZ + Math.cos(a) * r, SPROCKET.y + Math.sin(a) * r]);
  }
  for (const x of [tx - 0.12, tx + 0.12]) b.prism(star, 'x', x - 0.035, x + 0.035, 'steel', 'sprocket');
  b.lathe(
    [
      [-0.17, 0.2],
      [0.21, 0.2],
      [0.23, 0.12],
      [0.25, 0],
    ],
    'x',
    [tx, SPROCKET.y, sprocketZ],
    { sides: 10, surface: 'sprocket', map: 'disc', discRadius: SPROCKET.tip },
  );

  // The track: links laid round the loop, each a flat plate with its grouser on the outside.
  const half = TRACK_THICK / 2;
  const loop = trackLoop(
    { z: idlerZ, y: IDLER.y, r: IDLER.r + half },
    wheelZs.map((z) => ({ z, y: WHEEL_Y, r: WHEEL_R + half })),
    { z: sprocketZ, y: SPROCKET.y, r: SPROCKET.r + half },
  );
  const n = Math.round(loopLength(loop) / LINK);
  const pts = resample(loop, n);
  const [x0, x1] = [tx - TRACK_WIDTH / 2, tx + TRACK_WIDTH / 2];
  for (let k = 0; k < n; k++) {
    const [a, c] = [pts[k]!, pts[(k + 1) % n]!];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    // Outward from a counter-clockwise loop: the direction turned a quarter clockwise.
    const nz = (c[1] - a[1]) / l;
    const ny = -(c[0] - a[0]) / l;
    const at = (p: P2, off: number, x: number): V3 => [x, p[1] + ny * off, p[0] + nz * off];
    const out: V3 = [0, ny, nz];
    const inward: V3 = [0, -ny, -nz];
    b.quad([at(a, half, x0), at(c, half, x0), at(c, half, x1), at(a, half, x1)], out, 'track', [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    b.quad([at(a, -half, x0), at(c, -half, x0), at(c, -half, x1), at(a, -half, x1)], inward, 'trackInner');
    for (const [x, nx] of [
      [x0, -1],
      [x1, 1],
    ] as const) {
      b.quad([at(a, -half, x), at(c, -half, x), at(c, half, x), at(a, half, x)], [nx, 0, 0], 'trackInner', [
        [0, 0],
        [1, 0],
        [1, 0.15],
        [0, 0.15],
      ]);
    }
  }
}

function buildHull(d: TankDims): BuiltMesh {
  const b = new VehicleBuilder();
  const trackOut = d.halfWidth - 0.02;
  const tx = trackOut - TRACK_WIDTH / 2;
  const trackIn = tx - TRACK_WIDTH / 2;
  const lower = trackIn - 0.03;
  const upper = trackIn + 0.17;
  const nose = d.front - 0.04;
  const tail = d.rear + 0.18;
  const glacisTop = nose - 1.08;
  /** Height of the upper glacis at z. */
  const glacisY = (z: number) => 1.0 + (nose - z) * ((ROOF - 1.0) / (nose - glacisTop));

  // The lower hull between the tracks, its belly raised, a short lower glacis.
  b.prism(
    [
      [tail + 0.17, 0.44],
      [nose - 0.58, 0.44],
      [nose, 0.96],
      [tail, 0.96],
    ],
    'x',
    -lower,
    lower,
    PAINT,
  );
  // The upper hull over the tracks: a long, shallow upper glacis, the flat roof, the sloped engine deck's end.
  b.prism(
    [
      [tail, 0.95],
      [nose, 0.95],
      [nose, 1.0],
      [glacisTop, ROOF],
      [tail + 0.44, ROOF],
      [tail, 1.12],
    ],
    'x',
    -upper,
    upper,
    PAINT,
  );

  // Each side: running gear, the fender over it (stepping down at the front), a headlamp, a tow cable.
  for (const side of [1, -1]) {
    b.push(side > 0 ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] : mirrorX, () => {
      runningGear(b, d, tx);
      b.prism(
        [
          [tail - 0.04, 0.95],
          [nose - 0.44, 0.95],
          [nose, 0.86],
          [nose, 0.83],
          [nose - 0.44, 0.92],
          [tail - 0.04, 0.92],
        ],
        'x',
        upper,
        d.halfWidth,
        PAINT,
      );
      // The headlamp on the glacis's edge, in a short housing, on a bracket.
      const lz = nose - 0.34;
      const ly = glacisY(lz) + 0.08;
      b.box([upper - 0.2, glacisY(lz) - 0.02, lz - 0.04], [upper - 0.14, ly - 0.04, lz + 0.02], PAINT);
      b.lathe(
        [
          [-0.1, 0.055],
          [0.04, 0.07],
          [0.06, 0.066],
        ],
        'z',
        [upper - 0.17, ly, lz],
        { sides: 10, surface: PAINT, caps: false },
      );
      b.lathe(
        [
          [0.059, 0.066],
          [0.062, 0],
        ],
        'z',
        [upper - 0.17, ly, lz],
        { sides: 10, surface: 'lens', map: 'disc', discRadius: 0.066 },
      );
      // A tow cable along the hull side.
      b.lathe(
        [
          [-1.9, 0.022],
          [1.3, 0.022],
        ],
        'z',
        [upper + 0.022, 1.3, 0],
        { sides: 6, surface: 'cable', caps: true },
      );
      // Tow hooks at the front and back.
      b.box([0.5, 0.74, nose - 0.24], [0.6, 0.84, nose - 0.1], 'steel');
      b.box([0.5, 0.62, tail - 0.06], [0.6, 0.72, tail + 0.02], 'steel');
    });
  }

  // The right fender's fuel tanks and a stowage box.
  for (const [z0, z1] of [
    [-2.05, -1.35],
    [-1.25, -0.55],
    [-0.45, 0.25],
  ] as const) {
    b.chamferBox([-(d.halfWidth - 0.03), 0.98, z0], [-(upper + 0.04), 1.28, z1], 'z', 0.06, PAINT);
  }
  b.chamferBox([-(d.halfWidth - 0.03), 0.98, 0.4], [-(upper + 0.04), 1.2, 1.2], 'z', 0.02, PAINT);
  // The left fender: tool and stowage boxes, and the engine's exhaust outlet at the back.
  for (const [z0, z1, h] of [
    [-1.75, -1.05, 1.18],
    [-0.55, 0.35, 1.22],
    [0.55, 1.2, 1.12],
  ] as const) {
    b.chamferBox([upper + 0.04, 0.98, z0], [d.halfWidth - 0.03, h, z1], 'z', 0.02, PAINT);
  }
  b.box([upper + 0.02, 0.98, tail + 0.27], [upper + 0.25, 1.12, tail + 0.72], PAINT);
  b.quad(
    [
      [upper + 0.251, 1.0, tail + 0.3],
      [upper + 0.251, 1.0, tail + 0.69],
      [upper + 0.251, 1.1, tail + 0.69],
      [upper + 0.251, 1.1, tail + 0.3],
    ],
    [1, 0, 0],
    'bore',
  );

  // The driver's hatch, front left, and his two periscopes ahead of it.
  b.lathe(
    [
      [0, 0.22],
      [0.04, 0.22],
      [0.055, 0.19],
      [0.06, 0],
    ],
    'y',
    [0.52, ROOF, glacisTop - 0.38],
    { sides: 12, surface: PAINT },
  );
  for (const x of [0.36, 0.56]) b.box([x, ROOF - 0.01, glacisTop - 0.14], [x + 0.12, ROOF + 0.06, glacisTop - 0.06], PAINT);

  // Spare track links on the glacis, on the right.
  const slope: V3 = [0, ROOF - 1.0, glacisTop - nose];
  const sl = Math.hypot(slope[1], slope[2]);
  const s: V3 = [0, slope[1] / sl, slope[2] / sl];
  const up: V3 = [0, -s[2], s[1]];
  for (const t of [0.32, 0.5, 0.68]) {
    const centre: V3 = [-0.42, 1.0 + s[1] * t + up[1] * 0.02, nose + s[2] * t + up[2] * 0.02];
    b.orientedBox(centre, s, up, [1, 0, 0], [0.075, 0.018, 0.24], 'steel', 'track');
  }

  // The engine deck: two louvred panels behind the turret.
  for (const x of [-0.465, 0.465]) b.orientedBox([x, ROOF + 0.0125, -1.625], [0, 0, 1], [0, 1, 0], [1, 0, 0], [0.575, 0.0125, 0.385], PAINT, 'grille');

  // The unditching log, strapped across the back.
  const logZ = tail + 0.17;
  const logY = 1.12 + ((logZ - tail) / 0.44) * (ROOF - 1.12) + 0.1;
  b.lathe(
    [
      [-upper, 0.11],
      [upper, 0.11],
    ],
    'x',
    [0, logY, logZ],
    { sides: 10, surface: 'wood', caps: true },
  );
  for (const x of [-0.6, 0.6]) b.box([x - 0.03, logY - 0.14, logZ - 0.12], [x + 0.03, logY + 0.12, logZ + 0.12], 'steel');

  return b.build();
}

/** The cast dome's profile: (height, radius) as fractions of its height and base radius. Low and wide, a frying pan. */
const DOME: readonly P2[] = [
  [0.0, 1.0],
  [0.12, 1.01],
  [0.3, 0.98],
  [0.5, 0.9],
  [0.68, 0.76],
  [0.82, 0.58],
  [0.92, 0.38],
  [0.98, 0.18],
  [1.0, 0.0],
];
const DOME_HEIGHT = 0.82;
const domeRadius = (d: TankDims): number => d.turretRadius * 0.89;

function buildTurret(d: TankDims, gunTip: number, gunRoot: number): BuiltMesh {
  const b = new VehicleBuilder(d.pivot);
  const r0 = domeRadius(d);
  const gy = d.gunY - ROOF;
  /** The dome's height at a distance from its axis (ignoring its bulge toward the gun): where a fitting sits. */
  const domeY = (rho: number): number => {
    const k = rho / r0;
    for (let j = 0; j < DOME.length - 1; j++) {
      const [[y0, a], [y1, c]] = [DOME[j]!, DOME[j + 1]!];
      if (k <= a && k >= c) return DOME_HEIGHT * (y0 + ((a - k) / (a - c || 1)) * (y1 - y0));
    }
    return 0;
  };

  // The cast dome, swelling a little toward the gun. Painted from above as one piece, so no seam crosses it.
  b.onSheet('top', () =>
    b.lathe(
      DOME.map(([y, k]) => [y * DOME_HEIGHT, k * r0] as P2),
      'y',
      [0, 0, 0],
      { sides: 22, surface: PAINT, smoothProfile: true, plan: (a) => 1 + 0.09 * Math.max(0, Math.cos(a)) ** 2 },
    ),
  );

  // The gun: a canvas dust cover where it leaves the turret (its top stands proud of the dome, so it is closed),
  // a long tube, the fume extractor near the muzzle.
  b.lathe(
    [
      [0.5, 0.22],
      [0.7, 0.215],
      [0.86, 0.19],
      [0.97, 0.15],
      [gunRoot, 0.122],
    ],
    'z',
    [0, gy, 0],
    { sides: 12, surface: 'canvas', caps: true },
  );
  const L = gunTip;
  b.lathe(
    [
      [1.0, 0.105],
      [1.3, 0.1],
      [L - 0.95, 0.086],
      [L - 0.93, 0.128],
      [L - 0.55, 0.128],
      [L - 0.5, 0.086],
      [L - 0.06, 0.08],
      [L - 0.06, 0.094],
      [L, 0.094],
      [L, 0.06],
    ],
    'z',
    [0, gy, 0],
    { sides: 12, surface: 'barrel' },
  );
  b.lathe(
    [
      [L - 0.003, 0.06],
      [L - 0.002, 0],
    ],
    'z',
    [0, gy, 0],
    { sides: 12, surface: 'bore', map: 'disc', discRadius: 0.06 },
  );
  // The coaxial machine gun's barrel, beside the gun.
  b.lathe(
    [
      [0.5, 0.035],
      [0.76, 0.03],
      [0.76, 0.012],
    ],
    'z',
    [-0.24, gy - 0.03, 0],
    { sides: 8, surface: 'steel' },
  );

  // The searchlight over the gun's right, on a bracket from the dome.
  const lightY = gy + 0.2;
  b.box([-0.48, domeY(0.6) - 0.03, 0.38], [-0.4, lightY - 0.08, 0.5], PAINT);
  b.lathe(
    [
      [0.26, 0],
      [0.28, 0.1],
      [0.34, 0.12],
      [0.58, 0.12],
      [0.6, 0.11],
    ],
    'z',
    [-0.44, lightY, 0],
    { sides: 12, surface: PAINT },
  );
  b.lathe(
    [
      [0.601, 0.11],
      [0.602, 0],
    ],
    'z',
    [-0.44, lightY, 0],
    { sides: 12, surface: 'lens', map: 'disc', discRadius: 0.11 },
  );

  // The commander's cupola, left; the loader's hatch, right; each seated on the dome where it stands.
  const cupola: V3 = [0.34, domeY(Math.hypot(0.34, 0.16)) - 0.03, -0.16];
  b.lathe(
    [
      [0, 0.25],
      [0.17, 0.25],
      [0.19, 0.235],
      [0.24, 0.17],
      [0.27, 0],
    ],
    'y',
    cupola,
    { sides: 14, surface: PAINT },
  );
  const hatch: V3 = [-0.34, domeY(Math.hypot(0.34, 0.22)) - 0.02, -0.22];
  b.lathe(
    [
      [0, 0.25],
      [0.06, 0.25],
      [0.08, 0.22],
      [0.095, 0],
    ],
    'y',
    hatch,
    { sides: 14, surface: PAINT },
  );

  // The heavy machine gun on the loader's hatch: a pintle, the receiver, its barrel and an ammunition box.
  const mg = hatch[1] + 0.27;
  b.box([-0.37, hatch[1] + 0.08, -0.1], [-0.31, mg - 0.04, -0.04], 'steel');
  b.box([-0.39, mg - 0.05, -0.3], [-0.29, mg + 0.05, 0.1], 'steel');
  b.box([-0.37, mg - 0.03, -0.38], [-0.31, mg + 0.03, -0.3], 'steel');
  b.lathe(
    [
      [0.1, 0.026],
      [0.62, 0.022],
      [0.62, 0.036],
      [0.72, 0.036],
      [0.72, 0.012],
    ],
    'z',
    [-0.34, mg, 0],
    { sides: 8, surface: 'steel' },
  );
  b.box([-0.5, mg - 0.11, -0.18], [-0.4, mg + 0.01, 0.02], 'olive');

  // At the back: the snorkel tube in its brackets, and a rolled tarpaulin.
  const snorkelY = DOME_HEIGHT * 0.4;
  b.lathe(
    [
      [-0.5, 0.075],
      [0.5, 0.075],
    ],
    'x',
    [0, snorkelY, -0.82],
    { sides: 10, surface: PAINT, caps: true },
  );
  for (const x of [-0.3, 0.3]) b.box([x - 0.03, snorkelY - 0.08, -0.82], [x + 0.03, snorkelY, -0.7], PAINT);
  const tarpY = DOME_HEIGHT * 0.66;
  b.lathe(
    [
      [-0.2, 0.09],
      [0.25, 0.09],
    ],
    'x',
    [0.25, tarpY, -(r0 * 0.78 + 0.05)],
    { sides: 8, surface: 'tarp', caps: true },
  );

  return b.build();
}

export function buildTank(def: EnemyDef): TankMeshes {
  const d = tankDims(def);
  const gunTip = d.front + GUN_OVERHANG - d.pivot[2];
  const gunRoot = 1.04;
  return { hull: buildHull(d), turret: buildTurret(d, gunTip, gunRoot), pivot: d.pivot, gunTip, gunRoot, domeRadius: domeRadius(d) };
}
