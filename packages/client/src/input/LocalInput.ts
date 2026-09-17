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
 * Asymmetric on purpose: you want to see more ground than sky in a
 * third-person shooter, and the previous symmetric ~72 degrees felt short
 * looking down. First person gets a wider range because nothing occludes it.
 */
export const PITCH_LIMIT_UP_DEG = 60;
export const PITCH_LIMIT_DOWN_DEG = 80;
export const PITCH_LIMIT_FIRST_PERSON_DEG = 85;

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
  private yawAccum = 0;
  private pitchAccum = 0;
  private sensitivity: number;
  private invertY: boolean;
  /** First person removes the occlusion that limits third-person pitch. */
  firstPerson = false;
  locked = false;

  constructor(
    private readonly canvas: HTMLElement,
    options: InputOptions = {},
  ) {
    this.sensitivity = options.sensitivity ?? 0.55;
    this.invertY = options.invertY ?? false;

    addEventListener('keydown', (e) => {
      // Space would otherwise scroll the page out from under the canvas.
      if (e.code === 'Space') e.preventDefault();
      this.held.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    // Losing focus mid-key leaves a key stuck down forever otherwise.
    addEventListener('blur', () => {
      this.held.clear();
      this.buttons.clear();
    });

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    // Right mouse is aim-down-sights; without this it opens a context menu
    // over the canvas instead.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousedown', (e) => {
      if (this.locked) this.buttons.add(e.button);
    });
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.held.clear();
        this.buttons.clear();
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

  /** Left mouse held: pull the trigger. Cadence is the weapon's, not the mouse's. */
  get firing(): boolean {
    return this.buttons.has(0);
  }

  /** Right mouse held: aim down sights, which tightens the cone. */
  get ads(): boolean {
    return this.buttons.has(2);
  }

  /** Camera pitch in wire-angle units. Not sent to the simulation. */
  get pitch(): number {
    return this.pitchAccum;
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
