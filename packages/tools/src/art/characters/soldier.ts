/**
 * The detailed soldier (T-4.08; ADR-018 code-authored, ADR-020 the setting):
 * a US infantryman in Afghanistan, winter 2001–2002, in three-colour desert
 * camouflage. He wears a PASGT helmet with a desert cover and goggles on it,
 * an Interceptor vest with MOLLE magazine, radio and grenade pouches, a
 * three-day pack, a web belt with a canteen, tan gloves and tan boots.
 * `docs/art/direction.md` is the brief.
 *
 * THE RIG IS THE CODE-BUILT SOLDIER'S (T-2.22): the same 17 bones at the same
 * joints (`JOINTS` from humanoidSoldier.ts) in `HUMANOID_BONES` order, with
 * the bind pose the identity. So every pose, gait, aim, reload and hit layer,
 * the IK hold and foot placement work on this skin unchanged, and the page
 * swaps this skin onto a live soldier (`client/src/character/assetSoldier.ts`).
 *
 * Built from vertical lofts (`skin.ts`), because in the bind pose every limb
 * hangs straight. Weights blend across the knees, elbows, shoulders, hips,
 * waist and neck, so the body bends rather than breaking at a joint. It stays
 * inside the server's hit capsule (radius 0.35 m round the root axis), like
 * the code-built one: visible kit the rounds pass through would be a netcode
 * bug wearing art's clothes (T-2.31).
 *
 * Two materials: the shared atlas (`soldierAtlas.ts`), and the squad marking
 * (an armband and a band on the helmet's back), whose colour the page sets
 * per slot from `soldierPalette.json`'s `accent`.
 */
import { HUMANOID_BONES, type HumanoidBoneName } from '../../../../client/src/character/humanoidRig.ts';
import { JOINTS } from '../../../../client/src/character/humanoidSoldier.ts';
import { type BuiltSkin, type Ring, SkinBuilder } from './skin.ts';
import { region } from './soldierAtlas.ts';

const B = (name: HumanoidBoneName): number => HUMANOID_BONES.indexOf(name);
type W = readonly (readonly [number, number])[];
const only = (name: HumanoidBoneName): W => [[B(name), 1]];
const blend = (a: HumanoidBoneName, b: HumanoidBoneName, t: number): W => [
  [B(a), 1 - t],
  [B(b), t],
];

/** Rings for a pouch, a box with rounded corners and bevelled top and bottom edges. */
function pouchRings(cx: number, cz: number, top: number, bottom: number, rx: number, rz: number, bones: W): Ring[] {
  const bev = Math.min(0.012, (top - bottom) / 4);
  return [
    { y: top, cx, cz, rx: rx - bev, rzF: rz - bev, n: 4, bones },
    { y: top - bev, cx, cz, rx, rzF: rz, n: 4, bones },
    { y: bottom + bev, cx, cz, rx, rzF: rz, n: 4, bones },
    { y: bottom, cx, cz, rx: rx - bev, rzF: rz - bev, n: 4, bones },
  ];
}

