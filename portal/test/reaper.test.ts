import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decide, parseRequests, pollOnce, type PollerDeps } from '../src/reaper.js';
import type { QueueMessage } from '../src/sqs.js';
import type { EnvironmentView } from '../src/types.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');

const view = (o: Partial<EnvironmentView> = {}): EnvironmentView => ({
  envId: 'web1',
  state: 'ready',
  note: '',
  owner: 'kelvrix',
  size: 'small',
  ttlHours: 1,
  expiresAt: '2026-10-20T11:50:00Z',
  minutesRemaining: 0,
  cost: null,
  appUrl: null,
  grafanaUrl: null,
  latestBuild: null,
  ...o,
});

const msg = (body: string, n = 1): QueueMessage => ({ id: `m${n}`, receiptHandle: `h${n}`, body });
const request = (envId: string, n = 1): QueueMessage => msg(JSON.stringify({ envId, reason: 'expired' }), n);

describe('parseRequests', () => {
  it('deduplicates valid requests', () => {
    assert.deepEqual(parseRequests([request('web1', 1), request('web1', 2), request('web2', 3)]).envIds, ['web1', 'web2']);
  });

  it('counts malformed messages and injection attempts as invalid', () => {
    const result = parseRequests([
      msg('not json'),
      msg('null'),
      msg('{"envId":"x; rm -rf /"}'),
      msg('{"envId":5}'),
      msg('{}'),
    ]);
    assert.deepEqual(result.envIds, []);
    assert.equal(result.invalid, 5);
  });
});

describe('decide', () => {
  it('destroys an expired ready environment', () => {
    assert.equal(decide(['web1'], [view()], NOW)[0]?.action, 'destroy');
  });

  it('destroys an expired environment that needs cleanup', () => {
    assert.equal(decide(['web1'], [view({ state: 'needs-cleanup' })], NOW)[0]?.action, 'destroy');
  });

  it('skips an environment that was extended after the message was sent', () => {
    const decision = decide(['web1'], [view({ expiresAt: '2026-10-20T13:00:00Z' })], NOW)[0];
    assert.equal(decision?.action, 'skip');
    assert.match(decision?.reason ?? '', /not expired/);
  });

  it('skips environments that are creating, destroying or failed', () => {
    for (const state of ['creating', 'destroying', 'failed'] as const) {
      assert.equal(decide(['web1'], [view({ state })], NOW)[0]?.action, 'skip', state);
    }
  });

  it('skips unknown environments and ones without a valid expiry', () => {
    assert.equal(decide(['ghost1'], [view()], NOW)[0]?.action, 'skip');
    assert.equal(decide(['web1'], [view({ expiresAt: null })], NOW)[0]?.action, 'skip');
  });
});

describe('pollOnce', () => {
  function setup(messages: QueueMessage[], environments: EnvironmentView[], failTrigger = false) {
    const triggered: string[] = [];
    const removed: QueueMessage[][] = [];
    const deps: PollerDeps = {
      queue: {
        receive: async () => messages,
        remove: async (m) => {
          removed.push(m);
        },
      },
      loadEnvironments: async () => environments,
      triggerDestroy: async (envId) => {
        if (failTrigger) throw new Error('jenkins down');
        triggered.push(envId);
      },
      serialize: (fn) => fn(),
      now: () => NOW,
      log: () => undefined,
    };
    return { deps, triggered, removed };
  }

  it('triggers one destroy for duplicate messages and then removes them all', async () => {
    const messages = [request('web1', 1), request('web1', 2), request('web1', 3)];
    const { deps, triggered, removed } = setup(messages, [view()]);
    await pollOnce(deps);
    assert.deepEqual(triggered, ['web1']);
    assert.equal(removed[0]?.length, 3);
  });

  it('does not trigger anything for a non-expired environment but still clears the message', async () => {
    const { deps, triggered, removed } = setup([request('web1')], [view({ expiresAt: '2026-10-20T13:00:00Z' })]);
    await pollOnce(deps);
    assert.deepEqual(triggered, []);
    assert.equal(removed.length, 1);
  });

  it('keeps the messages when Jenkins fails, so the request is retried', async () => {
    const { deps, removed } = setup([request('web1')], [view()], true);
    await assert.rejects(pollOnce(deps), /jenkins down/);
    assert.equal(removed.length, 0);
  });
});
