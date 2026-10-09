import * as THREE from 'three';
import { createMobileSupplySessionFixture } from './mobileSupplySessionFixture.ts';
import { createMobileSupplyChoice } from './mobileSupplyChoice.ts';
import { createMobileCommand } from './MobileCommand.ts';
import { commandRows } from './menu/commandModel.ts';
import { SUPPLY_FIXTURES } from './supplyFixtures.ts';
import { SupplyModels } from '../weapons/supplyModels.ts';
import { applyMobileClass } from './mobileDevice.ts';

/** Isolated use review with the production phone controls on host-confirmed wire state. */
export function mountMobileSupplyReview(parent: HTMLElement) {
  const wasMobile = document.documentElement.classList.contains('mobile');
  applyMobileClass(document.documentElement, true);
  const room = createMobileSupplySessionFixture();
  const commander = room.join(0); const desktop = room.join(3);
  commander.net.spectate(3); room.settle();
  let cacheIndex = 0;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x252d27);
  scene.add(new THREE.HemisphereLight(0xe8ecd9, 0x393322, 3));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0x393f32 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(8, -.01, 0); scene.add(floor);
  const scenery = new SupplyModels(scene);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'; parent.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  const command = createMobileCommand(parent, {
    watch(slot) { choice.cancel(); commander.net.spectate(slot); room.settle(); refresh(); },
    assign(bot, owner) { choice.cancel(); commander.net.assignCommander(bot, owner); room.settle(); refresh(); },
    aggression(mode, address) { choice.cancel(); commander.net.aggression(mode, address); room.settle(); },
    order() { choice.cancel(); return false; },
    settings() { choice.set(null); }, leave() { choice.cancel(); commander.net.leave(); room.settle(); }, recenter() { choice.cancel(); },
  });
  const choice = createMobileSupplyChoice(parent, {
    select(slot, cacheId, item) { commander.net.selectCommanderSupply(slot, cacheId, item); room.settle(); },
    onOpen() { command.closeMenus(); command.cancelPlacement(); },
  });
  command.root.addEventListener('pointerdown', () => choice.cancel());
  command.root.addEventListener('click', () => choice.cancel());
  const refresh = () => {
    renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    const x = SUPPLY_FIXTURES[cacheIndex]!.feet.x;
    camera.position.set(x + 2, 1.5, 3); camera.lookAt(x, .7, 0);
    scenery.update(commander.net.supplyCaches); renderer.render(scene, camera);
    command.root.hidden = false;
    command.update(commandRows(commander.net.roster, commander.net.slot), commander.net.spectatedSlot, commander.net.slot, commander.net.aggressions);
    choice.set(room.model(commander));
  };
  const show = (index: number) => {
    choice.cancel(); cacheIndex = index;
    for (const slot of [0, 1, 2, 3]) {
      const soldier = room.place(slot, index, slot === 3 ? .5 : -.5);
      soldier.kits = 0; soldier.pouch[1] = 0; soldier.weaponState.ammo = soldier.weapon.magSize - 15;
    }
    room.step(3); refresh();
    const cache = choice.root.querySelector<HTMLSelectElement>('[aria-label="Supply cache"]')!;
    cache.value = SUPPLY_FIXTURES[index]!.id; cache.dispatchEvent(new Event('change'));
  };
  show(0);
  return { room, commander, desktop, choice, command, scenery, renderer, refresh, show,
    step(n = 1) { refresh(); room.step(n); refresh(); },
    dispose() { choice.dispose(); room.dispose(); renderer.dispose(); floor.geometry.dispose(); floor.material.dispose();
      applyMobileClass(document.documentElement, wasMobile); parent.replaceChildren(); },
  };
}
