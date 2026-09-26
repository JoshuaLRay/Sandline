/**
 * The demo face (T-5.07): what the page shows by default. Without `?qa` the
 * page is the game — the player's HUD, the lobby, the briefing, the menus —
 * and the QA layer (the readout, the tuning panels, the netgraph) is out of
 * sight until H asks for it; with `?qa` it is there from the start, as it
 * always was. Every other flag (`?squad`, `?enemies`, `?mission`, …) works
 * either way.
 */
export function qaFromSearch(search: string): boolean {
  return new URLSearchParams(search).has('qa');
}

/**
 * What H does, from where the QA layer stands: a hidden layer is shown
 * (folded, as `?qa` opens it); a shown one folds and unfolds its readout.
 * Returns the next state.
 */
export function pressH(state: { shown: boolean; folded: boolean }): { shown: boolean; folded: boolean } {
  if (!state.shown) return { shown: true, folded: true };
  return { shown: true, folded: !state.folded };
}
