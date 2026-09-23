/**
 * AI debug overlay (T-3.09).
 *
 * Draws what the host says each bot brain is doing, over the world: the path
 * it is walking, where it was asked to go, its perception cones and the
 * targets it knows about, the cover it chose, and a label with the running
 * branch of its tree. B toggles it; turning it on asks the host for reports,
 * turning it off tells the host to stop.
 *
 * The geometry is built from the report and NOTHING else — not the snapshot,
 * not the interpolation buffer. A debug view that mixed its reasons with a
 * position from a different tick would draw a path starting a metre from the
 * soldier walking it, and the tester would be left judging the overlay rather
 * than the AI. `aiDebugGeometry` is a pure function of the message for exactly
 * that reason, and the overlay only ever draws what it returns.
 */
import * as THREE from 'three';
import type { AiDebugBrain, Message } from '@sandline/shared';

export type AiDebugReport = Extract<Message, { kind: 'AiDebug' }>;

/** What a segment shows; the overlay colours by it. */
export type AiDebugSegmentKind = 'corridor' | 'intent' | 'cone' | 'target' | 'cover';

export interface AiDebugVec {
  x: number;
  y: number;
  z: number;
}

export interface AiDebugSegment {
  kind: AiDebugSegmentKind;
  a: AiDebugVec;
  b: AiDebugVec;
}

export interface AiDebugLabel {
  netId: number;
  at: AiDebugVec;
  lines: string[];
}

export interface AiDebugGeometry {
  tick: number;
  segments: AiDebugSegment[];
  labels: AiDebugLabel[];
}

/** Display-only heights: where cones and target lines leave the body, and where the label sits. */
const EYE_M = 1.6;
const LABEL_M = 2.3;
const GOAL_POST_M = 1.5;
const MARK_M = 0.3;
const CONE_ARC_STEPS = 8;
/** Wire angle units per turn: 0 along +Z, a quarter turn along +X. */
const TURN = 1024;

export const AI_DEBUG_COLOURS: Readonly<Record<AiDebugSegmentKind, number>> = Object.freeze({
  corridor: 0x39d0ff,
  intent: 0xf0b429,
  cone: 0xff8a3d,
  target: 0xff4d4d,
  cover: 0x5fe07a,
});

function add(p: AiDebugVec, dx: number, dy: number, dz: number): AiDebugVec {
  return { x: p.x + dx, y: p.y + dy, z: p.z + dz };
}

/** A point `range` metres along wire yaw `yaw` from `from`. */
function along(from: AiDebugVec, yaw: number, range: number): AiDebugVec {
  const a = (yaw / TURN) * 2 * Math.PI;
  return add(from, Math.sin(a) * range, 0, Math.cos(a) * range);
}

/** A ground cross at `p`. */
function cross(kind: AiDebugSegmentKind, p: AiDebugVec, out: AiDebugSegment[]): void {
  out.push({ kind, a: add(p, -MARK_M, 0, -MARK_M), b: add(p, MARK_M, 0, MARK_M) });
  out.push({ kind, a: add(p, -MARK_M, 0, MARK_M), b: add(p, MARK_M, 0, -MARK_M) });
}

/** `root.children[1].child action:b` reads as `action:b`: the kind, or the leaf's name. */
function nodeName(entry: string): string {
  const space = entry.indexOf(' ');
  return space < 0 ? entry : entry.slice(space + 1);
}

function labelLines(brain: AiDebugBrain): string[] {
  const lines = [`bot ${brain.netId}`];
  lines.push(brain.tree.length > 0 ? brain.tree.map(nodeName).join(' › ') : '(nothing running)');
  const i = brain.intent;
  lines.push(i ? `${i.pace} → ${i.x.toFixed(1)}, ${i.z.toFixed(1)}` : 'no intent');
  if (brain.targets.length > 0) lines.push(`knows ${brain.targets.map((t) => t.netId).join(', ')}`);
  if (brain.cover) lines.push('cover chosen');
  return lines;
}

function brainSegments(brain: AiDebugBrain, out: AiDebugSegment[]): void {
  const eye = add(brain.position, 0, EYE_M, 0);
  for (let i = 1; i < brain.corridor.length; i++) {
    out.push({ kind: 'corridor', a: { ...brain.corridor[i - 1]! }, b: { ...brain.corridor[i]! } });
  }
  if (brain.intent) {
    const goal = { x: brain.intent.x, y: brain.intent.y, z: brain.intent.z };
    out.push({ kind: 'intent', a: goal, b: add(goal, 0, GOAL_POST_M, 0) });
    cross('intent', goal, out);
  }
  for (const cone of brain.cones) {
    const from = cone.yaw - cone.halfAngle;
    const to = cone.yaw + cone.halfAngle;
    out.push({ kind: 'cone', a: eye, b: along(eye, from, cone.range) });
    out.push({ kind: 'cone', a: eye, b: along(eye, to, cone.range) });
    for (let s = 0; s < CONE_ARC_STEPS; s++) {
      const y0 = from + ((to - from) * s) / CONE_ARC_STEPS;
      const y1 = from + ((to - from) * (s + 1)) / CONE_ARC_STEPS;
      out.push({ kind: 'cone', a: along(eye, y0, cone.range), b: along(eye, y1, cone.range) });
    }
  }
  for (const t of brain.targets) {
    const at = { x: t.x, y: t.y, z: t.z };
    out.push({ kind: 'target', a: eye, b: add(at, 0, 1, 0) });
    cross('target', at, out);
  }
  if (brain.cover) {
    const c = brain.cover;
    const corners = [add(c, -MARK_M, 0, -MARK_M), add(c, MARK_M, 0, -MARK_M), add(c, MARK_M, 0, MARK_M), add(c, -MARK_M, 0, MARK_M)];
    for (let k = 0; k < 4; k++) out.push({ kind: 'cover', a: corners[k]!, b: corners[(k + 1) % 4]! });
    out.push({ kind: 'cover', a: brain.position, b: { x: c.x, y: c.y, z: c.z } });
  }
}

