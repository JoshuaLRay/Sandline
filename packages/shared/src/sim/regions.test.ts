/**
 * Regions as data (T-4.20): the file parses and refuses by name; a code
 * carries its region as a tag and comes apart again; a host is a region's
 * or nobody's.
 */
import { describe, expect, it } from 'vitest';
import { REGIONS, type Region, parseRegions, regionByTag, regionForHost, splitTaggedCode, tagCode } from '../index.ts';

const na: Region = { id: 'na-east', fly: 'iad', name: 'North America (East)', tag: 'A', host: 'wss://sandline-iad.fly.dev' };
const eu: Region = { id: 'eu-west', fly: 'lhr', name: 'Europe (West)', tag: 'C', host: 'wss://sandline-lhr.fly.dev' };
const two = [na, eu];

describe('the regions file', () => {
  it('parses the committed regions, each with a voice-safe tag and a wss address', () => {
    expect(REGIONS.length).toBeGreaterThan(0);
    for (const r of REGIONS) {
      expect(r.tag).toHaveLength(1);
      expect(r.host.startsWith('wss://')).toBe(true);
    }
    expect(regionByTag(REGIONS[0]!.tag)).toBe(REGIONS[0]);
  });

  it('refuses unknown keys, a bad tag, a tag or id used twice, a ws:// host and an empty list, each by name', () => {
    const file = (regions: unknown[]) => ({ regions });
    expect(parseRegions(file([na, eu]))).toEqual([na, eu]);
    expect(() => parseRegions(file([{ ...na, ping: 1 }]))).toThrow("unknown key 'ping'");
    expect(() => parseRegions(file([{ ...na, tag: 'O' }]))).toThrow('tag must be one letter');
    expect(() => parseRegions(file([{ ...na, tag: 'AB' }]))).toThrow('tag must be one letter');
    expect(() => parseRegions(file([na, { ...eu, tag: 'A' }]))).toThrow("tag 'A' is used twice");
    expect(() => parseRegions(file([na, { ...eu, id: 'na-east' }]))).toThrow("id 'na-east' is used twice");
    expect(() => parseRegions(file([{ ...na, host: 'ws://sandline-iad.fly.dev' }]))).toThrow('bare wss:// address');
    expect(() => parseRegions(file([{ ...na, fly: 'iad1' }]))).toThrow('three lowercase letters');
    expect(() => parseRegions(file([]))).toThrow('non-empty list');
    expect(() => parseRegions({ regions: [na], extra: 1 })).toThrow("unknown key 'extra'");
  });
});

describe('tagged codes', () => {
  it('puts a region on a code and takes it off again, forgiving what a person types', () => {
    expect(tagCode('A', 'KM7X')).toBe('A-KM7X');
    expect(splitTaggedCode('A-KM7X', two)).toEqual({ tag: 'A', code: 'KM7X' });
    expect(splitTaggedCode('c km7x', two)).toEqual({ tag: 'C', code: 'KM7X' });
    expect(splitTaggedCode('C-KM7XRT34', two)).toEqual({ tag: 'C', code: 'KM7XRT34' });
    expect(splitTaggedCode('KM7X', two)).toEqual({ tag: null, code: 'KM7X' });
    expect(splitTaggedCode('km7xrt34', two)).toEqual({ tag: null, code: 'KM7XRT34' });
    expect(splitTaggedCode('', two)).toEqual({ tag: null, code: '' });
  });

  it('is null for a tag no region has, and for a length that is no code', () => {
    expect(splitTaggedCode('X-KM7X', two)).toBeNull();
    expect(splitTaggedCode('KM7', two)).toBeNull();
    expect(splitTaggedCode('A-KM7XR', two)).toBeNull();
  });

  it("knows a region's host, with or without a trailing slash, and nobody else's", () => {
    expect(regionForHost('wss://sandline-lhr.fly.dev', two)).toBe(eu);
    expect(regionForHost('wss://sandline-lhr.fly.dev/', two)).toBe(eu);
    expect(regionForHost('ws://192.168.1.5:8080', two)).toBeNull();
  });
});
