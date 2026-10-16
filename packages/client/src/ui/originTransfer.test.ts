import { describe, expect, it } from 'vitest';
import { exportSiteTransfer, importSiteTransfer } from './originTransfer.ts';
import { identityKey } from '../net/identity.ts';

const HOST = 'wss://sandline-host.fly.dev';
const ID = 'A'.repeat(22);
const TOKEN = `v1.${ID}.1790000000.1800000000.${'B'.repeat(43)}`;
const VOICE = { id: 'a'.repeat(32), token: 'b'.repeat(64) };
const VOICE_KEY = 'sandline.voice-submission.https://sandline-host.fly.dev';

function storage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return { entries, getItem: (k) => entries.get(k) ?? null, setItem: (k, v) => { entries.set(k, v); } };
}

describe('offline origin transfer', () => {
  it('exports only known host identity and voice credentials and imports them on a different origin', () => {
    const old = storage();
    old.setItem(identityKey(HOST), TOKEN);
    old.setItem(VOICE_KEY, JSON.stringify(VOICE));
    old.setItem('sandline.joinKey', 'NEVER-EXPORT-ME');
    old.setItem('sandline.identity.wss://other.example', 'other-private-data');
    const file = exportSiteTransfer(HOST, old);
    expect(file).not.toBeNull();
    expect(file).not.toContain('NEVER-EXPORT-ME');
    expect(file).not.toContain('other-private-data');
    const fresh = storage();
    expect(importSiteTransfer(HOST, fresh, file!)).toEqual({ identity: true, voice: true });
    expect(fresh.getItem(identityKey(HOST))).toBe(TOKEN);
    expect(JSON.parse(fresh.getItem(VOICE_KEY)!) as unknown).toEqual(VOICE);
    expect(fresh.entries.size).toBe(2);
  });

  it('handles missing, corrupt or unsupported saved credentials without exporting them', () => {
    const old = storage();
    expect(exportSiteTransfer(HOST, old)).toBeNull();
    old.setItem(identityKey(HOST), 'not-a-signed-token');
    old.setItem(VOICE_KEY, '{invalid json');
    expect(exportSiteTransfer(HOST, old)).toBeNull();
    old.setItem(VOICE_KEY, JSON.stringify(VOICE));
    expect(JSON.parse(exportSiteTransfer(HOST, old)!) as Record<string, unknown>).not.toHaveProperty('identity');
  });

  it('rejects unrelated hosts and malformed backups before changing storage', () => {
    const dest = storage();
    const src = storage();
    src.setItem(identityKey(HOST), TOKEN);
    const saved = exportSiteTransfer(HOST, src)!;
    for (const invalid of [
      '{bad-json',
      saved.replace('wss://sandline-host.fly.dev', 'wss://evil.example'),
      saved.replace('sandline-site-transfer-v1', 'untrusted-format'),
      saved.replace(TOKEN, 'forged'),
      JSON.stringify({ format: 'sandline-site-transfer-v1', host: HOST, voice: { id: 'a'.repeat(32), token: 'bad' } }),
      'x'.repeat(9000),
    ]) {
      expect(() => importSiteTransfer(HOST, dest, invalid)).toThrow();
      expect(dest.entries.size).toBe(0);
    }
    expect(() => exportSiteTransfer('https://untrusted.example', src)).toThrow();
  });
});
