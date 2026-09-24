/**
 * The period weapons (T-4.36; ADR-020, `docs/art/direction.md`), each in its
 * aim space and fitted to the grips and sight that `weaponModels.ts` already
 * gives its loadout id. The hold, the viewmodel and the muzzle rig are
 * unchanged; only what is held changes.
 *
 *   squad   carbine → M4 carbine        enemy   carbine → AK-pattern rifle
 *           marksman → scoped DMR                lmg     → PKM
 *           breacher → pump shotgun, pistol grip rocket  → RPG-7
 *           sidearm  → service pistol
 *           frag     → M67 grenade
 *           rocket   → AT4
 *           lmg      → M249
 *
 * Generic to the period, with no manufacturer's marks (ADR-020).
 */
import { type BuiltMesh, WeaponBuilder } from './mesh.ts';

type Build = (b: WeaponBuilder) => void;

/** The M4's lower half and stock, shared with the DMR: buffer tube, stock, lower, grip, magazine, well. */
function arLower(b: WeaponBuilder): void {
  b.lathe([
    [0.03, 0.016],
    [0.2, 0.016],
  ], 10, 'steel', 0);
  b.extrude([
    [0, -0.075],
    [0.028, -0.075],
    [0.09, -0.038],
    [0.165, -0.022],
    [0.165, 0.03],
    [0.02, 0.034],
    [0, 0.032],
  ], 0.02, 'polymer');
  b.box([-0.021, -0.076, -0.003], [0.021, 0.035, 0.012], 'rubber');
  b.extrude([
    [0.155, -0.046],
    [0.34, -0.046],
    [0.346, -0.01],
    [0.155, -0.006],
  ], 0.018, 'steel');
  b.extrude([
    [0.148, -0.046],
    [0.19, -0.046],
    [0.176, -0.142],
    [0.14, -0.137],
  ], 0.015, 'polymer');
  b.box([-0.004, -0.078, 0.19], [0.004, -0.072, 0.25], 'steel');
  b.box([-0.004, -0.078, 0.244], [0.004, -0.046, 0.25], 'steel');
  b.box([-0.02, -0.074, 0.25], [0.02, -0.046, 0.318], 'steel');
  b.extrude([
    [0.254, -0.074],
    [0.312, -0.074],
    [0.33, -0.205],
    [0.272, -0.21],
  ], 0.014, 'steel');
}

/** The M4's upper: receiver, charging handle, ejection port and forward assist. */
function arUpper(b: WeaponBuilder): void {
  b.extrude([
    [0.155, -0.008],
    [0.4, -0.008],
    [0.4, 0.034],
    [0.165, 0.039],
  ], 0.02, 'steel');
  b.box([-0.026, 0.022, 0.148], [0.026, 0.036, 0.17], 'steel');
  b.box([-0.023, 0.004, 0.27], [-0.02, 0.026, 0.33], 'steel');
  b.lathe([
    [0.2, 0.008],
    [0.24, 0.008],
  ], 8, 'steel', 0.022, -0.024);
}

const M4: Build = (b) => {
  arLower(b);
  arUpper(b);
  // The carry handle, its rear sight where the eye looks through it.
  b.extrude([
    [0.2, 0.034],
    [0.232, 0.034],
    [0.226, 0.066],
    [0.2, 0.066],
  ], 0.012, 'steel');
  b.extrude([
    [0.33, 0.034],
    [0.36, 0.034],
    [0.36, 0.066],
    [0.336, 0.066],
  ], 0.012, 'steel');
  b.box([-0.012, 0.062, 0.2], [0.012, 0.076, 0.36], 'steel');
  b.box([-0.01, 0.076, 0.245], [0.01, 0.089, 0.268], 'steel');
  // Handguard, its cap and the delta ring; the front sight's base and post; the barrel and flash hider.
  b.lathe([
    [0.398, 0.036],
    [0.412, 0.036],
  ], 14, 'steel', 0);
  b.lathe([
    [0.41, 0.028],
    [0.416, 0.032],
    [0.55, 0.032],
    [0.556, 0.027],
  ], 14, 'polymer', 0);
  b.lathe([
    [0.555, 0.016],
    [0.59, 0.016],
  ], 10, 'steel', 0);
  b.extrude([
    [0.56, 0.012],
    [0.592, 0.012],
    [0.582, 0.05],
    [0.578, 0.078],
    [0.573, 0.078],
    [0.57, 0.05],
  ], 0.007, 'steel');
  b.lathe([
    [0.59, 0.0095],
    [0.78, 0.0085],
  ], 10, 'steel', 0);
  b.lathe([
    [0.775, 0.012],
    [0.82, 0.012],
  ], 8, 'steel', 0);
};

