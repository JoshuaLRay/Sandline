/**
 * The enemy fighter (T-4.35; ADR-018 code-authored, ADR-020 the setting): an
 * irregular fighter in Afghanistan, winter 2001–2002. Shalwar kameez — a
 * long shirt to the knee over loose trousers gathered at the ankle — under a
 * dark wool waistcoat; a scarf round the neck; a chest rig of magazine
 * pouches over a cloth sash; worn boots; bare, sun-dark hands; a full beard.
 * On his head a pakol or a turban. The MG gunner wears a bandolier across his
 * chest. `docs/art/direction.md` is the brief: the silhouette is loose cloth,
 * not a vest and a helmet, and says which side a figure is on before its
 * colour does.
 *
 * THE SOLDIER'S RIG AND CAPSULE (`soldier.ts`): the same 17 bones at the same
 * joints with the identity bind, built from the same vertical lofts, inside
 * the server's hit capsule. Every pose, gait, aim and hit layer works on it
 * unchanged, and the page swaps it onto a live enemy (`assetSoldier.ts`).
 *
 * FIVE PARTS, ONE ATLAS (`fighterAtlas.ts`). The body, the cloth, the pakol,
 * the turban and the bandolier are separate primitives, one node each, so the
 * page can show one headgear or the other, the bandolier on the gunner only,
 * and tint the cloth and headgear per variant (`fighterLook.json`): a handful
 * of different-looking fighters from one geometry and one texture.
 */
import { HUMANOID_BONES, type HumanoidBoneName } from '../../../../client/src/character/humanoidRig.ts';
import { JOINTS } from '../../../../client/src/character/humanoidSoldier.ts';
import { type BuiltSkin, type Ring, SkinBuilder } from './skin.ts';
import { fighterRegion as R } from './fighterAtlas.ts';

const B = (name: HumanoidBoneName): number => HUMANOID_BONES.indexOf(name);
type W = readonly (readonly [number, number])[];
const only = (name: HumanoidBoneName): W => [[B(name), 1]];
const blend = (a: HumanoidBoneName, b: HumanoidBoneName, t: number): W => [
  [B(a), 1 - t],
  [B(b), t],
];

export { FIGHTER_PARTS, type FighterPart } from '../../../../client/src/character/assetSoldier.ts';
import type { FighterPart } from '../../../../client/src/character/assetSoldier.ts';

/** Rings for a pouch, a box with rounded corners and bevelled top and bottom edges. */
function pouchRings(cx: number, cz: number, top: number, bottom: number, rx: number, rz: number, bones: W): Ring[] {
  const bev = Math.min(0.01, (top - bottom) / 4);
  return [
    { y: top, cx, cz, rx: rx - bev, rzF: rz - bev, n: 4, bones },
    { y: top - bev, cx, cz, rx, rzF: rz, n: 4, bones },
    { y: bottom + bev, cx, cz, rx, rzF: rz, n: 4, bones },
    { y: bottom, cx, cz, rx: rx - bev, rzF: rz - bev, n: 4, bones },
  ];
}

