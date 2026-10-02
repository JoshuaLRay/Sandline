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
 * Built from anatomical surfaces and a connected trouser fork (`anatomy.ts`,
 * `skin.ts`), retaining the original identity bind pose. Weights blend across the knees, elbows, shoulders, hips,
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
import { anatomicalHead, anatomicalSleeve, buildTrouserFork } from './anatomy.ts';
import { buildLayeredTorso, softPouch } from './equipment.ts';
import { region } from './soldierAtlas.ts';

const B = (name: HumanoidBoneName): number => HUMANOID_BONES.indexOf(name);
type W = readonly (readonly [number, number])[];
const only = (name: HumanoidBoneName): W => [[B(name), 1]];
const blend = (a: HumanoidBoneName, b: HumanoidBoneName, t: number): W => [
  [B(a), 1 - t],
  [B(b), t],
];

const pouchRings = softPouch;

/** Equipment thickness factors retained from the intermediate U-080 pass.
 * Human anatomy/cloth now comes from shared shaped surfaces, not these multipliers. */
const BULK = { legs: 1.1, boots: 1.1, arms: 1.2, hands: 1.02, torso: 1.15 } as const;
/** Thighs grow front to back more than across: the legs keep their daylight (the fighter's silhouette test reads it). */
const LEG_DEPTH = 1.26;
const bulk = (rings: Ring[], k: number, kz = k): Ring[] =>
  rings.map((r) => ({ ...r, rx: r.rx * k, rzF: r.rzF * kz, ...(r.rzB === undefined ? {} : { rzB: r.rzB * kz }) }));

