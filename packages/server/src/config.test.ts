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

  it('allows AI debug reports only when AI_DEBUG=1 (T-3.09)', () => {
    delete process.env['AI_DEBUG'];
    expect(loadConfig().aiDebug).toBe(false);
    process.env['AI_DEBUG'] = '0';
    expect(loadConfig().aiDebug).toBe(false);
    process.env['AI_DEBUG'] = '1';
    expect(loadConfig().aiDebug).toBe(true);
    process.env['AI_DEBUG'] = 'yes';
    expect(() => loadConfig()).toThrow(/AI_DEBUG must be 0 or 1/);
  });

  it('runs the AI in its rooms only when HOST_AI=1 (the deployed QA host)', () => {
    delete process.env['AI_DEBUG'];
    delete process.env['HOST_AI'];
    expect(loadConfig().hostAi).toBe(false);
    process.env['HOST_AI'] = '1';
    expect(loadConfig().hostAi).toBe(true);
    process.env['HOST_AI'] = 'on';
    expect(() => loadConfig()).toThrow(/HOST_AI must be 0 or 1/);
    delete process.env['HOST_AI'];
  });

  it('reads the join key and per-player limits, with limits on by default', () => {
    delete process.env['JOIN_KEY'];
    delete process.env['IDLE_TIMEOUT_MS'];
    delete process.env['MAX_SESSION_MS'];
    expect(loadConfig()).toMatchObject({ joinKey: '', idleTimeoutMs: 600_000, maxSessionMs: 14_400_000 });
    process.env['JOIN_KEY'] = 'hunter2';
    process.env['IDLE_TIMEOUT_MS'] = '0';
    process.env['MAX_SESSION_MS'] = '60000';
    expect(loadConfig()).toMatchObject({ joinKey: 'hunter2', idleTimeoutMs: 0, maxSessionMs: 60_000 });
    process.env['IDLE_TIMEOUT_MS'] = '-1';
    expect(() => loadConfig()).toThrow(/IDLE_TIMEOUT_MS must be 0/);
  });
});
