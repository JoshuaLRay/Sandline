import { describe, expect, it } from 'vitest';
import {
  beginAds,
  createViewState,
  endAds,
  pressShoulderKey,
  shoulderSide,
} from './viewState.ts';

describe('view state', () => {
  it('V swaps TPS shoulders without entering FPS', () => {
    const state = createViewState();

    pressShoulderKey(state);
    expect(state).toEqual({ cameraMode: 'TPS', tpsShoulder: 'Left', adsActive: false });

    pressShoulderKey(state);
    expect(state).toEqual({ cameraMode: 'TPS', tpsShoulder: 'Right', adsActive: false });
  });

  it('ADS enters FPS without overwriting the selected TPS shoulder', () => {
    const state = createViewState();
    pressShoulderKey(state); // Left

    beginAds(state);

    expect(state.cameraMode).toBe('FPS');
    expect(state.adsActive).toBe(true);
    expect(state.tpsShoulder).toBe('Left');
    expect(shoulderSide(state)).toBe(-1);
  });

  it('releasing ADS leaves FPS active', () => {
    const state = createViewState();
    beginAds(state);
    endAds(state);

    expect(state.cameraMode).toBe('FPS');
    expect(state.adsActive).toBe(false);
  });

  it('V from FPS returns to the previously selected TPS shoulder', () => {
    const state = createViewState();
    pressShoulderKey(state); // Left
    beginAds(state);
    endAds(state);

    pressShoulderKey(state);

    expect(state.cameraMode).toBe('TPS');
    expect(state.tpsShoulder).toBe('Left');
    expect(state.adsActive).toBe(false);
  });

  it('V from FPS leaves a valid TPS state even if ADS is still held', () => {
    const state = createViewState();
    beginAds(state);

    pressShoulderKey(state);

    expect(state).toEqual({ cameraMode: 'TPS', tpsShoulder: 'Right', adsActive: false });
  });

  it('ADS release and re-entry do not alter the stored shoulder', () => {
    const state = createViewState();
    pressShoulderKey(state); // Left

    beginAds(state);
    endAds(state);
    pressShoulderKey(state); // TPS Left

    beginAds(state);
    expect(state.tpsShoulder).toBe('Left');
    endAds(state);
    pressShoulderKey(state);

    expect(state.cameraMode).toBe('TPS');
    expect(state.tpsShoulder).toBe('Left');
  });
});
