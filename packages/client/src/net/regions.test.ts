/**
 * Region selection (T-4.20): the choice from fake round trips, the
 * remembered override, a code from another region resolving to it, and the
 * health URL and the ping's failure modes.
 */
import { describe, expect, it } from 'vitest';
import type { Region } from '@sandline/shared';
import { describeRtt, healthUrl, measureRtt, pickRegion, regionForCode } from './regions.ts';

const na: Region = { id: 'na-east', fly: 'iad', name: 'North America (East)', tag: 'A', host: 'wss://sandline-iad.fly.dev' };
const eu: Region = { id: 'eu-west', fly: 'lhr', name: 'Europe (West)', tag: 'C', host: 'wss://sandline-lhr.fly.dev' };
const oc: Region = { id: 'oceania', fly: 'syd', name: 'Oceania', tag: 'D', host: 'wss://sandline-syd.fly.dev' };
const all = [na, eu, oc];
const rtts = (m: Record<string, number | null>) => new Map(Object.entries(m));

describe('pickRegion (T-4.20)', () => {
  it('picks the lowest round trip among the regions that answered', () => {
    expect(pickRegion(all, rtts({ 'na-east': 95, 'eu-west': 28, oceania: 260 }), null)).toBe(eu);
    expect(pickRegion(all, rtts({ 'na-east': 40, 'eu-west': null, oceania: 260 }), null)).toBe(na);
  });

  it('keeps the remembered choice whatever the numbers, unless it no longer exists', () => {
    expect(pickRegion(all, rtts({ 'na-east': 95, 'eu-west': 28 }), 'oceania')).toBe(oc);
    expect(pickRegion(all, rtts({ 'na-east': 95, 'eu-west': 28 }), 'mars')).toBe(eu);
  });

  it('falls back to the first region when nothing answered, and to null with none', () => {
    expect(pickRegion(all, rtts({ 'na-east': null, 'eu-west': null }), null)).toBe(na);
    expect(pickRegion(all, new Map(), null)).toBe(na);
    expect(pickRegion([], new Map(), null)).toBeNull();
  });
});

describe('a code from another region (T-4.20)', () => {
  it('resolves to the region its tag names, and an untagged code to none', () => {
    expect(regionForCode('C-KM7X', all)).toBe(eu);
    expect(regionForCode('d km7xrt34', all)).toBe(oc);
    expect(regionForCode('KM7X', all)).toBeNull();
    expect(regionForCode('X-KM7X', all)).toBeNull();
    expect(regionForCode('', all)).toBeNull();
  });
});

describe('the ping (T-4.20)', () => {
  it('asks /healthz over https for a wss host and times the answer on the given clock', async () => {
    expect(healthUrl('wss://sandline-iad.fly.dev')).toBe('https://sandline-iad.fly.dev/healthz');
    expect(healthUrl('ws://192.168.1.5:8080/?room=X')).toBe('http://192.168.1.5:8080/healthz');
    let t = 1000;
    const asked: string[] = [];
    const fetcher = ((input: string | URL | Request) => {
      asked.push(String(input));
      t += 42;
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    }) as typeof fetch;
    expect(await measureRtt(na, { fetch: fetcher, now: () => t })).toBe(42);
    expect(asked).toEqual(['https://sandline-iad.fly.dev/healthz']);
  });

  it('is null for a host that fails, answers badly, or takes too long', async () => {
    const failing = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    expect(await measureRtt(na, { fetch: failing })).toBeNull();
    const bad = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    expect(await measureRtt(na, { fetch: bad })).toBeNull();
    const slow = ((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    expect(await measureRtt(na, { fetch: slow, timeoutMs: 20 })).toBeNull();
    expect(describeRtt(undefined)).toBe('…');
    expect(describeRtt(null)).toBe('no answer');
    expect(describeRtt(41.6)).toBe('42 ms');
  });
});
