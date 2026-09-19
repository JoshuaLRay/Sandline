/**
 * Player-facing camera state.
 *
 * TPS shoulder, camera mode, and ADS are deliberately independent pieces of
 * state. ADS enters FPS, but releasing ADS does not leave FPS; V is the only
 * action that exits FPS.
 */

export type CameraMode = 'TPS' | 'FPS';
export type TpsShoulder = 'Left' | 'Right';

export interface ViewState {
  cameraMode: CameraMode;
  tpsShoulder: TpsShoulder;
  adsActive: boolean;
}

export function createViewState(): ViewState {
  return {
    cameraMode: 'TPS',
    tpsShoulder: 'Right',
    adsActive: false,
  };
}

export function pressShoulderKey(state: ViewState): void {
  if (state.cameraMode === 'FPS') {
    state.cameraMode = 'TPS';
    state.adsActive = false;
    return;
  }
  state.tpsShoulder = state.tpsShoulder === 'Right' ? 'Left' : 'Right';
}

export function beginAds(state: ViewState): void {
  state.adsActive = true;
  if (state.cameraMode === 'TPS') state.cameraMode = 'FPS';
}

export function endAds(state: ViewState): void {
  state.adsActive = false;
  // Deliberately leave cameraMode unchanged.
}

export function shoulderSide(state: ViewState): 1 | -1 {
  return state.tpsShoulder === 'Right' ? 1 : -1;
}
