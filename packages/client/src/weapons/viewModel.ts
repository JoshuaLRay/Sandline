/**
 * The weapon in hand, in first person.
 *
 * The body is hidden in first person — the camera sits inside the head — so
 * without this the view is a crosshair floating over nothing. This draws the
 * held item and the two forearms holding it, from the same models the
 * third-person body carries (`weaponModels.ts`), so the carbine you see down
 * the sight is the carbine everyone else sees on your shoulder.
 *
 * ITS OWN SCENE AND CAMERA, drawn after the world over a cleared depth
 * buffer. The classic viewmodel arrangement, for the two reasons it has
 * always existed: a rifle held 20 cm from the eye would otherwise poke
 * through every wall the player stands against, and the world camera's near
 * plane (0.1 m) would slice the stock off. The viewmodel camera keeps a fixed
 * field of view, so the ADS zoom narrows the world and not the gun.
 *
 * The viewmodel camera never moves: the scene is lit and laid out in view
 * space, so the gun is lit the same whichever way the player looks.
 *
 * Presentation only. The shot still leaves from the eye and the reticle is
 * still the truth; nothing here moves an aim.
 */
import * as THREE from 'three';
import { SCOPE_IN } from '../ui/scopeOverlay.ts';
import { type ReloadPose, REST_POSE, reloadPose, settle } from './reloadPose.ts';
import {
  MAGAZINE_AXIS,
  MAGAZINE_HOLD,
  type WeaponModel,
  type Vec3Tuple,
  createWeaponModel,
  weaponAssetsVersion,
  weaponMagazine,
  weaponMuzzle,
} from './weaponModels.ts';

export interface ViewModelState {
  /** Draw it at all: first person, alive, not mid-vault. */
  visible: boolean;
  /** Loadout id in hand (weapons.json or projectiles.json). */
  held: string;
  /** Aiming down the sight. */
  ads: boolean;
  /** Aiming a grenade: it is drawn back, ready to throw. */
  winding: boolean;
  /** The fire layer's kick: metres back, and radians of muzzle rise (weaponKick.ts). */
  kickBack: number;
  kickUp: number;
  /** 0..1 through a reload, on the weapon's own reload clock; 0 when none (U-006: `reloadPose.ts`). */
  reload: number;
  /** Horizontal speed, m/s, for the walk bob. */
  speed: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Aspect ratio of the view. */
  aspect: number;
  /**
   * The item in hand has a scope (`scopeFovDeg`): once shouldered the rifle
   * is hidden and the page draws the scope's view (`scopeOverlay.ts`).
   */
  scoped?: boolean;
}

/** Field of view of the viewmodel camera, degrees. Fixed: ADS zooms the world, not the gun. */
export const VIEWMODEL_FOV = 58;
/** How fast hip and ADS placement blend, per second. */
const ADS_RATE = 9;
/** How fast a switch lowers the old item and raises the new one, per second. */
const RAISE_RATE = 5;
/** How far a switch drops the item out of view, metres. */
const LOWERED_M = 0.25;
/** Walk bob: metres of rise and fall at a run, and its cadence in radians per metre travelled. */
const BOB_M = 0.012;
const BOB_PER_M = 5.5;
/**
 * At ADS the sight line is the view axis exactly: the rear aperture is
 * centred on the screen and the front post's tip is the screen's centre,
 * where the shot goes. The crosshair is hidden then; the sights are the aim.
 */
const ADS_DROP_M = 0;

const GLOVE = new THREE.MeshLambertMaterial({ color: 0x2c2a25 });
const SLEEVE = new THREE.MeshLambertMaterial({ color: 0x4c5436 });
const FORWARD = new THREE.Vector3(0, 0, 1);

