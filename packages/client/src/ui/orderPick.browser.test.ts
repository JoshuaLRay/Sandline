/**
 * U-123: a mobile order placed with real pointer input keeps the floor tapped.
 * Chromium, a real canvas and its layout, the mobile command bar's own drag
 * and tap handling, three.js picking through the tapped pixel, and the order
 * through the wire codec: identical x/z on a basement (y0), a deck (y8) and a
 * bridge (y16) arrive as three different floors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { type Message, boxFrom, decodeMessage, encodeMessage } from '@sandline/shared';
import { createMobileCommand } from './MobileCommand.ts';
import type { CommandRow } from './menu/commandModel.ts';
import { buildOrder } from './OrderWheel.ts';
import { pickOrder, screenRay } from './orderPick.ts';

const specs = [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
];
const world = { boxes: specs.map((s) => boxFrom(s, 'cover')), groundY: 0 };
const scene: THREE.Object3D[] = [
  ...specs.map((s) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d));
    mesh.position.set(s.x, s.y + s.h / 2, s.z);
    mesh.updateMatrixWorld();
    return mesh;
  }),
  (() => {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
    ground.updateMatrixWorld();
    return ground;
  })(),
];
const rows: CommandRow[] = [0, 1, 2].map((slot) => ({
  slot, label: `${slot + 1} · Bot · AR`, human: slot === 2, commander: slot === 2 ? -1 : 0,
  options: [], switchable: slot !== 2, captured: false,
}));

const cleanup: HTMLElement[] = [];
afterEach(() => { cleanup.forEach((el) => el.remove()); cleanup.length = 0; vi.restoreAllMocks(); });

/** The page in miniature: a canvas on top of the lower screen, the command bar, and main.ts's order action. */
function page(camera: THREE.PerspectiveCamera) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', left: '0px', top: '200px', width: '400px', height: '300px', zIndex: '10' });
  document.body.append(canvas);
  cleanup.push(canvas);
  const parent = document.createElement('div');
  document.body.append(parent);
  cleanup.push(parent);
  const sent: Extract<Message, { kind: 'Order' }>[] = [];
  const ui = createMobileCommand(parent, {
    watch: vi.fn(), assign: vi.fn(), aggression: vi.fn(), settings: vi.fn(), leave: vi.fn(), recenter: vi.fn(),
    order: (kind, address, x, y) => {
      const pick = pickOrder(screenRay(camera, canvas.getBoundingClientRect(), x, y, 300), scene, undefined, world);
      const order = buildOrder(kind, address, { point: pick.point, feet: pick.feet, netId: null, enemy: false, downedMate: false });
      if (!order) return false;
      // What the host receives: the bytes, decoded.
      sent.push(decodeMessage(encodeMessage(order)) as Extract<Message, { kind: 'Order' }>);
      return true;
    },
  });
  ui.root.hidden = false;
  ui.update(rows, 0, 0);
  /** Where a world point is drawn on the canvas, in client pixels. */
  const pixel = (p: THREE.Vector3) => {
    const rect = canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    const v = p.clone().project(camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  };
  return { canvas, ui, sent, pixel };
}

function cameraAt(from: THREE.Vector3, to: THREE.Vector3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 400 / 300, 0.1, 500);
  camera.position.copy(from);
  camera.lookAt(to);
  return camera;
}

const pointer = (el: Element, type: string, x: number, y: number) =>
  el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, button: 0, bubbles: true }));

describe('mobile orders keep the floor tapped (U-123)', () => {
  const views = [
    { floor: 0, camera: () => cameraAt(new THREE.Vector3(-6, 1.6, 0), new THREE.Vector3(0, 0, 0)) },
    { floor: 8, camera: () => cameraAt(new THREE.Vector3(-6, 9.6, 0), new THREE.Vector3(0, 8, 0)) },
    { floor: 16, camera: () => cameraAt(new THREE.Vector3(-6, 22, 0), new THREE.Vector3(0, 16, 0)) },
  ];

  it('drag-and-release onto the canvas sends identical x/z as y0, y8 and y16', () => {
    for (const view of views) {
      const { canvas, ui, sent, pixel } = page(view.camera());
      const at = pixel(new THREE.Vector3(0, view.floor, 0));
      // The tapped pixel really is the canvas, by layout, not by a mocked hit test.
      expect(document.elementFromPoint(at.x, at.y)).toBe(canvas);
      const button = ui.root.querySelector('.mobile-quick-orders button')!;
      vi.spyOn(button, 'setPointerCapture').mockImplementation(() => {});
      pointer(button, 'pointerdown', 5, 5);
      pointer(button, 'pointermove', at.x, at.y);
      pointer(button, 'pointerup', at.x, at.y);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ order: 'move', address: { to: 'all' } });
      expect(sent[0]!.point!.y).toBeCloseTo(view.floor, 1);
      expect(Math.hypot(sent[0]!.point!.x, sent[0]!.point!.z)).toBeLessThan(0.1);
      cleanup.forEach((el) => el.remove());
      cleanup.length = 0;
    }
  });

  it('a tap on the ceiling seen from the basement stays in the basement, not the deck above', () => {
    const { ui, sent, pixel } = page(cameraAt(new THREE.Vector3(-6, 1.6, 0), new THREE.Vector3(2, 5.5, 0)));
    (ui.root.querySelector('.mobile-quick-orders button') as HTMLButtonElement).click();
    const at = pixel(new THREE.Vector3(2, 5.5, 0));
    expect(ui.tapAt(at.x, at.y)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.point!.y).toBeCloseTo(0, 1);
    expect(sent[0]!.point!.x).toBeCloseTo(2, 0);
  });

  it('arm then tap sends the selected bot to the tapped floor', () => {
    const { ui, sent, pixel } = page(views[1]!.camera());
    (ui.root.querySelectorAll('.mobile-squad button')[2] as HTMLButtonElement).click();
    const hold = Array.from(ui.root.querySelectorAll<HTMLButtonElement>('.mobile-quick-orders button')).find((b) => b.textContent === 'Hold')!;
    hold.click();
    const at = pixel(new THREE.Vector3(0, 8, 0));
    expect(ui.tapAt(at.x, at.y)).toBe(true);
    expect(sent).toEqual([expect.objectContaining({ order: 'hold', address: { to: 'slot', index: 1 } })]);
    expect(sent[0]!.point!.y).toBeCloseTo(8, 1);
  });
});
