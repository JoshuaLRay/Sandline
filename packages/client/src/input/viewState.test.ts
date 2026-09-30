import { describe, expect, it } from 'vitest';
import {
  beginAds,
  createViewState,
  endAds,
  pressShoulderKey,
  restrictView,
  shoulderSide,
} from './viewState.ts';

const ALLOWED = { adsAllowed: true, firstPersonAllowed: true };

describe('view state', () => {
  it('V swaps TPS shoulders without entering FPS', () => {
    const state = createViewState();

    pressShoulderKey(state);
    expect(state).toEqual({ ...ALLOWED, cameraMode: 'TPS', tpsShoulder: 'Left', adsActive: false });

    pressShoulderKey(state);
    expect(state).toEqual({ ...ALLOWED, cameraMode: 'TPS', tpsShoulder: 'Right', adsActive: false });
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

    expect(state).toEqual({ ...ALLOWED, cameraMode: 'TPS', tpsShoulder: 'Right', adsActive: false });
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

  it('a character with no sight and no first person (the support, U-021) cannot enter either, by any path', () => {
    const state = createViewState();
    restrictView(state, { ads: false, firstPerson: false });
    beginAds(state);
    expect(state).toMatchObject({ cameraMode: 'TPS', adsActive: false });
    // Even after being in first person and aiming as another character: the restriction puts them back.
    const other = createViewState();
    beginAds(other);
    expect(other).toMatchObject({ cameraMode: 'FPS', adsActive: true });
    restrictView(other, { ads: false, firstPerson: false });
    expect(other).toMatchObject({ cameraMode: 'TPS', adsActive: false });
    beginAds(other);
    pressShoulderKey(other);
    expect(other).toMatchObject({ cameraMode: 'TPS', adsActive: false });
  });

  it('lifting the restriction gives the sight and first person back', () => {
    const state = createViewState();
    restrictView(state, { ads: false, firstPerson: false });
    restrictView(state, { ads: true, firstPerson: true });
    beginAds(state);
    expect(state).toMatchObject({ cameraMode: 'FPS', adsActive: true });
  });
});
