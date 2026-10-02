/** Fitted uniform and armour, with curved edges and cloth-backed panels. */
import {
  HUMANOID_BONES,
  type HumanoidBoneName,
} from "../../../../client/src/character/humanoidRig.ts";
import { clothDisplacement } from "./garments.ts";
import { region } from "./soldierAtlas.ts";
import { SkinBuilder, type Ring } from "./skin.ts";
const only = (n: HumanoidBoneName): Ring["bones"] => [
  [HUMANOID_BONES.indexOf(n), 1],
];
const blend = (
  a: HumanoidBoneName,
  b: HumanoidBoneName,
  k: number,
): Ring["bones"] => [
  [HUMANOID_BONES.indexOf(a), 1 - k],
  [HUMANOID_BONES.indexOf(b), k],
];
/** Blouse contour: shoulders, ribs, waist, then a loose hem. Armour fits it. */
export function torsoSections(): Ring[] {
  const rows = [
    [1.505, 0.076, 0.077, 0.072],
    [1.48, 0.108, 0.093, 0.083],
    [1.455, 0.157, 0.114, 0.11],
    [1.41, 0.178, 0.126, 0.117],
    [1.36, 0.18, 0.135, 0.12],
    [1.3, 0.174, 0.14, 0.12],
    [1.24, 0.169, 0.138, 0.12],
    [1.18, 0.158, 0.13, 0.119],
    [1.12, 0.151, 0.12, 0.116],
    [1.06, 0.154, 0.119, 0.117],
    [1.01, 0.163, 0.122, 0.12],
    [0.98, 0.168, 0.124, 0.122],
  ];
  return rows.map(([y, rx, front, back]) => ({
    y: y!,
    rx: rx!,
    rzF: front!,
    rzB: back!,
    n: 2.1,
    bones:
      y! > 1.24
        ? only("chest")
        : y! > 1.08
          ? blend("chest", "spine", 0.55)
          : blend("spine", "hips", 0.65),
    surface: (t, p) => {
      const a = Math.PI + t * Math.PI * 2,
        d = clothDisplacement("blouse", t, y!);
      return [
        p[0] + Math.sin(a) * d,
        p[1] + 0.004 * Math.cos(t * 10) * Math.max(0, (1.1 - y!) / 0.12),
        p[2] + Math.cos(a) * d,
      ];
    },
  }));
}
export function buildLayeredTorso(b: SkinBuilder): void {
  const rows = torsoSections();
  b.loft(rows, { sides: 24, region: region("blouse"), vByHeight: true });
  // Armour stops above the belt, revealing blouse below and at the armholes.
  const panel = rows
    .filter((r) => r.y <= 1.455 && r.y >= 1.12)
    .map((r, i, list): Ring => ({
      ...r,
      rx: r.rx + 0.012,
      rzF: r.rzF + 0.019,
      rzB: (r.rzB ?? r.rzF) + 0.014,
      surface: (t, p) => {
        const a = Math.PI + t * Math.PI * 2;
        const edge = i === 0 || i === list.length - 1;
        return [p[0], p[1] + (edge ? 0.018 * Math.cos(a * 2) : 0), p[2]];
      },
    }));
  // Distinct front and back panels leave side seams and blouse-covered armholes.
  b.loft(panel, { sides: 18, region: region("vest"), arc: [0.29, 0.71] });
  b.loft(panel, { sides: 18, region: region("vest"), arc: [0.79, 1.21] });
  // Cloth side closures fitted round the ribs, with their own hems.
  for (const arc of [
    [0.18, 0.3],
    [0.7, 0.82],
  ] as const)
    b.loft(panel.slice(2), { sides: 6, region: region("pouch"), arc });
  // Collar and overlapping front opening are dark webbing rather than a monolithic shell.
  b.loft(
    [
      { y: 1.49, rx: 0.086, rzF: 0.092, rzB: 0.083, bones: only("chest") },
      { y: 1.45, rx: 0.108, rzF: 0.111, rzB: 0.095, bones: only("chest") },
    ],
    { sides: 16, region: region("strap"), arc: [0.2, 0.8] },
  );
  // Flap follows the chest down, slanted slightly off the centreline.
  b.loft(
    panel.map((r) => ({
      y: r.y,
      bones: r.bones,
      cx: 0.006,
      rx: 0.018,
      cz: r.rzF,
      rzF: 0.005,
      rzB: 0.005,
      n: 2.5,
    })),
    { sides: 8, region: region("strap"), capTop: true, capBottom: true },
  );
}
/** A soft pouch hangs outward in the middle instead of being an identical box. */
export function softPouch(
  cx: number,
  cz: number,
  top: number,
  bottom: number,
  rx: number,
  rz: number,
  bones: Ring["bones"],
  seed = 0,
): Ring[] {
  const h = top - bottom;
  return [
    { y: top, cx, cz, rx: rx * 0.83, rzF: rz * 0.76, n: 2.7, bones },
    {
      y: top - h * 0.17,
      cx: cx + 0.003 * Math.sin(seed),
      cz,
      rx,
      rzF: rz,
      n: 2.8,
      bones,
    },
    {
      y: top - h * 0.67,
      cx,
      cz: cz + Math.sign(cz) * 0.004,
      rx: rx * 1.04,
      rzF: rz * 1.12,
      n: 2.6,
      bones,
    },
    {
      y: bottom,
      cx: cx + 0.002 * Math.cos(seed),
      cz,
      rx: rx * 0.82,
      rzF: rz * 0.75,
      n: 2.7,
      bones,
    },
  ];
}