const DMR: Build = (b) => {
  arLower(b);
  arUpper(b);
  // A flat-top rail, a free-float tube, a long barrel, a telescopic sight on rings, a bipod folded under.
  b.box([-0.012, 0.039, 0.17], [0.012, 0.05, 0.4], 'rail');
  b.lathe([
    [0.4, 0.031],
    [0.68, 0.031],
  ], 14, 'steel', 0.005);
  b.box([-0.012, 0.036, 0.4], [0.012, 0.045, 0.66], 'rail');
  b.lathe([
    [0.68, 0.011],
    [1.0, 0.0105],
  ], 10, 'steel', 0);
  b.lathe([
    [0.99, 0.014],
    [1.03, 0.014],
  ], 8, 'steel', 0);
  b.lathe([
    [0.215, 0.026],
    [0.232, 0.032],
    [0.27, 0.021],
    [0.47, 0.021],
    [0.505, 0.033],
    [0.56, 0.033],
  ], 16, 'steel', 0.085);
  b.lathe([
    [0.212, 0.022],
    [0.216, 0.022],
  ], 12, 'glass', 0.085);
  for (const z of [0.29, 0.44]) b.box([-0.014, 0.045, z], [0.014, 0.068, z + 0.03], 'steel');
  for (const x of [-0.014, 0.014]) b.lathe([
    [0.62, 0.007],
    [0.9, 0.006],
  ], 6, 'steel', -0.04, x);
};

const SHOTGUN: Build = (b) => {
  b.extrude([
    [0, -0.1],
    [0.022, -0.1],
    [0.205, -0.042],
    [0.21, 0.03],
    [0.18, 0.036],
    [0, -0.018],
  ], 0.021, 'polymer');
  b.box([-0.022, -0.102, -0.004], [0.022, -0.016, 0.01], 'rubber');
  // A breacher's pistol grip behind the trigger.
  b.extrude([
    [0.19, -0.042],
    [0.228, -0.042],
    [0.214, -0.132],
    [0.18, -0.127],
  ], 0.015, 'polymer');
  b.extrude([
    [0.2, -0.042],
    [0.43, -0.042],
    [0.43, 0.034],
    [0.21, 0.04],
  ], 0.022, 'steel');
  b.box([-0.005, -0.072, 0.21], [0.005, -0.066, 0.28], 'steel');
  b.box([-0.005, -0.072, 0.274], [0.005, -0.042, 0.28], 'steel');
  b.lathe([
    [0.43, 0.017],
    [0.9, 0.016],
  ], 12, 'steel', 0.018);
  b.lathe([
    [0.43, 0.013],
    [0.82, 0.013],
  ], 10, 'steel', -0.027);
  b.lathe([
    [0.33, 0.024],
    [0.336, 0.028],
    [0.5, 0.028],
    [0.506, 0.024],
  ], 12, 'polymer', -0.027);
  b.box([-0.004, 0.034, 0.87], [0.004, 0.046, 0.878], 'brass');
};

const PISTOL: Build = (b) => {
  b.extrude([
    [0.305, -0.008],
    [0.495, -0.008],
    [0.5, 0.012],
    [0.49, 0.022],
    [0.31, 0.022],
  ], 0.015, 'steel');
  b.extrude([
    [0.31, -0.03],
    [0.47, -0.03],
    [0.47, -0.008],
    [0.31, -0.008],
  ], 0.014, 'steel');
  b.extrude([
    [0.305, -0.03],
    [0.348, -0.03],
    [0.337, -0.137],
    [0.29, -0.132],
  ], 0.016, 'polymer');
  b.box([-0.004, -0.06, 0.35], [0.004, -0.054, 0.4], 'steel');
  b.box([-0.004, -0.06, 0.395], [0.004, -0.03, 0.4], 'steel');
  b.lathe([
    [0.49, 0.006],
    [0.505, 0.006],
  ], 8, 'steel', 0.002);
  b.box([-0.003, 0.022, 0.482], [0.003, 0.03, 0.488], 'steel');
  b.box([-0.011, 0.022, 0.31], [0.011, 0.031, 0.32], 'steel');
};

