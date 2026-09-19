/**
 * Keyboard and mouse input to MoveInput (T-1.11 companion, local-only).
 *
 * Produces exactly the struct the server consumes, so when prediction lands
 * (T-1.14) this same input drives the networked path with no rewrite.
 *
 * Yaw is accumulated in WIRE ANGLE units (1/1024 turn), not radians, because
 * that is what the simulation and the trig table use (ADR-014). Converting to
 * radians here and back later would reintroduce the float drift the table
 * exists to avoid.
 */
import { WIRE_ANGLE_UNITS, type MoveInput } from '@sandline/shared';
import { beginAds, createViewState, endAds, pressShoulderKey, shoulderSide } from './viewState.ts';

export interface InputOptions {
  /** Wire-angle units per pixel of mouse movement. */
  sensitivity?: number;
  /** Mouse-down looks up. Off by default; some players want it on. */
  invertY?: boolean;
}

const UNITS_PER_DEGREE = WIRE_ANGLE_UNITS / 360;

/**
 * Pitch limits, in degrees.
 *
 * Up is 89, i.e. as near straight up as is safe, by request after QA. NOT 90:
 * at exactly vertical the view direction is parallel to the world up axis, and
 * anything deriving a camera basis from those two (a `lookAt`, most spring
 * arms) is then solving for a roll that has no answer. One degree of margin
 * costs nothing visible and keeps every such construction well-conditioned.
 *
 * Down stays at 80. It was never the complaint, and ground is what a
 * third-person shooter actually needs to see.
 */
export const PITCH_LIMIT_UP_DEG = 89;
export const PITCH_LIMIT_DOWN_DEG = 80;
export const PITCH_LIMIT_FIRST_PERSON_DEG = 89;

