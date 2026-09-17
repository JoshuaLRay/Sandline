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
});
