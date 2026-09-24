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
import { WIRE_ANGLE_UNITS, type MoveInput, type OrderAddress } from '@sandline/shared';
import { MouseGuard } from './mouseGuard.ts';
import { beginAds, createViewState, endAds, pressShoulderKey, shoulderSide } from './viewState.ts';
import { composePitch } from '../weapons/recoil.ts';
import { armKeyboardLock, requestFullscreenForKeyboardLock } from './keyboardLock.ts';
import { type WheelPointer, type WheelRelease, addressForDigit, moveWheelPointer } from '../ui/OrderWheel.ts';

export interface InputOptions {
  /** Wire-angle units per pixel of mouse movement. */
  sensitivity?: number;
  /** Mouse-down looks up. Off by default; some players want it on. */
  invertY?: boolean;
  /**
   * What goes fullscreen on click. The page root by default, not the canvas:
   * the HUD and crosshair are the canvas's siblings, so fullscreening the
   * canvas alone hid every one of them.
   */
  fullscreenTarget?: Element;
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

/**
 * Hold to aim a grenade, release to throw it (T-2.32). G is the muscle memory
 * a shooter arrives with, which is why the netgraph moved to N for it.
 */
export const THROW_KEY = 'KeyG';

/** Hold for the order wheel, release to give the order (T-3.29). */
export const ORDER_KEY = 'KeyQ';
/** Tap to mark what is under the crosshair (T-3.29). */
export const MARK_KEY = 'KeyF';

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
  /**
   * The trigger came up since the last tick, latched. A held grenade is
   * thrown on the release, so the release is an edge that must not be
   * dropped between two samples either.
   */
  private triggerReleased = false;
  /**
   * The throw key was RELEASED since the last tick, latched (T-2.32).
   *
   * A throw is aimed on the hold and committed on the release, so the release
   * is the edge that matters — and like the trigger's, it can fall entirely
   * between two 30 Hz samples. A tap that threw nothing would read as the
   * grenade being swallowed, which is the same complaint the trigger latch
   * exists to prevent.
   */
  private throwReleased = false;
  /**
   * The order wheel while Q is held (T-3.29): where its pointer is and who
   * will hear the order. Mouse motion goes here instead of the view, so the
   * point under the crosshair stays the one the wheel was opened on.
   */
  private wheel: { pointer: WheelPointer; address: OrderAddress } | null = null;
  /**
   * The wheel as Q came up, latched like the throw's release: a flick that
   * opens, points and releases between two 30 Hz samples still gives its
   * order, and the choice is the one made at the release, not at the sample.
   */
  private wheelReleased: WheelRelease | null = null;
  /** F went down since the last tick, latched: a mark is a tap. */
  private markPressed = false;
  /**
   * Crouch is a toggle (B-06 follow-up), not a held key: it used to be Ctrl,
   * and holding Ctrl while pressing another key (movement, weapon slots)
   * reached the browser as a shortcut instead of the game. C now flips this
   * on keydown, same shape as V's shoulder toggle in viewState.ts.
   *
   * Held Ctrl crouches too, but only while immersive: Keyboard Lock is what
   * keeps Ctrl+W and friends inside the game, and it only holds in
   * fullscreen. See `crouching`.
   */
  private crouchToggled = false;
  /**
   * Prone is a toggle on Z, same shape as crouch. The two are exclusive: Z
   * from crouch goes prone and Z again stands; C from prone goes to crouch.
   */
  private proneToggled = false;
  /**
   * Space pressed to get up out of a toggled stance is a stand, not a jump:
   * the press stops counting as jump until the key comes back up.
   */
  private jumpSuppressed = false;
  private readonly fullscreenTarget: Element | undefined;
  private yawAccum = 0;
  private pitchAccum = 0;
  /**
   * Recoil's view offset (T-2.08), held APART from the mouse accumulators and
   * added at read time. Recovery then pulls the view back by exactly what
   * recoil added, never by what the player moved. See weapons/recoil.ts.
   */
  private offsetYaw = 0;
  private offsetPitch = 0;
  private sensitivity: number;
  private lookScale = 1;
  /** Drops the browser's bogus pointer-lock jumps (QA: the view spun early in a session). */
  readonly mouseGuard = new MouseGuard();
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
    this.fullscreenTarget = options.fullscreenTarget ?? document.documentElement;