export function buildDetailedSoldier(): BuiltSkin {
  const b = new SkinBuilder();
  const R = region;

  // -- Head and neck --------------------------------------------------------
  // Landmarks and recessed sockets define an adult face in geometry.
  b.loft(anatomicalHead(), { sides: 40, region: R('face'), capTop: true, vByHeight: true });
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
  b.loft(bulk(helmet, 0.84), { sides: 22, region: R('helmet'), capTop: true });
  // The goggles' strap round the helmet, the goggles resting on the front.
  b.loft(
    [
      { y: 1.79, rx: 0.131880, rzF: 0.136080, rzB: 0.140280, bones: only('head') },
      { y: 1.765, rx: 0.133560, rzF: 0.137760, rzB: 0.141960, bones: only('head') },
    ],
    { sides: 22, region: R('strap') },
  );
  b.loft(
    [
      { y: 1.8, rx: 0.137760, rzF: 0.144480, bones: only('head') },
      { y: 1.755, rx: 0.139440, rzF: 0.146160, bones: only('head') },
    ],
    { sides: 10, region: R('goggle'), arc: [0.38, 0.62] },
  );
  // The squad marking: a band on the helmet's back, in the slot colour.
  b.loft(
    [
      { y: 1.77, rx: 0.134400, rzF: 0.141120, rzB: 0.143640, bones: only('head') },
      { y: 1.745, rx: 0.135240, rzF: 0.141120, rzB: 0.144480, bones: only('head') },
    ],
    { sides: 8, region: R('strap'), arc: [0.9, 1.1], material: 1 },
  );

  // -- Layered blouse, fitted front/back armour and side closures -----------
  buildLayeredTorso(b);
  // Staggered gear sits on the curved panel, rather than on one flat plane.
  for (const [i,x] of [-.095,-.012,.077].entries()) {
    const depth = .174 - Math.abs(x) * .12;
    const top = 1.21 - i * .016;
    b.loft(pouchRings(x,depth,top,top-.15,.038,.033,blend('spine','chest',.55),i),
      {sides:12,region:R('pouch'),capTop:true,capBottom:true});
  }
  b.loft(pouchRings(.107,.145,1.40,1.265,.034,.028,only('chest'),4),{sides:12,region:R('pouch'),capTop:true,capBottom:true});
  for (const [i,y] of [1.375,1.302].entries()) b.loft(pouchRings(-.108,.147,y,y-.065,.029,.028,only('chest'),i+5),{sides:10,region:R('pouch'),capTop:true,capBottom:true});
  // The three-day pack on the back.
  b.loft(
    [
      { y: 1.44, cz: -0.188, rx: 0.105, rzF: 0.045, rzB: 0.045, n: 2.4, bones: only('chest') },
      { y: 1.41, cz: -0.188, rx: 0.125, rzF: 0.058, rzB: 0.062, n: 2.3, bones: only('chest') },
      { y: 1.2, cz: -0.191, rx: 0.137, rzF: 0.062, rzB: 0.078, n: 2.6, bones: blend('chest', 'spine', 0.3) },
      { y: 1.08, cz: -0.195, rx: 0.13, rzF: 0.056, rzB: 0.062, n: 2.6, bones: blend('spine', 'chest', 0.4) },
      { y: 1.05, cz: -0.19, rx: 0.115, rzF: 0.045, rzB: 0.048, n: 4, bones: blend('spine', 'chest', 0.4) },
    ],
    { sides: 16, region: R('pack'), capTop: true, capBottom: true },
  );

  // Pack pockets and shoulder webbing break up the formerly flat slab.
  b.loft(pouchRings(0, -0.278, 1.28, 1.09, 0.083, 0.025, blend('chest', 'spine', 0.3)), { sides: 12, region: R('pouch'), capTop: true, capBottom: true });
  for (const s of [-1, 1]) {
    b.loft(pouchRings(s * 0.13, -0.19, 1.34 - (s > 0 ? .045 : 0), 1.17 - (s > 0 ? .025 : 0), 0.035, 0.045, only('chest')), { sides: 12, region: R('pouch'), capTop: true, capBottom: true });
    b.loft([
      { y: 1.475, cx: s * 0.11, cz: 0.082, rx: 0.023, rzF: 0.025, n: 3, bones: only('chest') },
      { y: 1.41, cx: s * 0.13, cz: 0.153, rx: 0.022, rzF: 0.012, n: 3, bones: only('chest') },
      { y: 1.22, cx: s * 0.115, cz: 0.181, rx: 0.02, rzF: 0.012, n: 2.2, bones: blend('chest', 'spine', 0.2) },
    ], { sides: 8, region: R('strap'), capTop: true, capBottom: true });
  }

  // -- Pelvis, belt, canteen ------------------------------------------------
  buildTrouserFork(b, R('trousers'));
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
    // The cargo pocket on the outside of the thigh.
    b.loft(
      bulk([
        { y: 0.76, cx, rx: 0.102, rzF: 0.113, rzB: 0.112, bones: only(upper) },
        { y: 0.75, cx, rx: 0.105, rzF: 0.115, rzB: 0.114, bones: only(upper) },
        { y: 0.62, cx, rx: 0.094, rzF: 0.09, rzB: 0.092, bones: only(upper) },
        { y: 0.61, cx, rx: 0.089, rzF: 0.086, rzB: 0.088, bones: only(upper) },
      ], BULK.legs, LEG_DEPTH),
      { sides: 6, region: R('cuff'), arc: s > 0 ? [0.66, 0.84] : [0.16, 0.34] },
    );
    // Desert boots: the upper round the ankle, the foot forward to the toe, a thick sole.
    b.loft(
      bulk([
        { y: 0.25, cx, rx: 0.062, rzF: 0.068, rzB: 0.068, bones: only(lower) },
        { y: 0.17, cx, rx: 0.058, rzF: 0.07, rzB: 0.066, bones: blend(lower, foot, 0.5) },
        { y: 0.11, cx, cz: 0.02, rx: 0.056, rzF: 0.1, rzB: 0.07, bones: only(foot) },
        { y: 0.06, cx, cz: 0.03, rx: 0.058, rzF: 0.13, rzB: 0.072, n: 2.5, bones: only(foot) },
        { y: 0.028, cx, cz: 0.03, rx: 0.06, rzF: 0.142, rzB: 0.076, n: 3, bones: only(foot) },
        { y: 0, cx, cz: 0.03, rx: 0.058, rzF: 0.138, rzB: 0.074, n: 3, bones: only(foot) },
      ], BULK.boots),
      { sides: 14, region: R('boot'), capBottom: true },
    );
  }

  // Tongue, welt and lace runs follow each boot's instep in model space.
  for (const s of [-1,1] as const) {
    const side=s>0?'left':'right';
    const cx=JOINTS[`upper-leg-${side}`][0];
    b.loft([
      {y:.235,cx,cz:.071,rx:.029,rzF:.006,n:3,bones:only(`lower-leg-${side}`)},
      {y:.16,cx,cz:.086,rx:.028,rzF:.006,n:3,bones:blend(`lower-leg-${side}`,`foot-${side}`,.6)},
      {y:.09,cx,cz:.136,rx:.035,rzF:.006,n:3,bones:only(`foot-${side}`)},
    ],{sides:8,region:R('boot'),capTop:true,capBottom:true});
    for (let i=0;i<5;i++) {
      const y=.21-i*.022, z=.078+i*.009;
      b.loft([{y:y+.004,cx,cz:z,rx:.026,rzF:.003,n:3,bones:blend(`lower-leg-${side}`,`foot-${side}`,i/4)},
        {y:y-.004,cx,cz:z+.003,rx:.026,rzF:.003,n:3,bones:blend(`lower-leg-${side}`,`foot-${side}`,i/4)}],
        {sides:8,region:R('strap'),capTop:true,capBottom:true});
    }
  }

  // -- Arms, cuffs, the armband, gloved hands -------------------------------
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'left' : 'right';
    const upper = `upper-arm-${side}` as const;
    const lower = `lower-arm-${side}` as const;
    const hand = `hand-${side}` as const;
    const cx = JOINTS[upper][0];
    b.loft(anatomicalSleeve(s), { sides: 20, region: R(s > 0 ? 'sleeve' : 'sleeveRight'), capTop: true, vByHeight: true });
    // The cuff, rolled over the glove's top.
    b.loft(
      bulk([
        { y: 0.96, cx, rx: 0.046, rzF: 0.046, bones: only(lower) },
        { y: 0.91, cx, rx: 0.046, rzF: 0.046, bones: blend(lower, hand, 0.3) },
      ], BULK.arms),
      { sides: 12, region: R('cuff') },
    );
    if (s > 0) {
      // The marking follows the same shaped sleeve, so cloth crests do not
      // poke through a rigid cylindrical armband.
      const band = anatomicalSleeve(s).filter(r => r.y <= 1.36 && r.y >= 1.30)
        .map(r => ({...r, rx:r.rx+.002, rzF:r.rzF+.002, rzB:(r.rzB ?? r.rzF)+.002}));
      b.loft(band,{sides:20,region:R('strap'),material:1});
    }
    // Palm and four rounded fingers; the thumb is a separate opposable form.
    b.loft([
      {y:.92,cx,rx:.031,rzF:.035,bones:blend(lower,hand,.5)},
      {y:.875,cx,rx:.024,rzF:.048,rzB:.037,n:2.4,bones:only(hand)},
      {y:.815,cx,rx:.024,rzF:.049,rzB:.037,n:2.5,bones:only(hand)},
    ],{sides:12,region:R('glove'),capBottom:true});
    for (let finger=0;finger<4;finger++) {
      const z=-.026+finger*.021;
      const end=.745+Math.abs(finger-1.3)*.009;
      b.loft([
        {y:.83,cx,cz:z,rx:.021,rzF:.010,bones:only(hand)},
        {y:.79,cx:cx-s*.006,cz:z+.003,rx:.019,rzF:.0095,bones:only(hand)},
        {y:end,cx:cx-s*.011,cz:z+.006,rx:.012,rzF:.008,bones:only(hand)},
      ],{sides:8,region:R('glove'),capBottom:true});
    }
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
