/**
 * The mission HUD line (T-3.34): read from the host's message, round-tripped
 * through the wire as a client receives it.
 */
import { describe, expect, it } from 'vitest';
import { type Message, TICK_SECONDS, decodeMessage, encodeMessage } from '@sandline/shared';
import { missionLine } from './missionHud.ts';

const HOLD = Math.round(30 / TICK_SECONDS);
const wire = (m: Extract<Message, { kind: 'Mission' }>) => decodeMessage(encodeMessage(m)) as Extract<Message, { kind: 'Mission' }>;

describe('the mission HUD line (T-3.34)', () => {
  it('reads each state from the message as it arrives', () => {
    expect(missionLine(null)).toBe('');
    expect(missionLine(wire({ kind: 'Mission', state: 'progress', clear: false, heldTicks: 0, holdTicks: HOLD, attempt: 1 }))).toBe('Objective: clear the compound  ·  held 0/30 s');
    expect(missionLine(wire({ kind: 'Mission', state: 'progress', clear: true, heldTicks: Math.round(12.5 / TICK_SECONDS), holdTicks: HOLD, attempt: 1 }))).toBe('Objective: hold the compound  ·  held 12/30 s');
    expect(missionLine(wire({ kind: 'Mission', state: 'complete', clear: true, heldTicks: HOLD, holdTicks: HOLD, attempt: 1 }))).toMatch(/mission complete .*P to play again/);
    expect(missionLine(wire({ kind: 'Mission', state: 'failed', clear: false, heldTicks: 0, holdTicks: HOLD, attempt: 3 }))).toMatch(/mission failed .*attempt 3 .*P to try again/);
  });
});
