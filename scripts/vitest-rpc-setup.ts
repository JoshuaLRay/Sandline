import { setImmediate as yieldToIo } from 'node:timers/promises';
import { afterEach, beforeEach } from 'vitest';

// CPU-heavy map/navigation assertions can hold a Vitest 3 worker for >60s.
// Let pending worker reports receive their IPC acknowledgements between tests.
// Keep every assertion, timeout, performance budget and unhandled-error gate.
const flushIo = async () => {
  await yieldToIo();
  await yieldToIo();
};
beforeEach(flushIo);
afterEach(flushIo);