/** True while a text field has focus: keys typed there are not game input. */
export function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export class LocalInput {
  private readonly held = new Set<string>();
  /**
   * Keys pressed since the last sample, even if already released.
   *
   * Input is sampled once per 30 Hz tick, so a tap shorter than 33 ms can land
   * entirely between two samples and be dropped. Latching the press guarantees
   * a quick jump tap always registers — dropped jumps are among the most
   * infuriating bugs in a shooter, and the fix costs nothing.
   */
  private readonly pressed = new Set<string>();
  /**
   * Mouse buttons currently held, tracked only while the pointer is locked.
   *
   * The click that CAPTURES the pointer must not also fire the weapon, or every
   * tester loses a round walking back into the window. Pointer lock arrives
   * asynchronously, so `locked` is already false on that first mousedown and
   * the button is simply not recorded.
   */
  private readonly buttons = new Set<number>();
  /**
   * Trigger pulls since the last tick, latched.
   *
   * Same reason jump is latched: input is sampled at 30 Hz, so a click shorter
   * than 33 ms can land entirely between two samples. On a semi-automatic that
   * is a shot that simply never happens, which reads as the gun being broken.
   */
  private triggerEdge = false;
  private yawAccum = 0;
  private pitchAccum = 0;
  private sensitivity: number;
  private invertY: boolean;
  /** Explicit camera/shoulder/ADS state. ADS changes camera mode but never the stored shoulder. */
  private readonly viewState = createViewState();
  locked = false;

  constructor(
    private readonly canvas: HTMLElement,
    options: InputOptions = {},
  ) {
    this.sensitivity = options.sensitivity ?? 0.55;
    this.invertY = options.invertY ?? false;

    addEventListener('keydown', (e) => {
      // Typing in the lobby's fields is not movement, and Space in a name
      // field must stay a space (T-1.5.06).
      if (isTextField(e.target)) return;
      // Space would otherwise scroll the page out from under the canvas.
      if (e.code === 'Space') e.preventDefault();
      this.held.add(e.code);
      this.pressed.add(e.code);
      // Key auto-repeat would flip the shoulder every repeat while V is held.
      if (e.code === 'KeyV' && !e.repeat) pressShoulderKey(this.viewState);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    // Losing focus mid-key leaves a key stuck down forever otherwise.
    addEventListener('blur', () => {
      this.held.clear();
      this.buttons.clear();
      endAds(this.viewState);
    });

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    // Right mouse is aim-down-sights; without this it opens a context menu
    // over the canvas instead.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      if (e.button === 0) this.triggerEdge = true;
      if (e.button === 2) beginAds(this.viewState);
    });
    addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
      if (e.button === 2) endAds(this.viewState);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.held.clear();
        this.buttons.clear();
        endAds(this.viewState);
      }
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yawAccum -= e.movementX * this.sensitivity;
      // Positive pitch means looking UP, so moving the mouse down (movementY
      // positive) must DECREASE it.
      const dy = this.invertY ? -e.movementY : e.movementY;
      this.pitchAccum -= dy * this.sensitivity;
      this.pitchAccum = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitchAccum));
    });
  }

  setSensitivity(value: number): void {
    this.sensitivity = value;
  }

  setInvertY(value: boolean): void {
    this.invertY = value;
  }

  /** Current stored TPS shoulder: +1 right, -1 left. */
  get shoulderSide(): 1 | -1 {
    return shoulderSide(this.viewState);
  }

  /** Camera mode. ADS enters FPS; releasing ADS does not leave FPS. */
  get firstPerson(): boolean {
    return this.viewState.cameraMode === 'FPS';
  }

  get maxPitch(): number {
    const deg = this.firstPerson ? PITCH_LIMIT_FIRST_PERSON_DEG : PITCH_LIMIT_UP_DEG;
    return deg * UNITS_PER_DEGREE;
  }

  get minPitch(): number {
    const deg = this.firstPerson ? PITCH_LIMIT_FIRST_PERSON_DEG : PITCH_LIMIT_DOWN_DEG;
    return -deg * UNITS_PER_DEGREE;
  }

  /** Pitch as -1..1 across its current range, for camera distance shaping. */
  get pitchFraction(): number {
    const limit = this.pitchAccum >= 0 ? this.maxPitch : -this.minPitch;
    return limit === 0 ? 0 : this.pitchAccum / limit;
  }

  /**
   * Whether the trigger went down since the last call, and clear the latch.
   * Call exactly once per tick — a second call in the same tick reads false.
   */
  consumeTriggerEdge(): boolean {
    const edge = this.triggerEdge;
    this.triggerEdge = false;
    return edge;
  }

  /** Left mouse held: pull the trigger. Cadence is the weapon's, not the mouse's. */
  get firing(): boolean {
    return this.buttons.has(0);
  }

  /** Right mouse held: aim down sights and enter FPS when starting from TPS. */
  get ads(): boolean {
    return this.viewState.adsActive;
  }

  /** Camera pitch in wire-angle units, signed. Not sent to the simulation. */
  get pitch(): number {
    return this.pitchAccum;
  }

  /**
   * Pitch wrapped into the unsigned 0..1023 the wire carries. Pitch
   * accumulates signed so the limits can be asymmetric, but a wire angle is a
   * position on a circle and has no sign.
   */
  get pitchWire(): number {
    const units = WIRE_ANGLE_UNITS;
    return ((Math.round(this.pitchAccum) % units) + units) % units;
  }

  get yaw(): number {
    return ((Math.round(this.yawAccum) % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS;
  }

  sample(): MoveInput {
    const on = (...codes: string[]): boolean => codes.some((c) => this.held.has(c));
    // Edge-triggered: true if held now OR tapped since the last sample.
    const tapped = (...codes: string[]): boolean =>
      codes.some((c) => this.held.has(c) || this.pressed.has(c));
    const forward = (on('KeyW', 'ArrowUp') ? 1 : 0) - (on('KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (on('KeyD', 'ArrowRight') ? 1 : 0) - (on('KeyA', 'ArrowLeft') ? 1 : 0);
    const input: MoveInput = {
      moveX: strafe,
      moveY: forward,
      yaw: this.yaw,
      jump: tapped('Space'),
      sprint: on('ShiftLeft', 'ShiftRight'),
      crouch: on('ControlLeft', 'ControlRight', 'KeyC'),
    };
    this.pressed.clear();
    return input;
  }
}