/** A forearm from behind the view to a grip, and the glove on the end of it. */
function arm(parent: THREE.Object3D): { root: THREE.Group; place: (grip: Vec3Tuple, side: 1 | -1) => void } {
  const root = new THREE.Group();
  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.075, 0.09), GLOVE);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 1), SLEEVE);
  root.add(glove, sleeve);
  parent.add(root);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const along = new THREE.Vector3();
  const place = (grip: Vec3Tuple, side: 1 | -1): void => {
    to.set(grip[0], grip[1], grip[2]);
    glove.position.copy(to);
    // The forearm runs back and down from the grip, out to its own side: in
    // aim space +X is the holder's left, so the right arm reaches along -X.
    // Only the forearm: the upper arm would be beside the eye, and a slab of
    // sleeve that close fills half the view.
    from.set(grip[0] + side * 0.07, grip[1] - 0.13, grip[2] - 0.2);
    along.subVectors(to, from);
    const length = along.length();
    sleeve.scale.set(1, 1, length);
    sleeve.position.copy(from).lerp(to, 0.5);
    // Turned in the parent's own frame (not `lookAt`, which aims at a WORLD point).
    sleeve.quaternion.setFromUnitVectors(FORWARD, along.normalize());
    glove.quaternion.copy(sleeve.quaternion);
  };
  return { root, place };
}

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, 0.01, 5);
  /** Placement in camera space: hip or ADS, bob, kick. */
  private readonly sway = new THREE.Group();
  /** Aim space turned to face down the camera's -Z. */
  private readonly holder = new THREE.Group();
  private readonly models = new Map<string, WeaponModel>();
  private readonly right: ReturnType<typeof arm>;
  private readonly left: ReturnType<typeof arm>;
  private current: WeaponModel | null = null;
  private adsBlend = 0;
  /** 1 fully raised, 0 out of view below. */
  private raise = 0;
  private bobPhase = 0;
  private windBlend = 0;
  private scopeUp = false;
  /** The reload's pose as drawn (U-006): the curve while reloading, easing out after one is cut short. */
  private readonly pose: ReloadPose = { ...REST_POSE };
  private readonly hand = new THREE.Vector3();

  /** Whether the eye is at a scope this frame: the rifle is hidden and the scope's view is the picture. */
  get scoped(): boolean {
    return this.scopeUp;
  }

  /** 0 at the hip, 1 fully aimed. */
  get adsAmount(): number {
    return this.adsBlend;
  }

  /** The reload pose as last drawn (U-006), for tests and the QA readout. */
  get reloadPose(): Readonly<ReloadPose> {
    return this.pose;
  }

  constructor() {
    this.scene.add(new THREE.AmbientLight(0xd8c8a8, 2.4));
    const key = new THREE.DirectionalLight(0xffe9c4, 2.6);
    key.position.set(0.6, 1, 0.4);
    this.scene.add(key);
    this.scene.add(this.camera);
    this.camera.add(this.sway);
    this.sway.add(this.holder);
    // Aim space is +Z forward; the camera looks down -Z.
    this.holder.rotation.y = Math.PI;
    this.right = arm(this.holder);
    this.left = arm(this.holder);
    this.sway.visible = false;
  }

  private model(id: string): WeaponModel {
    // Keyed by the asset version too (T-4.36), so the generated weapons replace the code-built ones when they arrive.
    const key = `${id}|${weaponAssetsVersion()}`;
    let model = this.models.get(key);
    if (!model) {
      model = createWeaponModel(id);
      model.object.traverse((o) => {
        o.castShadow = false;
      });
      this.models.set(key, model);
      this.holder.add(model.object);
    }
    return model;
  }

  update(state: ViewModelState): void {
    this.sway.visible = state.visible;
    if (!state.visible) {
      // Back in first person, the item comes up rather than popping in.
      this.raise = 0;
      this.adsBlend = 0;
      this.scopeUp = false;
      // Down, dead, vaulting or in third person: no reload is left half-drawn for the way back.
      Object.assign(this.pose, REST_POSE);
      if (this.current) this.placeMagazine(this.current, 0, 0);
      return;
    }
    const dt = Math.max(0, Math.min(0.1, state.dt));
    if (this.camera.aspect !== state.aspect) {
      this.camera.aspect = state.aspect;
      this.camera.updateProjectionMatrix();
    }

    // A switch: lower what is there, swap once it is out of view, raise the new one.
    const wanted = this.model(state.held);
    if (this.current !== wanted) {
      this.raise = Math.max(0, this.raise - RAISE_RATE * 1.6 * dt);
      if (this.raise === 0 || this.current === null) this.show(wanted);
    } else {
      this.raise = Math.min(1, this.raise + RAISE_RATE * dt);
    }
    const model = this.current as WeaponModel;
    const spec = model.spec;

    // A reload takes the gun off the eye to work on it (U-006); the sight comes back after.
    const reloading = state.reload > 0 && state.reload < 1;
    const adsTarget = state.ads && !reloading ? 1 : 0;
    if (reloading) Object.assign(this.pose, reloadPose(state.reload));
    else settle(this.pose, dt);
    const pose = this.pose;
    this.adsBlend += (adsTarget - this.adsBlend) * Math.min(1, ADS_RATE * dt);
    this.windBlend += ((state.winding ? 1 : 0) - this.windBlend) * Math.min(1, ADS_RATE * dt);
    if (state.speed > 0.2) this.bobPhase += state.speed * BOB_PER_M * dt;

    // ADS puts the sight on the view axis, eye relief ahead; hip holds it low and right.
    const a = this.adsBlend;
    const hip = spec.hip;
    const bobScale = Math.min(1, state.speed / 6) * (1 - 0.8 * a);
    const bobX = Math.sin(this.bobPhase) * BOB_M * bobScale;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * BOB_M * bobScale;
    const eased = 1 - (1 - this.raise) * (1 - this.raise);
    this.sway.position.set(
      hip[0] * (1 - a) + bobX + pose.x,
      hip[1] * (1 - a) - ADS_DROP_M * a + bobY - LOWERED_M * (1 - eased) + pose.y + this.windBlend * 0.05,
      hip[2] * (1 - a) + state.kickBack + pose.z + this.windBlend * 0.08,
    );
    this.sway.rotation.set(state.kickUp + pose.pitch - (1 - eased) * 0.5 + this.windBlend * 0.35, 0, pose.roll);
    // The magazine out of its well, and the left hand with it (U-006).
    this.placeMagazine(model, pose.magOut, pose.magTilt);
    const out = pose.magOut;
    this.hand.set(
      MAGAZINE_HOLD[0] + MAGAZINE_AXIS[0] * out,
      MAGAZINE_HOLD[1] + MAGAZINE_AXIS[1] * out,
      MAGAZINE_HOLD[2] + MAGAZINE_AXIS[2] * out,
    );
    const grip = spec.gripLeft;
    const h = pose.handOnMag;
    this.left.place([grip[0] + (this.hand.x - grip[0]) * h, grip[1] + (this.hand.y - grip[1]) * h, grip[2] + (this.hand.z - grip[2]) * h], 1);
    // The holder places the sight itself at the origin of `sway`: aim space
    // turned half a turn, so its (x, y, z) lands at (-x, y, -z).
    this.holder.position.set(spec.sight[0], -spec.sight[1], spec.sight[2] - spec.eyeRelief);
    // At the eyepiece the scope's view replaces the rifle, whose tube would fill it.
    this.scopeUp = !!state.scoped && state.ads && this.current === wanted && this.adsBlend >= SCOPE_IN;
    if (this.scopeUp) this.sway.visible = false;
  }

  /** A model's magazine `out` metres down its well and tipped by `tilt`, or seated at 0 (U-006). */
  private placeMagazine(model: WeaponModel, out: number, tilt: number): void {
    const magazine = weaponMagazine(model);
    if (!magazine) return;
    magazine.object.position.set(
      magazine.restPosition.x + MAGAZINE_AXIS[0] * out,
      magazine.restPosition.y + MAGAZINE_AXIS[1] * out,
      magazine.restPosition.z + MAGAZINE_AXIS[2] * out,
    );
    magazine.object.rotation.x = magazine.restRotationX + tilt;
  }

  private show(model: WeaponModel): void {
    for (const other of this.models.values()) other.object.visible = other === model;
    // Whatever was mid-reload is put back together as it goes away.
    if (this.current) this.placeMagazine(this.current, 0, 0);
    this.current = model;
    this.right.place(model.spec.gripRight, -1);
    this.left.place(model.spec.gripLeft, 1);
  }

  /**
   * The drawn barrel's tip in the viewmodel camera's view space (U-003), as
   * placed by the last `update`: hip or ADS, bob, kick, a reload's dip. Null
   * before anything is held. The camera sits at this scene's origin looking
   * down -Z and never moves, so the scene's space is its view space.
   */
  muzzle(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.current) return null;
    const tip = weaponMuzzle(this.current.id);
    this.holder.updateWorldMatrix(true, false);
    return this.holder.localToWorld(out.set(tip[0], tip[1], tip[2]));
  }

  /** Draw over the world: call after the world's own render. */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.sway.visible) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
