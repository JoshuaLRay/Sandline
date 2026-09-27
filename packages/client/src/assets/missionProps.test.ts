/**
 * U-011: the mission's props — each upload's terminal and lever — are drawn
 * where the mission data puts them, for the world a page is in, and nothing
 * for a world whose mission has none.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { missionFor } from '@sandline/shared';
import { MissionProps, missionPropPlaces } from './missionProps.ts';

describe('mission props (U-011)', () => {
  it('mission-01 has a terminal and a lever, where its upload says; the grey box has none', () => {
    const places = missionPropPlaces(missionFor('mission-01'));
    const upload = missionFor('mission-01')!.objectives.find((o) => o.type === 'upload')!;
    if (upload.type !== 'upload') throw new Error('no upload');
    expect(places).toEqual([
      { kind: 'terminal', at: upload.terminal, label: upload.label },
      { kind: 'lever', at: upload.lever!.at, label: upload.label },
    ]);
    expect(missionPropPlaces(missionFor('greybox-01'))).toEqual([]);
  });

  it('are built into the scene at those places, and replaced when the world changes', () => {
    const scene = new THREE.Scene();
    const props = new MissionProps(scene);
    props.show('mission-01');
    expect(props.count).toBe(2);
    const terminal = scene.getObjectByName('terminal (the relay)')!;
    const lever = scene.getObjectByName('lever (the relay)')!;
    expect(terminal.position.x).toBeCloseTo(0, 6);
    expect(terminal.position.z).toBeCloseTo(72.3, 6);
    expect(lever.position.x).toBeCloseTo(6.5, 6);
    props.show('greybox-01');
    expect(props.count).toBe(0);
    expect(scene.getObjectByName('terminal (the relay)')).toBeUndefined();
  });
});
