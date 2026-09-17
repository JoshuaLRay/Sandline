/** Environment-derived server config (T-0.07). */
export interface ServerConfig {
  port: number;
  tickHz: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got '${raw}'`);
  return n;
}

export function loadConfig(): ServerConfig {
  const level = process.env['LOG_LEVEL'] ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw new Error(`LOG_LEVEL must be debug|info|warn|error, got '${level}'`);
  }
  return {
    port: intFromEnv('PORT', 8080),
    tickHz: intFromEnv('TICK_HZ', 30),
    logLevel: level as ServerConfig['logLevel'],
  };
}
