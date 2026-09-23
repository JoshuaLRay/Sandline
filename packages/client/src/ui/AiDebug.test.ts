/**
 * The AI debug overlay's geometry is the report's and nothing else's (T-3.09).
 * Node-only: `aiDebugGeometry` and `lineAttributes` need no DOM.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { type AiDebugBrain, decodeMessage, encodeMessage } from '@sandline/shared';
import { AI_DEBUG_COLOURS, type AiDebugReport, aiDebugGeometry, lineAttributes } from './AiDebug.ts';

const walker: AiDebugBrain = {
  netId: 3,
  position: { x: 2, y: 0, z: 1 },
  tree: ['root sequence', 'root.children[0] action:walk'],
  intent: { x: 2, y: 0.25, z: 9, pace: 'walk' },
  corridor: [
    { x: 2, y: 0.25, z: 1 },
    { x: 4, y: 0.25, z: 5 },
    { x: 2, y: 0.25, z: 9 },
  ],
  cones: [{ yaw: 0, halfAngle: 128, range: 10 }],
  targets: [{ netId: 1, x: -3, y: 0, z: 12 }],
  cover: { x: 5, y: 0, z: 6 },
};
const idle: AiDebugBrain = {
  netId: 5,
  position: { x: -6, y: 0, z: 0 },
  tree: ['root action:idle'],
  intent: null,
  corridor: [],
  cones: [],
  targets: [],
  cover: null,
};
const report: AiDebugReport = { kind: 'AiDebug', tick: 42, brains: [walker, idle] };

describe('AI debug overlay geometry (T-3.09)', () => {
  it('draws the corridor leg by leg, exactly on the reported points', () => {
    const g = aiDebugGeometry(report);
    const legs = g.segments.filter((s) => s.kind === 'corridor');
    expect(legs).toEqual([
      { kind: 'corridor', a: walker.corridor[0], b: walker.corridor[1] },
      { kind: 'corridor', a: walker.corridor[1], b: walker.corridor[2] },
    ]);
  });

  it('marks the goal, the cone, the target and the cover from the report', () => {
    const g = aiDebugGeometry(report);
    const intent = g.segments.filter((s) => s.kind === 'intent');
    expect(intent[0]!.a).toEqual({ x: 2, y: 0.25, z: 9 });
    expect(intent[0]!.b.x).toBe(2);
    expect(intent[0]!.b.y).toBeGreaterThan(0.25);

    // A quarter turn wide (±128 of 1024) facing +Z, 10 m: its edges end at ±45°.
    const cone = g.segments.filter((s) => s.kind === 'cone');
    const eye = cone[0]!.a;
    expect(eye.x).toBe(walker.position.x);
    expect(eye.z).toBe(walker.position.z);
    const edge = cone[0]!.b;
    expect(Math.hypot(edge.x - eye.x, edge.z - eye.z)).toBeCloseTo(10, 6);
    expect(edge.x - eye.x).toBeCloseTo(-10 * Math.SQRT1_2, 6);
    expect(edge.z - eye.z).toBeCloseTo(10 * Math.SQRT1_2, 6);
    expect(cone[1]!.b.x - eye.x).toBeCloseTo(10 * Math.SQRT1_2, 6);

    const target = g.segments.filter((s) => s.kind === 'target');
    expect(target[0]!.a).toEqual(eye);
    expect(target[0]!.b.x).toBe(-3);
    expect(target[0]!.b.z).toBe(12);

    const cover = g.segments.filter((s) => s.kind === 'cover');
    expect(cover.at(-1)).toEqual({ kind: 'cover', a: walker.position, b: walker.cover });
  });

  it('labels every brain over its reported position with its tree and intent', () => {
    const g = aiDebugGeometry(report);
    expect(g.tick).toBe(42);
    expect(g.labels.map((l) => l.netId)).toEqual([3, 5]);
    expect(g.labels[0]!.at.x).toBe(walker.position.x);
    expect(g.labels[0]!.at.z).toBe(walker.position.z);
    expect(g.labels[0]!.lines).toEqual(['bot 3', 'sequence › action:walk', 'walk → 2.0, 9.0', 'knows 1', 'cover chosen']);
    expect(g.labels[1]!.lines).toEqual(['bot 5', 'action:idle', 'no intent']);
    // An idle brain draws a label and nothing else.
    const idleOnly = aiDebugGeometry({ kind: 'AiDebug', tick: 1, brains: [idle] });
    expect(idleOnly.segments).toEqual([]);
  });

  it('is a function of the message alone: the same bytes give the same geometry, and it mutates nothing', () => {
    const before = structuredClone(report);
    const decoded = decodeMessage(encodeMessage(report));
    expect(decoded.kind).toBe('AiDebug');
    expect(aiDebugGeometry(decoded as AiDebugReport)).toEqual(aiDebugGeometry(report));
    expect(aiDebugGeometry(report)).toEqual(aiDebugGeometry(report));
    expect(report).toEqual(before);
    expect(aiDebugGeometry({ kind: 'AiDebug', tick: 7, brains: [] })).toEqual({ tick: 7, segments: [], labels: [] });
  });

  it('hands the scene two coloured vertices per segment and nothing more', () => {
    const g = aiDebugGeometry(report);
    const { positions, colours } = lineAttributes(g);
    expect(positions.length).toBe(g.segments.length * 6);
    expect(colours.length).toBe(g.segments.length * 6);
    const first = g.segments[0]!;
    expect(Array.from(positions.slice(0, 6))).toEqual([first.a.x, first.a.y, first.a.z, first.b.x, first.b.y, first.b.z]);
    const colour = new THREE.Color().setHex(AI_DEBUG_COLOURS[first.kind]);
    expect(Array.from(colours.slice(0, 6))).toEqual(Array.from(new Float32Array([colour.r, colour.g, colour.b, colour.r, colour.g, colour.b])));
  });
});