/** The skin, the waistcoat, the rig, the sash, the scarf, the boots and the hands: never tinted. */
function body(): BuiltSkin {
  const b = new SkinBuilder();
  // -- Head: a long face with a full beard, the jaw squared by it ----------
  const ears = [
    { t: 0.25, w: 0.035, d: 0.014 },
    { t: 0.75, w: 0.035, d: 0.014 },
  ];
  b.loft(
    [
      { y: 1.84, rx: 0.02, rzF: 0.02, bones: only('head') },
      { y: 1.82, rx: 0.07, rzF: 0.074, rzB: 0.078, bones: only('head') },
      { y: 1.78, rx: 0.09, rzF: 0.096, rzB: 0.1, bones: only('head') },
      { y: 1.73, rx: 0.095, rzF: 0.102, rzB: 0.103, bones: only('head') },
      { y: 1.7, rx: 0.094, rzF: 0.103, rzB: 0.097, bones: only('head') },
      { y: 1.675, rx: 0.092, rzF: 0.1, rzB: 0.093, bumps: ears, bones: only('head') },
      { y: 1.65, rx: 0.09, rzF: 0.1, rzB: 0.089, bumps: [...ears, { t: 0.5, w: 0.05, d: 0.022 }], bones: only('head') },
      { y: 1.625, rx: 0.092, rzF: 0.102, rzB: 0.086, bumps: [{ t: 0.5, w: 0.08, d: 0.01 }], bones: only('head') },
      // The beard fills the jaw and juts at the chin.
      { y: 1.595, rx: 0.09, rzF: 0.104, rzB: 0.08, n: 2.3, bumps: [{ t: 0.5, w: 0.12, d: 0.016 }], bones: only('head') },
      { y: 1.565, rx: 0.078, rzF: 0.098, rzB: 0.07, n: 2.3, bumps: [{ t: 0.5, w: 0.1, d: 0.02 }], bones: blend('head', 'neck', 0.3) },
      { y: 1.54, rx: 0.062, rzF: 0.07, rzB: 0.062, bones: blend('head', 'neck', 0.6) },
      { y: 1.52, rx: 0.06, rzF: 0.058, rzB: 0.06, bones: blend('head', 'neck', 0.8) },
    ],
    { sides: 20, region: R('face'), capTop: true, vByHeight: true },
  );
  b.loft(
    [
      { y: 1.54, rx: 0.06, rzF: 0.056, bones: only('neck') },
      { y: 1.44, rx: 0.064, rzF: 0.062, bones: blend('neck', 'chest', 0.6) },
    ],
    { sides: 12, region: R('skin') },
  );
  // The scarf, wound loose round the neck and lying on the shoulders.
  b.loft(
    [
      { y: 1.545, rx: 0.07, rzF: 0.074, rzB: 0.07, bones: blend('neck', 'head', 0.2) },
      { y: 1.52, rx: 0.088, rzF: 0.094, rzB: 0.086, bones: only('neck') },
      { y: 1.49, rx: 0.11, rzF: 0.11, rzB: 0.1, bones: blend('neck', 'chest', 0.5) },
      { y: 1.465, rx: 0.13, rzF: 0.118, rzB: 0.11, n: 2.3, bones: only('chest') },
      { y: 1.45, rx: 0.12, rzF: 0.105, rzB: 0.1, n: 2.3, bones: only('chest') },
    ],
    { sides: 18, region: R('scarf'), capBottom: false },
  );
  // Its end, hanging down the chest on the left.
  b.loft(
    [
      { y: 1.47, cx: 0.06, cz: 0.12, rx: 0.035, rzF: 0.012, n: 3, bones: only('chest') },
      { y: 1.3, cx: 0.07, cz: 0.14, rx: 0.038, rzF: 0.012, n: 3, bones: only('chest') },
    ],
    { sides: 10, region: R('scarf'), capBottom: true },
  );

  // -- The waistcoat, open at the front over the kameez ---------------------
  b.loft(
    [
      { y: 1.46, rx: 0.12, rzF: 0.1, rzB: 0.1, n: 2.4, bones: only('chest') },
      { y: 1.44, rx: 0.168, rzF: 0.128, rzB: 0.124, n: 2.6, bones: only('chest') },
      { y: 1.36, rx: 0.172, rzF: 0.132, rzB: 0.128, n: 2.7, bones: only('chest') },
      { y: 1.24, rx: 0.17, rzF: 0.134, rzB: 0.128, n: 2.7, bones: blend('chest', 'spine', 0.3) },
      { y: 1.12, rx: 0.164, rzF: 0.13, rzB: 0.124, n: 2.7, bones: blend('spine', 'chest', 0.4) },
      { y: 1.02, rx: 0.162, rzF: 0.13, rzB: 0.122, n: 2.7, bones: blend('spine', 'hips', 0.5) },
    ],
    { sides: 20, region: R('waistcoat'), arc: [0.56, 1.44] },
  );
  // The chest rig: three magazine cells high on the chest, on a strap round the body.
  b.loft(
    [
      { y: 1.3, rx: 0.175, rzF: 0.136, rzB: 0.131, n: 2.7, bones: only('chest') },
      { y: 1.275, rx: 0.176, rzF: 0.137, rzB: 0.132, n: 2.7, bones: only('chest') },
    ],
    { sides: 20, region: R('rig') },
  );
  for (const x of [-0.075, 0, 0.075]) b.loft(pouchRings(x, 0.15, 1.27, 1.15, 0.034, 0.026, only('chest')), { sides: 12, region: R('rig'), capTop: true, capBottom: true });
  // The sash, wound round the waist over the kameez.
  b.loft(
    [
      { y: 1.0, rx: 0.166, rzF: 0.13, rzB: 0.122, n: 2.4, bones: blend('hips', 'spine', 0.3) },
      { y: 0.975, rx: 0.17, rzF: 0.134, rzB: 0.126, n: 2.4, bones: only('hips') },
      { y: 0.94, rx: 0.168, rzF: 0.132, rzB: 0.124, n: 2.4, bones: only('hips') },
    ],
    { sides: 20, region: R('sash') },
  );

  // -- Worn boots ------------------------------------------------------------
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'left' : 'right';
    const lower = `lower-leg-${side}` as const;
    const foot = `foot-${side}` as const;
    const cx = JOINTS[`upper-leg-${side}`][0];
    b.loft(
      [
        { y: 0.17, cx, rx: 0.054, rzF: 0.06, rzB: 0.06, bones: blend(lower, foot, 0.4) },
        { y: 0.11, cx, cz: 0.02, rx: 0.054, rzF: 0.094, rzB: 0.066, bones: only(foot) },
        { y: 0.06, cx, cz: 0.03, rx: 0.056, rzF: 0.124, rzB: 0.07, n: 2.4, bones: only(foot) },
        { y: 0.022, cx, cz: 0.03, rx: 0.057, rzF: 0.134, rzB: 0.072, n: 2.8, bones: only(foot) },
        { y: 0, cx, cz: 0.03, rx: 0.055, rzF: 0.13, rzB: 0.07, n: 2.8, bones: only(foot) },
      ],
      { sides: 14, region: R('boot'), capTop: true, capBottom: true },
    );
  }

  // -- Bare hands and thumbs -------------------------------------------------
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'left' : 'right';
    const lower = `lower-arm-${side}` as const;
    const hand = `hand-${side}` as const;
    const cx = JOINTS[`upper-arm-${side}`][0];
    b.loft(
      [
        { y: 0.94, cx, rx: 0.034, rzF: 0.036, bones: only(lower) },
        { y: 0.9, cx, rx: 0.032, rzF: 0.036, bones: blend(lower, hand, 0.4) },
        { y: 0.86, cx, rx: 0.028, rzF: 0.048, rzB: 0.04, n: 2.6, bones: only(hand) },
        { y: 0.8, cx, cz: 0.004, rx: 0.024, rzF: 0.052, rzB: 0.042, n: 3, bones: only(hand) },
        { y: 0.76, cx, cz: 0.006, rx: 0.022, rzF: 0.048, rzB: 0.038, n: 3, bones: only(hand) },
        { y: 0.71, cx, cz: 0.008, rx: 0.018, rzF: 0.04, rzB: 0.03, n: 2.6, bones: only(hand) },
        { y: 0.69, cx, cz: 0.008, rx: 0.012, rzF: 0.028, rzB: 0.02, bones: only(hand) },
      ],
      { sides: 12, region: R('skin'), capBottom: true },
    );
    const tx = cx - s * 0.013;
    b.loft(
      [
        { y: 0.855, cx: tx, cz: 0.038, rx: 0.014, rzF: 0.016, bones: only(hand) },
        { y: 0.81, cx: tx, cz: 0.05, rx: 0.012, rzF: 0.013, bones: only(hand) },
        { y: 0.775, cx: tx, cz: 0.054, rx: 0.01, rzF: 0.011, bones: only(hand) },
      ],
      { sides: 8, region: R('skin'), capBottom: true },
    );
  }
  return b.build();
}

