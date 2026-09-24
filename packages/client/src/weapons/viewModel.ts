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
import { plateau } from '../character/locomotionPose.ts';
import { type WeaponModel, type Vec3Tuple, createWeaponModel, weaponAssetsVersion } from './weaponModels.ts';

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
  /** 0..1 through a reload. */
  reload: number;
  /** Horizontal speed, m/s, for the walk bob. */
  speed: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Aspect ratio of the view. */
  aspect: number;
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
/** At ADS the sight sits this far under the view axis, so it frames the reticle instead of covering it. */
const ADS_DROP_M = 0.01;

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

    const adsTarget = state.ads ? 1 : 0;
    this.adsBlend += (adsTarget - this.adsBlend) * Math.min(1, ADS_RATE * dt);
    this.windBlend += ((state.winding ? 1 : 0) - this.windBlend) * Math.min(1, ADS_RATE * dt);
    if (state.speed > 0.2) this.bobPhase += state.speed * BOB_PER_M * dt;

    // ADS puts the sight on the view axis, eye relief ahead; hip holds it low and right.
    const a = this.adsBlend;
    const hip = spec.hip;
    const bobScale = Math.min(1, state.speed / 6) * (1 - 0.8 * a);
    const bobX = Math.sin(this.bobPhase) * BOB_M * bobScale;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * BOB_M * bobScale;
    const reloadDip = plateau(state.reload, 0, 0.25, 0.75, 1);
    const eased = 1 - (1 - this.raise) * (1 - this.raise);
    this.sway.position.set(
      hip[0] * (1 - a) + bobX,
      hip[1] * (1 - a) - ADS_DROP_M * a + bobY - LOWERED_M * (1 - eased) - reloadDip * 0.06 + this.windBlend * 0.05,
      hip[2] * (1 - a) + state.kickBack + this.windBlend * 0.08,
    );
    this.sway.rotation.set(state.kickUp - reloadDip * 0.5 - (1 - eased) * 0.5 + this.windBlend * 0.35, 0, reloadDip * 0.4);
    // The holder places the sight itself at the origin of `sway`: aim space
    // turned half a turn, so its (x, y, z) lands at (-x, y, -z).
    this.holder.position.set(spec.sight[0], -spec.sight[1], spec.sight[2] - spec.eyeRelief);
  }

  private show(model: WeaponModel): void {
    for (const other of this.models.values()) other.object.visible = other === model;
    this.current = model;
    this.right.place(model.spec.gripRight, -1);
    this.left.place(model.spec.gripLeft, 1);
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
