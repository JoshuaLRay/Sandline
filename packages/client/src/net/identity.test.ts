import { describe, expect, it } from 'vitest';
import { type TokenStorage, forgetIdentity, identityKey, readIdentity, storeIdentity } from './identity.ts';

function memory(): TokenStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('the kept identity token (T-4.22)', () => {
  it('keeps a token per host, and the latest one wins', () => {
    const s = memory();
    expect(readIdentity('wss://a.example', s)).toBe('');
    storeIdentity('wss://a.example', 'one', s);
    storeIdentity('wss://b.example', 'other', s);
    storeIdentity('wss://a.example/', 'two', s);
    expect(readIdentity('wss://a.example', s)).toBe('two');
    expect(readIdentity('wss://b.example', s)).toBe('other');
  });

  it('ignores an empty token, so a session that issues none does not erase one', () => {
    const s = memory();
    storeIdentity('h', 'kept', s);
    storeIdentity('h', '', s);
    expect(readIdentity('h', s)).toBe('kept');
  });

  it('forgets a refused token', () => {
    const s = memory();
    storeIdentity('h', 'bad', s);
    forgetIdentity('h', s);
    expect(s.map.has(identityKey('h'))).toBe(false);
    expect(readIdentity('h', s)).toBe('');
  });

  it('survives storage that throws or does not exist', () => {
    const broken: TokenStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(readIdentity('h', broken)).toBe('');
    expect(() => storeIdentity('h', 't', broken)).not.toThrow();
    expect(() => forgetIdentity('h', broken)).not.toThrow();
    expect(readIdentity('h', null)).toBe('');
  });
});
