/**
 * Recoil (T-2.08): what a shot does to the view.
 *
 * TWO OFFSETS, NEVER A RAY. Recoil moves where the player is LOOKING — a pitch
 * offset and a yaw offset laid on top of the mouse's own accumulators — and
 * the next shot is fired along wherever the view then points, which the
 * server already resolves. Nothing here touches the shot's direction after
 * the trigger, so there is no second spread, no second parity requirement and
 * nothing the server has to know about. That is also why this lives in the
 * client and not `shared`: it is view state, and its recovery curve uses
 * `Math.exp`, which §2.3 bans from the shared simulation for good reason.
 *
 * ON TOP OF THE MOUSE, NOT MIXED INTO IT. The offsets are held apart from the
 * mouse accumulators and added at read time (`LocalInput.setViewOffset`), so
 * recovery pulls the view back by exactly what recoil added and never by what
 * the player moved. Pull down through a burst and the view ends where you
 * put it; the recoil's own climb unwinds underneath. A single merged
 * accumulator cannot tell the two apart and either over-corrects the player's
 * compensation or never recovers at all.
 *
 * A PATTERN, NOT NOISE. The sideways drift of each shot has a seeded sign from
 * the shot's index in the burst, so the same weapon walks the same path every
 * burst and a player can learn it; the magnitudes are per-weapon data. The
 * seed is stateless, like spread's (T-1.17).
 *
 * FRAME-RATE INDEPENDENT recovery, the T-2.02 form: the remaining offset
 * decays by exp(-rate x dt), so 30 and 120 fps traverse the same curve.
 */
import { WIRE_ANGLE_UNITS, type WeaponDef, seedFrom, unitFromSeed } from '@sandline/shared';

/** View offsets in wire angle units (1/1024 turn). Pitch positive is up. */
export interface RecoilState {
  pitch: number;
  yaw: number;
}

export const WIRE_UNITS_PER_DEGREE = WIRE_ANGLE_UNITS / 360;

/** Recovery is "settled" once this fraction of the offset remains. */
export const RECOIL_SETTLE_FRACTION = 0.01;

export function createRecoil(): RecoilState {
  return { pitch: 0, yaw: 0 };
}

/** A stable integer for a weapon id, so each weapon walks its own pattern. */
function weaponSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

/**
 * The kick for one shot, before capping: straight up by the kick, sideways by
 * the drift with a sign seeded from (weapon, shotIndex). Aiming scales both.
 */
export function kickFor(def: WeaponDef, shotIndex: number, ads: boolean): RecoilState {
  const scale = (ads ? def.recoilAdsScale : 1) * WIRE_UNITS_PER_DEGREE;
  const sign = unitFromSeed(seedFrom(weaponSeed(def.id), shotIndex)) < 0.5 ? -1 : 1;
  return { pitch: def.recoilKickDeg * scale, yaw: sign * def.recoilDriftDeg * scale };
}

/**
 * Apply a shot's kick and cap the accumulated climb.
 *
 * The cap is on the pitch — the climb a burst can reach — and on the yaw's
 * wander, both at `recoilMaxDeg`. A burst held past the cap keeps kicking the
 * pattern's sideways drift within it, which is what makes a long burst feel
 * like fighting the weapon rather than watching it stop.
 */
export function applyKick(state: RecoilState, def: WeaponDef, shotIndex: number, ads: boolean): RecoilState {
  const kick = kickFor(def, shotIndex, ads);
  const max = def.recoilMaxDeg * WIRE_UNITS_PER_DEGREE;
  const pitch = Math.min(max, state.pitch + kick.pitch);
  const yaw = Math.max(-max, Math.min(max, state.yaw + kick.yaw));
  return { pitch, yaw };
}

/** Let the offset decay toward zero over `dtSeconds`. */
export function recoverRecoil(state: RecoilState, def: WeaponDef, dtSeconds: number): RecoilState {
  if (!(dtSeconds > 0)) return state;
  const keep = Math.exp(-def.recoilRecoveryPerSec * dtSeconds);
  const pitch = state.pitch * keep;
  const yaw = state.yaw * keep;
  // Snap the tail to zero: a view offset of a millionth of a wire unit is not
  // worth a frame of drift, and it lets "recovered" be an exact question.
  return {
    pitch: Math.abs(pitch) < 1e-6 ? 0 : pitch,
    yaw: Math.abs(yaw) < 1e-6 ? 0 : yaw,
  };
}

/**
 * How long recovery takes to fall to the settle fraction. Derived from the
 * rate rather than fitted to frame counts, so a test can assert against it
 * and a tuning change moves the bound with the number.
 */
export function recoilSettleSeconds(def: WeaponDef, fraction = RECOIL_SETTLE_FRACTION): number {
  if (!(fraction > 0) || fraction >= 1) throw new RangeError('settle fraction must be in (0, 1)');
  return -Math.log(fraction) / def.recoilRecoveryPerSec;
}

/**
 * The view pitch a mouse accumulator and a recoil offset combine to, held
 * within the camera's limits. The mouse value is returned untouched by the
 * caller's own clamp; only the SUM is limited, so recoil at the top of the
 * range cannot push the view past it and cannot eat the player's input.
 */
export function composePitch(mousePitch: number, recoilPitch: number, minPitch: number, maxPitch: number): number {
  const sum = mousePitch + recoilPitch;
  return sum < minPitch ? minPitch : sum > maxPitch ? maxPitch : sum;
}
