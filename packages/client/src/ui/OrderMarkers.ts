/**
 * Orders and marks in the world (T-3.29).
 *
 * Drawn from what the host broadcast (`Orders`, `Marks`) and nothing else:
 * an order this client sent is not drawn until the host says it stands, and
 * one the host dropped (to a human's slot, at nobody) is never drawn at all.
 * A marker that showed what was asked rather than what is happening would
 * tell the player the squad is moving when it is not. `orderMarkers` is a
 * pure function of the broadcast state and where the soldiers are drawn, and
 * the overlay only ever draws what it returns.
 *
 * A move or a hold stands on its point (a hold without one, on the bot); an
 * attack or a revive on its target, followed as it moves; a regroup on the
 * bot. Each order also draws a line from its bot to its marker. A mark stands
 * on its enemy while that enemy is drawn, else on its point.
 */
import * as THREE from 'three';
import type { BotOrder, OrderKind, TargetMark } from '@sandline/shared';

export interface MarkerVec {
  x: number;
  y: number;
  z: number;
}

export type MarkerKind = OrderKind | 'mark';

export interface OrderMarker {
  /** Stable across frames: `o<slot>` for an order, `m<id>` for a mark. */
  key: string;
  kind: MarkerKind;
  /** Where it stands: on the ground at its point, or at its soldier's feet. */
  at: MarkerVec;
  /** The ordered bot's feet, for the line to its marker; null for a mark. */
  bot: MarkerVec | null;
  label: string;
}

/** Where a soldier is drawn this frame, by slot and by netId; null if it is not drawn. */
export interface MarkerPositions {
  slot(slot: number): MarkerVec | null;
  netId(netId: number): MarkerVec | null;
}

export const MARKER_COLOURS: Readonly<Record<MarkerKind, number>> = {
  move: 0x39d0ff,
  attack: 0xff5a3c,
  hold: 0xffd23c,
  regroup: 0x7dff6a,
  revive: 0xff8ce0,
  mark: 0xff2a2a,
};

function copy(p: MarkerVec): MarkerVec {
  return { x: p.x, y: p.y, z: p.z };
}

/** The markers for the host's broadcast orders and marks, placed where their soldiers are drawn. */
export function orderMarkers(orders: readonly BotOrder[], marks: readonly TargetMark[], where: MarkerPositions): OrderMarker[] {
  const out: OrderMarker[] = [];
  for (const order of orders) {
    const bot = where.slot(order.slot);
    let at: MarkerVec | null;
    if (order.order === 'attack' || order.order === 'revive') at = order.target === null ? null : where.netId(order.target);
    else if (order.order === 'regroup') at = bot;
    else at = order.point ?? bot;
    if (!at) continue;
    out.push({ key: `o${order.slot}`, kind: order.order, at: copy(at), bot: bot ? copy(bot) : null, label: `${order.slot + 1} · ${order.order}` });
  }
  for (const mark of marks) {
    const on = mark.target === null ? null : where.netId(mark.target);
    out.push({ key: `m${mark.id}`, kind: 'mark', at: copy(on ?? mark.point), bot: null, label: `mark · ${mark.from + 1}` });
  }
  return out;
}

const RING_SEGMENTS = 16;
const RING_M = 0.5;
const POLE_M = 2.2;

/** The markers as `LineSegments` attributes: a ring and a pole each, and each order's line from its bot. */
export function markerLines(markers: readonly OrderMarker[]): { positions: Float32Array; colours: Float32Array } {
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color();
  const segment = (a: MarkerVec, b: MarkerVec) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
  };
  for (const m of markers) {
    colour.setHex(MARKER_COLOURS[m.kind]);
    const y = m.at.y + 0.05;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const b = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      segment({ x: m.at.x + Math.sin(a) * RING_M, y, z: m.at.z + Math.cos(a) * RING_M }, { x: m.at.x + Math.sin(b) * RING_M, y, z: m.at.z + Math.cos(b) * RING_M });
    }
    segment({ x: m.at.x, y, z: m.at.z }, { x: m.at.x, y: m.at.y + POLE_M, z: m.at.z });
    if (m.bot && (Math.abs(m.bot.x - m.at.x) > 0.3 || Math.abs(m.bot.z - m.at.z) > 0.3)) {
      segment({ x: m.bot.x, y: m.bot.y + 0.1, z: m.bot.z }, { x: m.at.x, y, z: m.at.z });
    }
  }
  return { positions: new Float32Array(positions), colours: new Float32Array(colours) };
}

/** The overlay: one `LineSegments` in the scene and a DOM label per marker, rebuilt each frame. */
export class OrderMarkerOverlay {
  readonly object: THREE.LineSegments;
  private readonly labelRoot: HTMLDivElement;
  private readonly labels = new Map<string, HTMLDivElement>();
  private current: OrderMarker[] = [];
  private readonly scratch = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 });
    this.object = new THREE.LineSegments(new THREE.BufferGeometry(), material);
    this.object.renderOrder = 9;
    this.object.frustumCulled = false;
    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'order-markers';
    parent.append(this.labelRoot);
  }

  /** The markers drawn now, for a test or a readout. */
  get markers(): readonly OrderMarker[] {
    return this.current;
  }

  /** Replace what is drawn with these markers. */
  show(markers: OrderMarker[]): void {
    this.current = markers;
    const { positions, colours } = markerLines(markers);
    const buffer = this.object.geometry;
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.key);
      let el = this.labels.get(m.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'order-marker-label';
        this.labelRoot.append(el);
        this.labels.set(m.key, el);
      }
      el.textContent = m.label;
      el.style.borderColor = `#${MARKER_COLOURS[m.kind].toString(16).padStart(6, '0')}`;
    }
    for (const [key, el] of this.labels) {
      if (seen.has(key)) continue;
      el.remove();
      this.labels.delete(key);
    }
  }

  /** Put each label at the top of its pole; hide the ones behind the camera. */
  render(camera: THREE.Camera, width: number, height: number): void {
    for (const m of this.current) {
      const el = this.labels.get(m.key);
      if (!el) continue;
      const p = this.scratch.set(m.at.x, m.at.y + POLE_M, m.at.z).project(camera);
      const onScreen = p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1.2 && Math.abs(p.y) <= 1.2;
      el.hidden = !onScreen;
      if (onScreen) el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
  }

  /** A new session's orders are not the old one's. */
  clear(): void {
    this.show([]);
  }
}