    addEventListener('keydown', (e) => {
      // Typing in the lobby's fields is not movement, and Space in a name
      // field must stay a space (T-1.5.06).
      if (isTextField(e.target)) return;
      if (this.releaseKey(e)) return;
      // With the mouse captured, the canvas owns the keyboard: every key we
      // handle gets preventDefault, not just Space. Otherwise Ctrl (crouch)
      // held alongside a movement or weapon key fires whatever browser
      // shortcut that combo happens to be bound to (Find, bookmark, print,
      // ...) instead of reaching the game. A few reserved combos (Ctrl+W,
      // Ctrl+T, Ctrl+N, ...) are blocked by the browser itself and no amount
      // of preventDefault stops them.
      if (this.locked || e.code === 'Space') e.preventDefault();
      this.held.add(e.code);
      this.pressed.add(e.code);
      // Key auto-repeat would flip the shoulder every repeat while V is held.
      if (e.code === 'KeyV' && !e.repeat) pressShoulderKey(this.viewState);
      // Same reason: auto-repeat would flip crouch/prone on and off every
      // repeat while C or Z is held down instead of toggling once per press.
      if (!e.repeat) this.pressStanceKey(e.code);
      if (!e.repeat) this.pressOrderKey(e.code);
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.jumpSuppressed = false;
      // The latch is set on the release of a key that was actually down, so a
      // stray keyup (alt-tab, a key released after a blur) throws nothing.
      if (e.code === THROW_KEY && this.held.has(THROW_KEY)) this.throwReleased = true;
      // Same for the wheel: only a Q that opened it gives an order.
      if (e.code === ORDER_KEY && this.wheel) {
        this.wheelReleased = { pointer: this.wheel.pointer, address: this.wheel.address };
        this.wheel = null;
      }
      this.held.delete(e.code);
    });
    // Losing focus mid-key leaves a key stuck down forever otherwise.
    addEventListener('blur', () => {
      this.held.clear();
      this.buttons.clear();
      this.jumpSuppressed = false;
      // A throw interrupted by losing the window is cancelled, not thrown.
      this.throwReleased = false;
      // And an order: the wheel closes on nothing.
      this.wheel = null;
      this.wheelReleased = null;
      endAds(this.viewState);
    });

