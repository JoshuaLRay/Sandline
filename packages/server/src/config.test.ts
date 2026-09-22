import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('loadConfig (T-0.07)', () => {
  it('falls back to defaults', () => {
    delete process.env['PORT'];
    delete process.env['LOG_LEVEL'];
    const c = loadConfig();
    expect(c.port).toBe(8080);
    expect(c.logLevel).toBe('info');
  });

  it('reads overrides from the environment', () => {
    process.env['PORT'] = '9999';
    process.env['LOG_LEVEL'] = 'debug';
    expect(loadConfig().port).toBe(9999);
    expect(loadConfig().logLevel).toBe('debug');
  });

  it('rejects bad values loudly instead of silently defaulting', () => {
    process.env['PORT'] = 'not-a-port';
    expect(() => loadConfig()).toThrow(/must be an integer/);
    process.env['PORT'] = '8080';
    process.env['LOG_LEVEL'] = 'verbose';
    expect(() => loadConfig()).toThrow(/LOG_LEVEL/);
  });

  it('names a world by id, defaulting to the range, and refuses one this build lacks (T-3.02)', () => {
    delete process.env['WORLD'];
    expect(loadConfig().world).toBe('range');
    process.env['WORLD'] = 'range';
    expect(loadConfig().world).toBe('range');
    process.env['WORLD'] = 'atlantis';
    expect(() => loadConfig()).toThrow(/WORLD must be one of range/);
  });
});
