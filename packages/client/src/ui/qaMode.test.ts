/**
 * The demo face (T-5.07): `?qa` alone opens the QA layer, and H from a
 * hidden layer shows it folded, then folds and unfolds it.
 */
import { describe, expect, it } from 'vitest';
import { pressH, qaFromSearch } from './qaMode.ts';

describe('the demo face (T-5.07)', () => {
  it('shows the QA layer only when ?qa asks, whatever else the URL says', () => {
    expect(qaFromSearch('')).toBe(false);
    expect(qaFromSearch('?squad&enemies&mission')).toBe(false);
    expect(qaFromSearch('?qa')).toBe(true);
    expect(qaFromSearch('?squad&qa&host=ws://x')).toBe(true);
  });

  it('H brings a hidden layer back folded, then folds and unfolds it', () => {
    let s = { shown: false, folded: true };
    s = pressH(s);
    expect(s).toEqual({ shown: true, folded: true });
    s = pressH(s);
    expect(s).toEqual({ shown: true, folded: false });
    expect(pressH(s)).toEqual({ shown: true, folded: true });
  });
});