const GRENADE: Build = (b) => {
  // The M67's round body along the throw, its fuze, spoon and pull ring.
  b.lathe([
    [0.158, 0.001],
    [0.163, 0.022],
    [0.176, 0.036],
    [0.2, 0.043],
    [0.224, 0.036],
    [0.237, 0.022],
    [0.242, 0.001],
  ], 14, 'olive', -0.04);
  b.box([-0.011, -0.003, 0.19], [0.011, 0.022, 0.21], 'steel');
  b.extrude([
    [0.19, 0.022],
    [0.21, 0.022],
    [0.21, -0.02],
    [0.204, -0.07],
    [0.198, -0.07],
    [0.196, -0.02],
  ], 0.003, 'steel', -0.024);
  b.lathe([
    [0.194, 0.011],
    [0.206, 0.011],
  ], 8, 'steel', 0.012, 0.018, false);
};

const AT4: Build = (b) => {
  b.lathe([
    [-0.35, 0.046],
    [-0.31, 0.046],
    [-0.305, 0.042],
    [0.6, 0.042],
    [0.605, 0.046],
    [0.65, 0.046],
  ], 16, 'label', 0.08);
  b.lathe([
    [-0.37, 0.047],
    [-0.35, 0.047],
  ], 16, 'rubber', 0.08);
  b.lathe([
    [0.65, 0.047],
    [0.67, 0.047],
  ], 16, 'rubber', 0.08);
  b.extrude([
    [0.1, 0.04],
    [0.145, 0.04],
    [0.13, -0.075],
    [0.098, -0.072],
  ], 0.014, 'polymer');
  b.extrude([
    [0.36, 0.04],
    [0.4, 0.04],
    [0.39, -0.06],
    [0.36, -0.06],
  ], 0.014, 'polymer');
  b.box([0.046, 0.1, 0.17], [0.09, 0.14, 0.25], 'steel');
  b.box([0.05, 0.105, 0.196], [0.086, 0.135, 0.2], 'glass');
};

const M249: Build = (b) => {
  b.extrude([
    [0, -0.08],
    [0.03, -0.08],
    [0.18, -0.03],
    [0.18, 0.04],
    [0.02, 0.04],
    [0, 0.03],
  ], 0.022, 'polymer');
  b.extrude([
    [0.17, -0.05],
    [0.5, -0.05],
    [0.5, 0.045],
    [0.26, 0.055],
    [0.17, 0.045],
  ], 0.03, 'steel');
  b.box([-0.032, 0.045, 0.26], [0.032, 0.062, 0.44], 'steel');
  b.extrude([
    [0.15, -0.05],
    [0.19, -0.05],
    [0.176, -0.145],
    [0.14, -0.14],
  ], 0.015, 'polymer');
  // The 200-round box hanging under the left of the receiver.
  b.box([-0.03, -0.19, 0.28], [0.075, -0.05, 0.42], 'olive');
  b.box([-0.012, 0.07, 0.46], [0.012, 0.09, 0.56], 'polymer');
  for (const z of [0.47, 0.55]) b.box([-0.01, 0.045, z], [0.01, 0.07, z + 0.012], 'steel');
  b.lathe([
    [0.5, 0.034],
    [0.66, 0.034],
  ], 14, 'polymer', 0.0);
  b.lathe([
    [0.5, 0.013],
    [0.9, 0.012],
  ], 10, 'steel', 0.012);
  b.lathe([
    [0.5, 0.009],
    [0.74, 0.009],
  ], 8, 'steel', -0.028);
  b.lathe([
    [0.89, 0.016],
    [0.94, 0.016],
  ], 8, 'steel', 0.012);
  b.box([-0.005, 0.02, 0.85], [0.005, 0.075, 0.87], 'steel');
  for (const x of [-0.016, 0.016]) b.lathe([
    [0.68, 0.007],
    [0.88, 0.006],
  ], 6, 'steel', -0.04, x);
};

const AK: Build = (b) => {
  b.extrude([
    [0, -0.095],
    [0.028, -0.1],
    [0.175, -0.035],
    [0.2, -0.015],
    [0.2, 0.02],
    [0.16, 0.026],
    [0, -0.02],
  ], 0.021, 'laminate');
  b.box([-0.022, -0.102, -0.004], [0.022, -0.018, 0.01], 'steel');
  b.extrude([
    [0.19, -0.042],
    [0.45, -0.042],
    [0.45, 0.028],
    [0.21, 0.034],
  ], 0.021, 'steel');
  b.extrude([
    [0.178, -0.042],
    [0.212, -0.042],
    [0.196, -0.132],
    [0.164, -0.127],
  ], 0.015, 'laminate');
  // The curved thirty-round magazine.
  b.extrude([
    [0.282, -0.042],
    [0.334, -0.042],
    [0.348, -0.1],
    [0.372, -0.17],
    [0.394, -0.226],
    [0.35, -0.24],
    [0.328, -0.184],
    [0.304, -0.112],
  ], 0.015, 'steel');
  b.box([-0.005, -0.072, 0.22], [0.005, -0.066, 0.28], 'steel');
  b.box([-0.012, 0.028, 0.45], [0.012, 0.05, 0.5], 'steel');
  b.lathe([
    [0.45, 0.028],
    [0.456, 0.032],
    [0.61, 0.03],
    [0.616, 0.026],
  ], 12, 'laminate', -0.006);
  b.lathe([
    [0.46, 0.017],
    [0.62, 0.016],
  ], 10, 'laminate', 0.034);
  b.lathe([
    [0.61, 0.01],
    [0.8, 0.0095],
  ], 10, 'steel', 0.0);
  b.extrude([
    [0.72, -0.01],
    [0.76, -0.01],
    [0.755, 0.05],
    [0.73, 0.06],
  ], 0.01, 'steel');
  b.lathe([
    [0.8, 0.012],
    [0.83, 0.011],
  ], 8, 'steel', 0);
};

