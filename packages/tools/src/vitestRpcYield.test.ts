import { MessageChannel } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';

describe('Vitest test boundaries flush pending worker IPC', () => {
  const { port1, port2 } = new MessageChannel();
  let acknowledged = false;
  port1.once('message', () => { acknowledged = true; });
  afterAll(() => { port1.close(); port2.close(); });

  it('queues a worker-style report without making a synchronous acknowledgement', () => {
    port2.postMessage('report acknowledgement');
    expect(acknowledged).toBe(false);
  });

  it('receives that report before the following test begins CPU work', () => {
    expect(acknowledged).toBe(true);
  });
});