/** Everything the overlay draws for `report`, from `report` alone. */
export function aiDebugGeometry(report: AiDebugReport): AiDebugGeometry {
  const segments: AiDebugSegment[] = [];
  const labels: AiDebugLabel[] = [];
  for (const brain of report.brains) {
    brainSegments(brain, segments);
    labels.push({ netId: brain.netId, at: add(brain.position, 0, LABEL_M, 0), lines: labelLines(brain) });
  }
  return { tick: report.tick, segments, labels };
}

/** The segments as `LineSegments` attributes: two vertices each, coloured by kind. */
export function lineAttributes(geometry: AiDebugGeometry): { positions: Float32Array; colours: Float32Array } {
  const positions = new Float32Array(geometry.segments.length * 6);
  const colours = new Float32Array(geometry.segments.length * 6);
  const colour = new THREE.Color();
  geometry.segments.forEach((s, i) => {
    positions.set([s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z], i * 6);
    colour.setHex(AI_DEBUG_COLOURS[s.kind]);
    colours.set([colour.r, colour.g, colour.b, colour.r, colour.g, colour.b], i * 6);
  });
  return { positions, colours };
}

/**
 * The overlay: one `LineSegments` in the scene and a DOM label per brain,
 * projected each frame. Only ever shows the last report it was given.
 */
export class AiDebugOverlay {
  readonly object: THREE.LineSegments;
  private readonly labelRoot: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly labels = new Map<number, HTMLDivElement>();
  private current: AiDebugGeometry | null = null;
  private enabled = false;
  private readonly scratch = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
    this.object = new THREE.LineSegments(geometry, material);
    this.object.renderOrder = 10;
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'ai-debug';
    this.labelRoot.hidden = true;
    this.status = document.createElement('div');
    this.status.className = 'ai-debug-status';
    this.labelRoot.append(this.status);
    parent.append(this.labelRoot);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Show or hide. The caller asks the host for reports; this only draws them. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.object.visible = on;
    this.labelRoot.hidden = !on;
    if (!on) this.clear();
    this.status.textContent = on ? 'AI debug: waiting for the host (a remote host needs AI_DEBUG=1)' : '';
  }

  /** Replace what is drawn with `report`. */
  show(report: AiDebugReport): void {
    if (!this.enabled) return;
    const geometry = aiDebugGeometry(report);
    this.current = geometry;
    const { positions, colours } = lineAttributes(geometry);
    const buffer = this.object.geometry;
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    buffer.computeBoundingSphere();
    this.status.textContent = `AI debug · tick ${geometry.tick} · ${geometry.labels.length} brains`;
    const seen = new Set<number>();
    for (const label of geometry.labels) {
      seen.add(label.netId);
      let el = this.labels.get(label.netId);
      if (!el) {
        el = document.createElement('div');
        el.className = 'ai-debug-label';
        this.labelRoot.append(el);
        this.labels.set(label.netId, el);
      }
      el.textContent = label.lines.join('\n');
    }
    for (const [netId, el] of this.labels) {
      if (seen.has(netId)) continue;
      el.remove();
      this.labels.delete(netId);
    }
  }

  /** Put each label over its brain; hide the ones behind the camera. */
  render(camera: THREE.Camera, width: number, height: number): void {
    if (!this.enabled || !this.current) return;
    for (const label of this.current.labels) {
      const el = this.labels.get(label.netId);
      if (!el) continue;
      const p = this.scratch.set(label.at.x, label.at.y, label.at.z).project(camera);
      const onScreen = p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1.2 && Math.abs(p.y) <= 1.2;
      el.hidden = !onScreen;
      if (onScreen) el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
  }

  /** Forget the last report: a new session's brains are not the old one's. */
  clear(): void {
    this.current = null;
    this.object.geometry.deleteAttribute('position');
    this.object.geometry.deleteAttribute('color');
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    if (this.enabled) this.status.textContent = 'AI debug: waiting for the host (a remote host needs AI_DEBUG=1)';
  }
}