    const fullscreenTarget = this.fullscreenTarget;
    if (fullscreenTarget) armKeyboardLock(fullscreenTarget);
    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
      // Same gesture: a click already has user activation, which both
      // requestFullscreen and (via the fullscreenchange listener above)
      // keyboard.lock() need. No-ops where the Keyboard Lock API doesn't
      // exist (Firefox, Safari) — see keyboardLock.ts.
      if (fullscreenTarget) requestFullscreenForKeyboardLock(fullscreenTarget);
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
      if (e.button === 0 && this.buttons.has(0)) this.triggerReleased = true;
      this.buttons.delete(e.button);
      if (e.button === 2) endAds(this.viewState);
    });
    // Taking the lock, going fullscreen and a resize are when browsers report
    // a bogus jump of the hidden cursor; the guard drops it (mouseGuard.ts).
    document.addEventListener('fullscreenchange', () => this.mouseGuard.settle());
    addEventListener('resize', () => this.mouseGuard.settle());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.mouseGuard.settle();
      if (!this.locked) {
        this.held.clear();
        this.buttons.clear();
        this.jumpSuppressed = false;
        this.wheel = null;
        endAds(this.viewState);
      }
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (!this.mouseGuard.accept(e.movementX, e.movementY)) return;
      if (this.wheel) {
        this.wheel.pointer = moveWheelPointer(this.wheel.pointer, e.movementX, e.movementY);
        return;
      }
      const turn = this.sensitivity * this.lookScale;
      this.yawAccum -= e.movementX * turn;
      // Positive pitch means looking UP, so moving the mouse down (movementY
      // positive) must DECREASE it.
      const dy = this.invertY ? -e.movementY : e.movementY;
      this.pitchAccum -= dy * turn;
      this.pitchAccum = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitchAccum));
    });
  }

  /**
   * Stance toggles on a fresh (non-repeat) keydown. C and Z flip their own
   * stance and clear the other; Shift (sprint) and Space (jump) stand up out
   * of either. Held-Ctrl crouch isn't a toggle, so neither cancels it.
   */
  private pressStanceKey(code: string): void {
    if (code === 'KeyC') {
      this.crouchToggled = this.proneToggled ? true : !this.crouchToggled;
      this.proneToggled = false;
    } else if (code === 'KeyZ') {
      this.proneToggled = !this.proneToggled;
      this.crouchToggled = false;
    } else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'Space') {
      const wasDown = this.crouchToggled || this.proneToggled;
      this.crouchToggled = false;
      this.proneToggled = false;
      if (code === 'Space' && wasDown) {
        this.jumpSuppressed = true;
        this.pressed.delete('Space');
      }
    }
  }

  /**
   * Q opens the wheel, pointed nowhere and addressed to everyone; a number
   * key while it is open readdresses it; F latches a mark.
   */
  private pressOrderKey(code: string): void {
    if (code === ORDER_KEY) this.wheel = { pointer: { dx: 0, dy: 0 }, address: { to: 'all' } };
    else if (code === MARK_KEY) this.markPressed = true;
    else if (this.wheel && code.startsWith('Digit')) {
      const address = addressForDigit(Number.parseInt(code.slice(5), 10));
      if (address) this.wheel.address = address;
    }
  }

  /**
   * Escape and F11 hand the mouse back on a single press. Keyboard Lock
   * (keyboardLock.ts) captures every key, Escape included, so without this
   * the browser only lets go of the pointer and fullscreen after Escape is
   * HELD for two seconds, and F11 does nothing at all. Escape frees the
   * mouse and stays fullscreen; F11 leaves fullscreen too. The next click
   * on the canvas takes both back, as it always has. Where the lock isn't
   * active the browser already does this itself and these calls no-op.
   */
  private releaseKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      document.exitPointerLock?.();
      return true;
    }
    if (e.code === 'F11') {
      // Only when the page itself is fullscreen: otherwise F11 is the
      // browser's own fullscreen toggle and stays the browser's.
      if (document.fullscreenElement) {
        e.preventDefault();
        document.exitFullscreen?.().catch(() => {});
      }
      document.exitPointerLock?.();
      return true;
    }
    return false;
  }

  setSensitivity(value: number): void {
    this.sensitivity = value;
  }

  /**
   * A multiplier on the look, for a magnified view: through a scope the
   * same mouse travel should move the reticle across the same share of the
   * picture, so the page scales the turn by the zoom.
   */
  setLookScale(value: number): void {
    this.lookScale = Number.isFinite(value) && value > 0 ? value : 1;
  }

  setInvertY(value: boolean): void {
    this.invertY = value;
  }

  /** True while the page is the fullscreen element, i.e. Keyboard Lock (if supported) is armed. */
  get immersive(): boolean {
    return this.fullscreenTarget !== undefined && document.fullscreenElement === this.fullscreenTarget;
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

  /** Lay a view offset over the mouse's own: recoil, in wire units. */
  setViewOffset(yaw: number, pitch: number): void {
    this.offsetYaw = yaw;
    this.offsetPitch = pitch;
  }

  /** The pitch the player sees: mouse plus offset, held within the limits. */
  private get viewPitch(): number {
    return composePitch(this.pitchAccum, this.offsetPitch, this.minPitch, this.maxPitch);
  }

  /** Pitch as -1..1 across its current range, for camera distance shaping. */
  get pitchFraction(): number {
    const pitch = this.viewPitch;
    const limit = pitch >= 0 ? this.maxPitch : -this.minPitch;
    return limit === 0 ? 0 : pitch / limit;
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

  /**
   * Whether the trigger came up since the last call, and clear the latch.
   * Call exactly once per tick, like `consumeTriggerEdge`.
   */
  consumeTriggerRelease(): boolean {
    const released = this.triggerReleased;
    this.triggerReleased = false;
    return released;
  }

  /** Current crouch intent; the locomotion classifier consumes the rendered result plus this visual state. */
  get crouching(): boolean {
    const ctrlHeld = this.held.has('ControlLeft') || this.held.has('ControlRight');
    return this.crouchToggled || (this.immersive && ctrlHeld);
  }

  /**
   * Current prone intent (T-2.40, ADR-016): a toggle on Z, like crouch on C.
   * Takes priority over crouch in the controller.
   */
  get proning(): boolean {
    return this.proneToggled;
  }

  /** Holding the throw key: the arc is being aimed (T-2.32). */
  get throwHeld(): boolean {
    return this.held.has(THROW_KEY);
  }

  /**
   * Whether the throw key came up since the last call, and clear the latch.
   * Call exactly once per tick, like `consumeTriggerEdge`.
   */
  consumeThrowRelease(): boolean {
    const released = this.throwReleased;
    this.throwReleased = false;
    return released;
  }

  /** The wheel while Q is held, for drawing; null when it is closed. */
  get orderWheel(): { readonly pointer: WheelPointer; readonly address: OrderAddress } | null {
    return this.wheel;
  }

  /**
   * The wheel as Q came up since the last call, and clear the latch. Call
   * exactly once per tick, like `consumeThrowRelease`.
   */
  consumeOrderRelease(): WheelRelease | null {
    const released = this.wheelReleased;
    this.wheelReleased = null;
    return released;
  }

  /** Whether F went down since the last call, and clear the latch. */
  consumeMarkPress(): boolean {
    const pressed = this.markPressed;
    this.markPressed = false;
    return pressed;
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
    return this.viewPitch;
  }

  /**
   * Pitch wrapped into the unsigned 0..1023 the wire carries. Pitch
   * accumulates signed so the limits can be asymmetric, but a wire angle is a
   * position on a circle and has no sign.
   */
  get pitchWire(): number {
    const units = WIRE_ANGLE_UNITS;
    return ((Math.round(this.viewPitch) % units) + units) % units;
  }

  /**
   * Yaw for the camera: wrapped to 0..1024 but NOT rounded. The wire and the
   * simulation take whole units (`yaw`); the view follows the mouse at full
   * resolution, or turning steps 0.35 degrees at a time while everything
   * else moves smoothly.
   */
  get viewYaw(): number {
    const yaw = (this.yawAccum + this.offsetYaw) % WIRE_ANGLE_UNITS;
    return yaw < 0 ? yaw + WIRE_ANGLE_UNITS : yaw;
  }

  get yaw(): number {
    const yaw = this.yawAccum + this.offsetYaw;
    return ((Math.round(yaw) % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS;
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
      jump: !this.jumpSuppressed && tapped('Space'),
      sprint: on('ShiftLeft', 'ShiftRight'),
      crouch: this.crouching,
      prone: this.proning,
      interact: on('KeyE'),
      // Carried so the server can refuse a vault mid-burst (T-2.21).
      firing: this.firing,
    };
    this.pressed.clear();
    return input;
  }
}