export function buildDetailedSoldier(): BuiltSkin {
  const b = new SkinBuilder();
  const R = region;

  // -- Head and neck --------------------------------------------------------
  // A broad face with a jaw, a nose and a chin; ears at the sides under the helmet's rim.
  const ears = [
    { t: 0.25, w: 0.035, d: 0.014 },
    { t: 0.75, w: 0.035, d: 0.014 },
  ];
  b.loft(
    [
      { y: 1.85, rx: 0.02, rzF: 0.02, bones: only('head') },
      { y: 1.83, rx: 0.072, rzF: 0.076, rzB: 0.08, bones: only('head') },
      { y: 1.79, rx: 0.092, rzF: 0.098, rzB: 0.1, bones: only('head') },
      { y: 1.74, rx: 0.097, rzF: 0.103, rzB: 0.104, bones: only('head') },
      { y: 1.7, rx: 0.096, rzF: 0.104, rzB: 0.098, bones: only('head') },
      { y: 1.675, rx: 0.094, rzF: 0.1, rzB: 0.094, bumps: ears, bones: only('head') },
      { y: 1.65, rx: 0.092, rzF: 0.1, rzB: 0.09, bumps: [...ears, { t: 0.5, w: 0.05, d: 0.02 }], bones: only('head') },
      { y: 1.63, rx: 0.09, rzF: 0.098, rzB: 0.087, bumps: [{ t: 0.5, w: 0.045, d: 0.012 }], bones: only('head') },
      { y: 1.6, rx: 0.086, rzF: 0.094, rzB: 0.082, n: 2.3, bones: only('head') },
      { y: 1.575, rx: 0.074, rzF: 0.088, rzB: 0.074, n: 2.3, bumps: [{ t: 0.5, w: 0.06, d: 0.006 }], bones: blend('head', 'neck', 0.3) },
      { y: 1.55, rx: 0.062, rzF: 0.06, rzB: 0.062, bones: blend('head', 'neck', 0.6) },
      { y: 1.53, rx: 0.06, rzF: 0.056, rzB: 0.06, bones: blend('head', 'neck', 0.8) },
    ],
    { sides: 20, region: R('face'), capTop: true, vByHeight: true },
  );
  b.loft(
    [
      { y: 1.55, rx: 0.06, rzF: 0.056, bones: only('neck') },
      { y: 1.44, rx: 0.064, rzF: 0.062, bones: blend('neck', 'chest', 0.6) },
    ],
    { sides: 12, region: R('skin') },
  );
  // The blouse collar, turned up round the neck above the vest.
  b.loft(
    [
      { y: 1.53, rx: 0.062, rzF: 0.066, rzB: 0.062, bones: blend('neck', 'chest', 0.4) },
      { y: 1.49, rx: 0.08, rzF: 0.082, rzB: 0.075, bones: only('chest') },
    ],
    { sides: 14, region: R('cuff') },
  );

  // -- PASGT helmet: dome, flared skirt lower at the back and sides ---------
  const helmet: Ring[] = [
    { y: 1.905, rx: 0.03, rzF: 0.03, bones: only('head') },
    { y: 1.895, rx: 0.085, rzF: 0.09, bones: only('head') },
    { y: 1.87, rx: 0.12, rzF: 0.126, rzB: 0.128, bones: only('head') },
    { y: 1.83, rx: 0.142, rzF: 0.148, rzB: 0.152, bones: only('head') },
    { y: 1.78, rx: 0.151, rzF: 0.156, rzB: 0.162, bones: only('head') },
    { y: 1.74, rx: 0.154, rzF: 0.158, rzB: 0.166, dropBack: 0.02, bones: only('head') },
    { y: 1.72, rx: 0.162, rzF: 0.163, rzB: 0.174, dropBack: 0.045, bones: only('head') },
    { y: 1.708, rx: 0.16, rzF: 0.16, rzB: 0.172, dropBack: 0.05, bones: only('head') },
    { y: 1.715, rx: 0.13, rzF: 0.13, rzB: 0.135, dropBack: 0.05, bones: only('head') },
  ];
  b.loft(helmet, { sides: 22, region: R('helmet'), capTop: true });
  // The goggles' strap round the helmet, the goggles resting on the front.
  b.loft(
    [
      { y: 1.79, rx: 0.157, rzF: 0.162, rzB: 0.167, bones: only('head') },
      { y: 1.765, rx: 0.159, rzF: 0.164, rzB: 0.169, bones: only('head') },
    ],
    { sides: 22, region: R('strap') },
  );
  b.loft(
    [
      { y: 1.8, rx: 0.164, rzF: 0.172, bones: only('head') },
      { y: 1.755, rx: 0.166, rzF: 0.174, bones: only('head') },
    ],
    { sides: 10, region: R('goggle'), arc: [0.38, 0.62] },
  );
  // The squad marking: a band on the helmet's back, in the slot colour.
  b.loft(
    [
      { y: 1.77, rx: 0.16, rzF: 0.168, rzB: 0.171, bones: only('head') },
      { y: 1.745, rx: 0.161, rzF: 0.168, rzB: 0.172, bones: only('head') },
    ],
    { sides: 8, region: R('strap'), arc: [0.9, 1.1], material: 1 },
  );

  // -- Interceptor vest ------------------------------------------------------
  b.loft(
    [
      { y: 1.5, rx: 0.088, rzF: 0.088, rzB: 0.078, bones: only('chest') },
      { y: 1.475, rx: 0.11, rzF: 0.1, rzB: 0.094, bones: only('chest') },
      { y: 1.455, rx: 0.165, rzF: 0.13, rzB: 0.125, n: 2.4, bones: only('chest') },
      { y: 1.38, rx: 0.172, rzF: 0.148, rzB: 0.138, n: 2.8, bones: only('chest') },
      { y: 1.26, rx: 0.172, rzF: 0.155, rzB: 0.14, n: 3, bones: blend('chest', 'spine', 0.3) },
      { y: 1.14, rx: 0.166, rzF: 0.146, rzB: 0.134, n: 3, bones: blend('spine', 'chest', 0.4) },
      { y: 1.03, rx: 0.162, rzF: 0.138, rzB: 0.13, n: 3, bones: blend('spine', 'hips', 0.5) },
      { y: 0.985, rx: 0.158, rzF: 0.132, rzB: 0.127, n: 3, bones: blend('hips', 'spine', 0.4) },
    ],
    { sides: 22, region: R('vest') },
  );
  // Three magazine pouches across the belly, a radio pouch high on the left, two grenade pouches on the right.
  for (const x of [-0.085, 0, 0.085]) b.loft(pouchRings(x, 0.175, 1.15, 1.03, 0.038, 0.03, blend('spine', 'chest', 0.4)), { sides: 12, region: R('pouch'), capTop: true, capBottom: true });
  b.loft(pouchRings(0.095, 0.178, 1.36, 1.23, 0.034, 0.028, only('chest')), { sides: 12, region: R('pouch'), capTop: true, capBottom: true });
  for (const y of [1.33, 1.26]) b.loft(pouchRings(-0.1, 0.172, y, y - 0.055, 0.028, 0.025, only('chest')), { sides: 10, region: R('pouch'), capTop: true, capBottom: true });
  // The three-day pack on the back.
  b.loft(
    [
      { y: 1.44, cz: -0.2, rx: 0.115, rzF: 0.045, rzB: 0.045, n: 4, bones: only('chest') },
      { y: 1.41, cz: -0.2, rx: 0.135, rzF: 0.058, rzB: 0.062, n: 4, bones: only('chest') },
      { y: 1.2, cz: -0.2, rx: 0.14, rzF: 0.058, rzB: 0.068, n: 4, bones: blend('chest', 'spine', 0.3) },
      { y: 1.08, cz: -0.195, rx: 0.135, rzF: 0.056, rzB: 0.062, n: 4, bones: blend('spine', 'chest', 0.4) },
      { y: 1.05, cz: -0.19, rx: 0.115, rzF: 0.045, rzB: 0.048, n: 4, bones: blend('spine', 'chest', 0.4) },
    ],
    { sides: 16, region: R('pack'), capTop: true, capBottom: true },
  );

  // -- Pelvis, belt, canteen ------------------------------------------------
  b.loft(
    [
      { y: 0.99, rx: 0.152, rzF: 0.108, rzB: 0.105, bones: blend('hips', 'spine', 0.3) },
      { y: 0.92, rx: 0.162, rzF: 0.112, rzB: 0.11, bones: only('hips') },
      { y: 0.86, rx: 0.158, rzF: 0.106, rzB: 0.108, bones: only('hips') },
      { y: 0.8, rx: 0.14, rzF: 0.09, rzB: 0.095, bones: only('hips') },
    ],
    { sides: 18, region: R('trousers'), capBottom: true },
  );
  b.loft(
    [
      { y: 0.99, rx: 0.166, rzF: 0.12, rzB: 0.117, n: 2.4, bones: only('hips') },
      { y: 0.945, rx: 0.168, rzF: 0.121, rzB: 0.118, n: 2.4, bones: only('hips') },
    ],
    { sides: 20, region: R('belt') },
  );
  b.loft(pouchRings(-0.13, -0.09, 0.97, 0.85, 0.042, 0.038, only('hips')), { sides: 12, region: R('pouch'), capTop: true, capBottom: true });

  // -- Legs, cargo pockets, boots -------------------------------------------
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'left' : 'right';
    const upper = `upper-leg-${side}` as const;
    const lower = `lower-leg-${side}` as const;
    const foot = `foot-${side}` as const;
    const cx = JOINTS[upper][0];
    b.loft(
      [
        { y: 0.93, cx, rx: 0.098, rzF: 0.1, bones: blend('hips', upper, 0.5) },
        { y: 0.86, cx, rx: 0.094, rzF: 0.096, bones: blend(upper, 'hips', 0.15) },
        { y: 0.74, cx, rx: 0.088, rzF: 0.088, rzB: 0.09, bones: only(upper) },
        { y: 0.62, cx, rx: 0.078, rzF: 0.08, rzB: 0.08, bones: only(upper) },
        { y: 0.53, cx, rx: 0.068, rzF: 0.072, rzB: 0.07, bones: blend(upper, lower, 0.3) },
        { y: 0.48, cx, rx: 0.066, rzF: 0.074, rzB: 0.066, bones: blend(upper, lower, 0.5) },
        { y: 0.43, cx, rx: 0.064, rzF: 0.068, rzB: 0.07, bones: blend(lower, upper, 0.3) },
        { y: 0.36, cx, rx: 0.062, rzF: 0.062, rzB: 0.074, bones: only(lower) },
        { y: 0.28, cx, rx: 0.056, rzF: 0.058, rzB: 0.064, bones: only(lower) },
        { y: 0.21, cx, rx: 0.058, rzF: 0.064, rzB: 0.064, bones: only(lower) },
      ],
      { sides: 14, region: R('trousers') },
    );
    // The cargo pocket on the outside of the thigh.
    b.loft(
      [
        { y: 0.76, cx, rx: 0.1, rzF: 0.098, rzB: 0.1, bones: only(upper) },
        { y: 0.75, cx, rx: 0.103, rzF: 0.1, rzB: 0.102, bones: only(upper) },
        { y: 0.62, cx, rx: 0.094, rzF: 0.09, rzB: 0.092, bones: only(upper) },
        { y: 0.61, cx, rx: 0.089, rzF: 0.086, rzB: 0.088, bones: only(upper) },
      ],
      { sides: 6, region: R('cuff'), arc: s > 0 ? [0.66, 0.84] : [0.16, 0.34] },
    );
    // Desert boots: the upper round the ankle, the foot forward to the toe, a thick sole.
    b.loft(
      [
        { y: 0.25, cx, rx: 0.062, rzF: 0.068, rzB: 0.068, bones: only(lower) },
        { y: 0.17, cx, rx: 0.058, rzF: 0.07, rzB: 0.066, bones: blend(lower, foot, 0.5) },
        { y: 0.11, cx, cz: 0.02, rx: 0.056, rzF: 0.1, rzB: 0.07, bones: only(foot) },
        { y: 0.06, cx, cz: 0.03, rx: 0.058, rzF: 0.13, rzB: 0.072, n: 2.5, bones: only(foot) },
        { y: 0.028, cx, cz: 0.03, rx: 0.06, rzF: 0.142, rzB: 0.076, n: 3, bones: only(foot) },
        { y: 0, cx, cz: 0.03, rx: 0.058, rzF: 0.138, rzB: 0.074, n: 3, bones: only(foot) },
      ],
      { sides: 14, region: R('boot'), capBottom: true },
    );
  }

  // -- Arms, cuffs, the armband, gloved hands -------------------------------
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'left' : 'right';
    const upper = `upper-arm-${side}` as const;
    const lower = `lower-arm-${side}` as const;
    const hand = `hand-${side}` as const;
    const cx = JOINTS[upper][0];
    b.loft(
      [
        { y: 1.5, cx, rx: 0.04, rzF: 0.045, bones: blend('chest', upper, 0.5) },
        { y: 1.48, cx, rx: 0.062, rzF: 0.066, bones: blend(upper, 'chest', 0.3) },
        { y: 1.42, cx, rx: 0.068, rzF: 0.07, bones: blend(upper, 'chest', 0.1) },
        { y: 1.33, cx, rx: 0.062, rzF: 0.064, bones: only(upper) },
        { y: 1.23, cx, rx: 0.057, rzF: 0.058, bones: only(upper) },
        { y: 1.17, cx, rx: 0.053, rzF: 0.055, bones: blend(upper, lower, 0.35) },
        { y: 1.12, cx, rx: 0.051, rzF: 0.054, rzB: 0.056, bones: blend(lower, upper, 0.35) },
        { y: 1.04, cx, rx: 0.05, rzF: 0.05, bones: only(lower) },
        { y: 0.95, cx, rx: 0.044, rzF: 0.044, bones: only(lower) },
      ],
      { sides: 12, region: R('blouse'), capTop: true },
    );
    // The cuff, rolled over the glove's top.
    b.loft(
      [
        { y: 0.96, cx, rx: 0.048, rzF: 0.048, bones: only(lower) },
        { y: 0.91, cx, rx: 0.046, rzF: 0.046, bones: blend(lower, hand, 0.3) },
      ],
      { sides: 12, region: R('cuff') },
    );
    if (s > 0) {
      b.loft(
        [
          { y: 1.36, cx, rx: 0.066, rzF: 0.068, bones: only(upper) },
          { y: 1.3, cx, rx: 0.064, rzF: 0.066, bones: only(upper) },
        ],
        { sides: 12, region: R('strap'), material: 1 },
      );
    }
    // The hand hangs palm-in: thin across x, long along z.
    b.loft(
      [
        { y: 0.915, cx, rx: 0.038, rzF: 0.04, bones: blend(lower, hand, 0.4) },
        { y: 0.86, cx, rx: 0.03, rzF: 0.05, rzB: 0.042, n: 2.6, bones: only(hand) },
        { y: 0.8, cx, cz: 0.004, rx: 0.026, rzF: 0.054, rzB: 0.044, n: 3, bones: only(hand) },
        { y: 0.76, cx, cz: 0.006, rx: 0.024, rzF: 0.05, rzB: 0.04, n: 3, bones: only(hand) },
        { y: 0.71, cx, cz: 0.008, rx: 0.02, rzF: 0.042, rzB: 0.032, n: 2.6, bones: only(hand) },
        { y: 0.69, cx, cz: 0.008, rx: 0.014, rzF: 0.03, rzB: 0.022, bones: only(hand) },
      ],
      { sides: 12, region: R('glove'), capBottom: true },
    );
    // The thumb, forward and toward the body.
    const tx = cx - s * 0.014;
    b.loft(
      [
        { y: 0.855, cx: tx, cz: 0.04, rx: 0.016, rzF: 0.018, bones: only(hand) },
        { y: 0.81, cx: tx, cz: 0.052, rx: 0.014, rzF: 0.015, bones: only(hand) },
        { y: 0.775, cx: tx, cz: 0.056, rx: 0.011, rzF: 0.012, bones: only(hand) },
      ],
      { sides: 8, region: R('glove'), capBottom: true },
    );
  }
  return b.build();
}