/** The kameez, its sleeves and the shalwar trousers, painted pale for the variant's tint. */
function cloth(): BuiltSkin {
  const b = new SkinBuilder();
  // The shirt's body: shoulders to the sash, under the waistcoat.
  b.loft(
    [
      { y: 1.5, rx: 0.084, rzF: 0.082, rzB: 0.076, bones: only('chest') },
      { y: 1.47, rx: 0.12, rzF: 0.1, rzB: 0.095, bones: only('chest') },
      { y: 1.44, rx: 0.16, rzF: 0.122, rzB: 0.118, n: 2.4, bones: only('chest') },
      { y: 1.34, rx: 0.164, rzF: 0.126, rzB: 0.122, n: 2.5, bones: only('chest') },
      { y: 1.22, rx: 0.162, rzF: 0.128, rzB: 0.122, n: 2.5, bones: blend('chest', 'spine', 0.3) },
      { y: 1.1, rx: 0.156, rzF: 0.124, rzB: 0.118, n: 2.5, bones: blend('spine', 'chest', 0.4) },
      { y: 1.0, rx: 0.158, rzF: 0.124, rzB: 0.116, n: 2.5, bones: blend('spine', 'hips', 0.5) },
    ],
    { sides: 20, region: R('kameez') },
  );
  // Its skirt, from the sash to the knee, flaring and hanging loose round both legs.
  const skirt = (k: number): W => [
    [B('hips'), 1 - k],
    [B('upper-leg-left'), k / 2],
    [B('upper-leg-right'), k / 2],
  ];
  b.loft(
    [
      { y: 0.95, rx: 0.166, rzF: 0.128, rzB: 0.122, n: 2.4, bones: skirt(0) },
      { y: 0.86, rx: 0.19, rzF: 0.14, rzB: 0.132, n: 2.3, bones: skirt(0.2) },
      { y: 0.74, rx: 0.21, rzF: 0.15, rzB: 0.142, n: 2.2, bones: skirt(0.45) },
      { y: 0.62, rx: 0.222, rzF: 0.158, rzB: 0.15, n: 2.2, bones: skirt(0.7) },
      { y: 0.54, rx: 0.226, rzF: 0.162, rzB: 0.154, n: 2.2, bones: skirt(0.85) },
    ],
    { sides: 24, region: R('kameez') },
  );
  // The shalwar: loose from the hip, deep in the thigh, gathered at the ankle over the boot.
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'left' : 'right';
    const upper = `upper-leg-${side}` as const;
    const lower = `lower-leg-${side}` as const;
    const cx = JOINTS[upper][0];
    b.loft(
      [
        { y: 0.9, cx, rx: 0.1, rzF: 0.104, bones: blend('hips', upper, 0.5) },
        { y: 0.78, cx, rx: 0.1, rzF: 0.106, bones: only(upper) },
        { y: 0.64, cx, rx: 0.094, rzF: 0.1, rzB: 0.1, bones: only(upper) },
        { y: 0.53, cx, rx: 0.088, rzF: 0.094, rzB: 0.092, bones: blend(upper, lower, 0.3) },
        { y: 0.48, cx, rx: 0.086, rzF: 0.094, rzB: 0.088, bones: blend(upper, lower, 0.5) },
        { y: 0.42, cx, rx: 0.084, rzF: 0.088, rzB: 0.09, bones: blend(lower, upper, 0.3) },
        { y: 0.32, cx, rx: 0.078, rzF: 0.082, rzB: 0.086, bones: only(lower) },
        { y: 0.22, cx, rx: 0.068, rzF: 0.072, rzB: 0.074, bones: only(lower) },
        { y: 0.18, cx, rx: 0.058, rzF: 0.064, rzB: 0.064, bones: blend(lower, `foot-${side}`, 0.3) },
        { y: 0.16, cx, rx: 0.06, rzF: 0.066, rzB: 0.066, bones: blend(lower, `foot-${side}`, 0.4) },
      ],
      { sides: 14, region: R('trousers') },
    );
  }
  // The sleeves: loose to the wrist.
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'left' : 'right';
    const upper = `upper-arm-${side}` as const;
    const lower = `lower-arm-${side}` as const;
    const cx = JOINTS[upper][0];
    b.loft(
      [
        { y: 1.5, cx, rx: 0.042, rzF: 0.046, bones: blend('chest', upper, 0.5) },
        { y: 1.48, cx, rx: 0.066, rzF: 0.07, bones: blend(upper, 'chest', 0.3) },
        { y: 1.42, cx, rx: 0.072, rzF: 0.074, bones: blend(upper, 'chest', 0.1) },
        { y: 1.32, cx, rx: 0.068, rzF: 0.07, bones: only(upper) },
        { y: 1.22, cx, rx: 0.064, rzF: 0.066, bones: only(upper) },
        { y: 1.17, cx, rx: 0.06, rzF: 0.062, bones: blend(upper, lower, 0.35) },
        { y: 1.12, cx, rx: 0.058, rzF: 0.062, rzB: 0.064, bones: blend(lower, upper, 0.35) },
        { y: 1.03, cx, rx: 0.056, rzF: 0.058, bones: only(lower) },
        { y: 0.95, cx, rx: 0.05, rzF: 0.052, bones: only(lower) },
        { y: 0.93, cx, rx: 0.044, rzF: 0.046, bones: blend(lower, `hand-${side}`, 0.2) },
      ],
      { sides: 12, region: R('sleeve'), capTop: true },
    );
  }
  return b.build();
}