const PKM: Build = (b) => {
  // The skeleton stock as its three bars, the butt, the receiver, the box on the right, a long barrel.
  b.box([-0.018, -0.095, -0.004], [0.018, 0.025, 0.035], 'laminate');
  b.box([-0.012, 0.005, 0.03], [0.012, 0.025, 0.2], 'laminate');
  b.extrude([
    [0.03, -0.095],
    [0.06, -0.095],
    [0.2, -0.035],
    [0.2, -0.015],
    [0.17, -0.015],
    [0.03, -0.07],
  ], 0.012, 'laminate');
  b.extrude([
    [0.19, -0.045],
    [0.5, -0.045],
    [0.5, 0.045],
    [0.22, 0.05],
  ], 0.03, 'steel');
  b.extrude([
    [0.178, -0.045],
    [0.212, -0.045],
    [0.196, -0.135],
    [0.164, -0.13],
  ], 0.015, 'laminate');
  b.box([-0.11, -0.16, 0.26], [-0.03, -0.04, 0.4], 'steel');
  b.box([-0.012, 0.05, 0.5], [0.012, 0.085, 0.58], 'laminate');
  b.lathe([
    [0.5, 0.014],
    [0.96, 0.012],
  ], 10, 'steel', 0.01);
  b.lathe([
    [0.5, 0.009],
    [0.72, 0.009],
  ], 8, 'steel', -0.025);
  b.lathe([
    [0.95, 0.017],
    [1.0, 0.015],
  ], 8, 'steel', 0.01);
  b.box([-0.005, 0.02, 0.9], [0.005, 0.07, 0.92], 'steel');
  for (const x of [-0.016, 0.016]) b.lathe([
    [0.7, 0.007],
    [0.92, 0.006],
  ], 6, 'steel', -0.04, x);
};

const RPG7: Build = (b) => {
  // The launcher tube with its flared venturi, the wooden heat guard, grips, the optic, the warhead in the muzzle.
  b.lathe([
    [-0.42, 0.045],
    [-0.36, 0.034],
    [-0.32, 0.024],
    [0.5, 0.022],
  ], 14, 'steel', 0.08);
  b.lathe([
    [-0.05, 0.032],
    [0.3, 0.032],
  ], 14, 'walnut', 0.08);
  b.extrude([
    [0.1, 0.058],
    [0.145, 0.058],
    [0.13, -0.075],
    [0.098, -0.072],
  ], 0.014, 'steel');
  b.extrude([
    [0.36, 0.058],
    [0.4, 0.058],
    [0.39, -0.06],
    [0.36, -0.06],
  ], 0.014, 'walnut');
  b.box([0.03, 0.1, 0.16], [0.09, 0.14, 0.24], 'steel');
  b.box([0.05, 0.106, 0.196], [0.086, 0.134, 0.2], 'glass');
  b.lathe([
    [0.5, 0.02],
    [0.54, 0.043],
    [0.72, 0.045],
    [0.8, 0.032],
    [0.87, 0.012],
    [0.91, 0.004],
  ], 16, 'warhead', 0.08);
};

export const WEAPONS: Readonly<Record<string, Build>> = {
  m4: M4,
  dmr: DMR,
  shotgun: SHOTGUN,
  pistol: PISTOL,
  m67: GRENADE,
  at4: AT4,
  m249: M249,
  ak: AK,
  pkm: PKM,
  rpg7: RPG7,
};

export function buildWeapon(key: string): BuiltMesh {
  const build = WEAPONS[key];
  if (!build) throw new Error(`no weapon '${key}'`);
  const b = new WeaponBuilder();
  build(b);
  return b.build();
}
