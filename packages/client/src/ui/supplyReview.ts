import * as THREE from 'three';
import { createSupplyChoice } from './supplyChoice.ts';
import { SUPPLY_FIXTURES } from './supplyFixtures.ts';
import { createSupplySessionFixture } from './supplySessionFixture.ts';
import { SupplyModels } from '../weapons/supplyModels.ts';
import { applyMobileClass } from './mobileDevice.ts';

/** Live isolated review harness. The production HUD and scenery render real Session/NetClient state. */
export function mountSupplyReview(parent: HTMLElement, mobile = false) {
  const wasMobile = document.documentElement.classList.contains('mobile');
  applyMobileClass(document.documentElement, mobile);
  const room = createSupplySessionFixture(); const actor = room.join(1); const observer = room.join(0);
  const viewer = mobile ? observer : actor;
  if (mobile) { observer.net.spectate(1); room.settle(); }
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x252d27);
  scene.add(new THREE.HemisphereLight(0xe8ecd9, 0x393322, 3));
  const light = new THREE.DirectionalLight(0xffe4b0, 3); light.position.set(3, 5, 3); scene.add(light);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0x393f32 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(8, -.01, 0); scene.add(floor);
  const scenery = new SupplyModels(scene);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'; parent.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  const caption = document.createElement('p'); caption.className = 'supply-fixture-caption';
  caption.style.cssText = 'position:fixed;top:12px;left:16px;color:#e8dcc8;font:14px system-ui;z-index:15;margin:0;';
  parent.append(caption);
  let index = 0;
  const choice = createSupplyChoice(parent, (id, item) => { viewer.net.selectSupply(id, item); room.settle(); });
  const refresh = () => {
    const width = innerWidth; const height = innerHeight;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    const x = SUPPLY_FIXTURES[index]!.feet.x;
    camera.position.set(x + 1.8, 1.5, 2.8); camera.lookAt(x, mobile ? .8 : .2, 0);
    scenery.update(viewer.net.supplyCaches); renderer.render(scene, camera);
    choice.set(room.model(viewer, index, mobile));
    caption.textContent = `${SUPPLY_FIXTURES[index]!.id} · ${index + 1} of 5 · ${mobile ? 'Mobile spectator' : 'Desktop'} fixture`;
  };
  const show = (next: number) => {
    index = next;
    const soldier = room.place(actor, index); soldier.kits = 0; soldier.pouch[1] = 0; soldier.weaponState.ammo = soldier.weapon.magSize - 15;
    room.step(3); refresh();
  };
  show(0);
  return {
    room, actor, observer, viewer, choice, scenery, renderer, refresh, show,
    step(n = 1) { room.step(n); refresh(); },
    dispose() { choice.set(null); renderer.dispose(); applyMobileClass(document.documentElement, wasMobile); for (const player of [actor, observer]) player.pair.b.close('fixture ended'); parent.replaceChildren(); },
  };
}
