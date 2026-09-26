/**
 * Callouts as data (T-2.49): the committed file parses, every event has a
 * line the voice pipeline renders (with the pass it comes from), and what is
 * wrong is refused by name.
 */
import { describe, expect, it } from 'vitest';
import { CALLOUTS, CALLOUT_EVENTS, isCalloutEvent, parseCallouts, renderedLines } from '../index.ts';
import RAW from '../data/audio/callouts.json' with { type: 'json' };

const withEvent = (id: string, patch: Record<string, unknown>) => ({ ...RAW, events: { ...RAW.events, [id]: { ...(RAW.events as Record<string, object>)[id], ...patch } } });

describe('callouts (T-2.49)', () => {
  it('parses the committed file: every event, every line rendered, with its pass', () => {
    expect(Object.keys(CALLOUTS.events).sort()).toEqual([...CALLOUT_EVENTS].sort());
    expect(CALLOUTS.events['frag-out'].lines).toEqual([{ line: 'frag-out', style: 'shout' }]);
    expect(CALLOUTS.events.hit.lines.map((l) => l.style)).toEqual(['shout', 'hurt', 'hurt']);
    expect(CALLOUTS.events['order-failed'].lines).toEqual([{ line: 'cant-get-there', style: 'normal' }]);
    expect(renderedLines().get('pain-groan')).toBe('hurt');
    expect(isCalloutEvent('man-down')).toBe(true);
    expect(isCalloutEvent('contact-front')).toBe(false);
  });

  it('refuses what is wrong, each by name', () => {
    expect(() => parseCallouts({ ...RAW, chirp: 'beep' })).toThrow("callouts.chirp: no sound 'beep' in sounds.json");
    expect(() => parseCallouts(withEvent('contact', { lines: ['hello'] }))).toThrow("callouts.events.contact.lines[0]: 'hello' is not a line the voice pipeline renders");
    expect(() => parseCallouts(withEvent('contact', { scope: 'team' }))).toThrow('callouts.events.contact.scope must be squad or speaker');
    expect(() => parseCallouts(withEvent('contact', { loud: true }))).toThrow("callouts.events.contact: unknown key 'loud'");
    const { hit: _hit, ...rest } = RAW.events;
    expect(() => parseCallouts({ ...RAW, events: rest })).toThrow("callouts.events: missing 'hit'");
  });
});
