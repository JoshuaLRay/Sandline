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
  private yawAccum = 0;
  private pitchAccum = 0;
  private sensitivity: number;
  locked = false;

  constructor(
    private readonly canvas: HTMLElement,
    options: InputOptions = {},
  ) {
    this.sensitivity = options.sensitivity ?? 0.55;

    addEventListener('keydown', (e) => {
      // Space would otherwise scroll the page out from under the canvas.
      if (e.code === 'Space') e.preventDefault();
      this.held.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    // Losing focus mid-key leaves a key stuck down forever otherwise.
    addEventListener('blur', () => this.held.clear());

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.held.clear();
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yawAccum -= e.movementX * this.sensitivity;
      this.pitchAccum -= e.movementY * this.sensitivity;
      const limit = WIRE_ANGLE_UNITS / 5; // ~72 degrees up and down
      this.pitchAccum = Math.max(-limit, Math.min(limit, this.pitchAccum));
    });
  }

  setSensitivity(value: number): void {
    this.sensitivity = value;
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
