/** Structured JSON logging (T-0.07) — one object per line, for log aggregation. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

export function createLogger(min: Level) {
  const threshold = LEVELS[min];
  const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < threshold) return;
    process.stdout.write(
      `${JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields })}\n`,
    );
  };
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
    info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
    error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
  };
}
export type Logger = ReturnType<typeof createLogger>;
