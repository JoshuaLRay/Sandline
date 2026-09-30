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
  /** U-021: whether the character may aim down the sight; the support may not. */
  adsAllowed: boolean;
  /** U-021: whether the character may play in first person; the support may not. */
  firstPersonAllowed: boolean;
}

export function createViewState(): ViewState {
  return {
    cameraMode: 'TPS',
    tpsShoulder: 'Right',
    adsActive: false,
    adsAllowed: true,
    firstPersonAllowed: true,
  };
}

/**
 * What the character in hand may do with its view (U-021). Applied every frame,
 * so it holds through a respawn, a reconnect and a possession change alike:
 * a shooter who may not is put back in third person with the sight down.
 */
export function restrictView(state: ViewState, allowed: { ads: boolean; firstPerson: boolean }): void {
  state.adsAllowed = allowed.ads;
  state.firstPersonAllowed = allowed.firstPerson;
  if (!allowed.ads) state.adsActive = false;
  if (!allowed.firstPerson) state.cameraMode = 'TPS';
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
  if (!state.adsAllowed) return;
  state.adsActive = true;
  if (state.cameraMode === 'TPS' && state.firstPersonAllowed) state.cameraMode = 'FPS';
}

export function endAds(state: ViewState): void {
  state.adsActive = false;
  // Deliberately leave cameraMode unchanged.
}

export function shoulderSide(state: ViewState): 1 | -1 {
  return state.tpsShoulder === 'Right' ? 1 : -1;
}