/** The pakol: a flat round top on a thick rolled rim, pulled down over the head. */
function pakol(): BuiltSkin {
  const b = new SkinBuilder();
  b.loft(
    [
      { y: 1.868, rx: 0.06, rzF: 0.062, bones: only('head') },
      { y: 1.866, rx: 0.112, rzF: 0.116, bones: only('head') },
      { y: 1.852, rx: 0.12, rzF: 0.124, bones: only('head') },
      { y: 1.83, rx: 0.124, rzF: 0.128, bones: only('head') },
      { y: 1.81, rx: 0.13, rzF: 0.134, bones: only('head') },
      { y: 1.785, rx: 0.132, rzF: 0.136, bones: only('head') },
      { y: 1.762, rx: 0.126, rzF: 0.13, bones: only('head') },
      { y: 1.75, rx: 0.108, rzF: 0.114, bones: only('head') },
    ],
    { sides: 22, region: R('pakol'), capTop: true },
  );
  return b.build();
}

/** The turban: cloth wound high over the crown, down to the brow, a tail hanging at the back. */
function turban(): BuiltSkin {
  const b = new SkinBuilder();
  b.loft(
    [
      { y: 1.905, rx: 0.04, rzF: 0.042, bones: only('head') },
      { y: 1.898, rx: 0.1, rzF: 0.104, bones: only('head') },
      { y: 1.878, rx: 0.136, rzF: 0.142, rzB: 0.138, bones: only('head') },
      { y: 1.845, rx: 0.15, rzF: 0.156, rzB: 0.15, bones: only('head') },
      { y: 1.805, rx: 0.148, rzF: 0.154, rzB: 0.15, bones: only('head') },
      { y: 1.768, rx: 0.132, rzF: 0.14, rzB: 0.138, dropBack: 0.02, bones: only('head') },
      { y: 1.738, rx: 0.114, rzF: 0.124, rzB: 0.122, dropBack: 0.03, bones: only('head') },
      { y: 1.728, rx: 0.098, rzF: 0.106, rzB: 0.108, dropBack: 0.03, bones: only('head') },
    ],
    { sides: 22, region: R('turban'), capTop: true },
  );
  // The tail, down the back of the neck.
  b.loft(
    [
      { y: 1.74, cz: -0.12, rx: 0.036, rzF: 0.014, n: 3, bones: only('head') },
      { y: 1.6, cz: -0.115, rx: 0.038, rzF: 0.014, n: 3, bones: blend('head', 'neck', 0.4) },
      { y: 1.5, cz: -0.12, rx: 0.036, rzF: 0.014, n: 3, bones: blend('neck', 'chest', 0.5) },
    ],
    { sides: 10, region: R('turban'), capBottom: true },
  );
  return b.build();
}

/** The MG gunner's bandolier: over the left shoulder, across the chest to the right hip, and back. */
function bandolier(): BuiltSkin {
  const b = new SkinBuilder();
  for (const back of [false, true]) {
    const cz = back ? -0.133 : 0.14;
    const rings: Ring[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = 1.47 - t * 0.5;
      const x = 0.12 - t * 0.25;
      // It lies on the torso: further round, the front's depth falls away.
      const z = cz * (1 - 0.35 * Math.min(1, (x / 0.17) ** 2));
      const bones: W = y > 1.2 ? only('chest') : y > 1.06 ? blend('chest', 'spine', 0.5) : blend('spine', 'hips', 0.5);
      rings.push({ y, cx: x, cz: z, rx: 0.042, rzF: 0.016, n: 3, bones });
    }
    b.loft(rings, { sides: 10, region: R('bandolier') });
  }
  return b.build();
}

/** Every part, in `FIGHTER_PARTS` order. */
export function buildFighter(): Record<FighterPart, BuiltSkin> {
  return { body: body(), cloth: cloth(), pakol: pakol(), turban: turban(), bandolier: bandolier() };
}
