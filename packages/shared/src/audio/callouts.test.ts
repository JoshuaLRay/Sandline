/**
 * Callouts as data (T-2.49): the committed file parses, every event has a
 * line the voice pipeline renders (with the pass it comes from), and what is
 * wrong is refused by name.
 */
import { describe, expect, it } from 'vitest';
import { CALLOUTS, CALLOUT_EVENTS, isCalloutEvent, parseCallouts, renderedLines, sectionOfLine } from '../index.ts';
import RAW from '../data/audio/callouts.json' with { type: 'json' };

const withEvent = (id: string, patch: Record<string, unknown>) => ({ ...RAW, events: { ...RAW.events, [id]: { ...(RAW.events as Record<string, object>)[id], ...patch } } });

describe('callouts (T-2.49)', () => {
  it('parses the committed file: every event, every line rendered, with its pass', () => {
    expect(Object.keys(CALLOUTS.events).sort()).toEqual([...CALLOUT_EVENTS].sort());
    expect(CALLOUTS.events['frag-out'].lines).toEqual([{ line: 'frag-out', style: 'shout' }]);
    // U-012: the words and the body's sound of one moment are two cues, on two routes.
    expect(CALLOUTS.events.hit).toMatchObject({ route: 'radio', lines: [{ line: 'im-hit', style: 'shout' }] });
    expect(CALLOUTS.events['hit-grunt'].lines.map((l) => l.style)).toEqual(['hurt', 'hurt']);
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

describe('cue routes (U-012)', () => {
  it('every event is heard on a route: dialogue on the radio route, a body\'s sounds on the body route, the enemy\'s shouts on the shout route', () => {
    const route = (id: keyof typeof CALLOUTS.events) => CALLOUTS.events[id].route;
    for (const id of ['contact', 'reloading', 'hit', 'down', 'man-down', 'order-move', 'objective-done'] as const) expect(route(id), id).toBe('radio');
    for (const id of ['hit-grunt', 'downed-cry', 'dying'] as const) expect(route(id), id).toBe('body');
    expect(route('enemy-engage')).toBe('shout');
    // A dying breath is not a downed cry: distinct cues, distinct lines.
    expect(CALLOUTS.events.dying.lines.map((l) => l.line)).toEqual(['dying-sigh']);
    expect(CALLOUTS.events['downed-cry'].lines.map((l) => l.line)).not.toContain('dying-sigh');
    // The enemy's lines are the enemy's; nobody in the squad shouts them.
    for (const { line } of CALLOUTS.events['enemy-engage'].lines) expect(sectionOfLine(line)?.speakers, line).toBe('enemy');
    for (const id of CALLOUT_EVENTS) if (route(id) !== 'shout') for (const { line } of CALLOUTS.events[id].lines) expect(sectionOfLine(line)?.speakers, `${id}: ${line}`).toBe('squad');
    // Only the radio has a stand-in; a body's sound and a shout are silent until recorded.
    expect(CALLOUTS.routes.radio.placeholder).toBe(CALLOUTS.chirp);
    expect(CALLOUTS.routes.body.placeholder).toBeNull();
    expect(CALLOUTS.routes.shout.placeholder).toBeNull();
    expect(CALLOUTS.routes.body.audibleM).toBeLessThan(CALLOUTS.radioBeyondM);
  });

  it('refuses a route that does not exist, a shout in the squad\'s voice, a squad line in the enemy\'s, and a placeholder that is not a sound', () => {
    expect(() => parseCallouts(withEvent('contact', { route: 'tannoy' }))).toThrow('callouts.events.contact.route must be one of radio, body, shout');
    const { route: _route, ...unrouted } = RAW.events.contact;
    expect(() => parseCallouts({ ...RAW, events: { ...RAW.events, contact: unrouted } })).toThrow("callouts.events.contact: missing 'route'");
    expect(() => parseCallouts(withEvent('enemy-engage', { lines: ['contact'] }))).toThrow("callouts.events.enemy-engage.lines[0]: 'contact' is not said by the enemy's voices");
    expect(() => parseCallouts(withEvent('contact', { lines: ['open-fire'] }))).toThrow("callouts.events.contact.lines[0]: 'open-fire' is not said by the squad's voices");
    expect(() => parseCallouts(withEvent('enemy-engage', { self: true }))).toThrow("an enemy's shout is never your own soldier's");
    expect(() => parseCallouts({ ...RAW, routes: { ...RAW.routes, body: { ...RAW.routes.body, placeholder: 'moo' } } })).toThrow("callouts.routes.body.placeholder: no sound 'moo'");
    expect(() => parseCallouts({ ...RAW, routes: { radio: RAW.routes.radio, body: RAW.routes.body } })).toThrow("callouts.routes: missing 'shout'");
  });
});
