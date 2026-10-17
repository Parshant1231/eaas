import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FAILURE_INFO, FAILURE_TYPES, isFailureType, parseRecovery } from '../src/failures.js';
import { parseInjectionBuilds, type RawInjectBuild, type RawInjectQueueItem } from '../src/inject-client.js';

const raw = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  env_id: 'web1',
  failure: 'pod-kill',
  target: 'pod/api-1 on web1-node-1',
  injected_at: '2026-10-20T12:00:00Z',
  detected_seconds: 2.1,
  recovered_seconds: 14.3,
  revert_seconds: null,
  restored_seconds: null,
  alert_name: null,
  alert_seconds: null,
  recovered: true,
  failed_requests: 1,
  total_requests: 31,
  mechanism: 'Deployment controller',
  definition: 'replacement pod and all replicas ready',
  grafana_annotated: true,
  notes: '',
  ...o,
});

describe('failure types', () => {
  it('accepts the five known types only', () => {
    for (const t of FAILURE_TYPES) assert.equal(isFailureType(t), true, t);
    for (const bad of ['', 'reboot', 'pod-kill; rm -rf /', 'POD-KILL', null, 5, undefined]) {
      assert.equal(isFailureType(bad), false, String(bad));
    }
  });

  it('has a description for every type', () => {
    assert.deepEqual(FAILURE_INFO.map((f) => f.type).sort(), [...FAILURE_TYPES].sort());
  });
});

describe('parseRecovery', () => {
  it('maps the script output to camelCase', () => {
    const result = parseRecovery(raw());
    assert.equal(result?.envId, 'web1');
    assert.equal(result?.detectedSeconds, 2.1);
    assert.equal(result?.recoveredSeconds, 14.3);
    assert.equal(result?.revertSeconds, null);
    assert.equal(result?.alertName, null);
    assert.equal(result?.failedRequests, 1);
    assert.equal(result?.recovered, true);
  });

  it('keeps nulls for milestones that were never reached', () => {
    const result = parseRecovery(raw({ detected_seconds: null, recovered_seconds: null, recovered: false }));
    assert.equal(result?.detectedSeconds, null);
    assert.equal(result?.recovered, false);
  });

  it('rejects malformed or hostile data', () => {
    const bad: unknown[] = [
      null,
      [],
      'text',
      raw({ env_id: 'Bad_Name' }),
      raw({ failure: 'reboot' }),
      raw({ recovered: 'yes' }),
      raw({ detected_seconds: -1 }),
      raw({ recovered_seconds: Number.POSITIVE_INFINITY }),
      raw({ recovered_seconds: '14' }),
      raw({ failed_requests: 1.5 }),
      raw({ total_requests: -2 }),
    ];
    for (const value of bad) assert.equal(parseRecovery(value), null, JSON.stringify(value));
  });

  it('clips very long text', () => {
    const result = parseRecovery(raw({ mechanism: 'x'.repeat(5000) }));
    assert.equal(result?.mechanism.length, 400);
  });
});

describe('parseInjectionBuilds', () => {
  const action = (env: string, failure: string) => [{ parameters: [{ name: 'ENV_NAME', value: env }, { name: 'FAILURE', value: failure }] }];

  it('keeps valid builds, adds queued ones and sorts newest first', () => {
    const builds: RawInjectBuild[] = [
      { number: 1, building: false, result: 'SUCCESS', timestamp: 1000, duration: 5000, actions: action('web1', 'pod-kill') },
      { number: 2, building: true, result: null, timestamp: 3000, duration: 0, actions: action('web1', 'node-kill') },
      { number: 3, building: false, result: 'FAILURE', timestamp: 500, duration: 10, actions: [] },
      { number: 4, building: false, result: 'FAILURE', timestamp: 600, duration: 10, actions: action('web1', 'evil') },
    ];
    const queue: RawInjectQueueItem[] = [
      { inQueueSince: 4000, task: { name: 'eaas-inject' }, actions: action('web2', 'cpu-spike') },
      { inQueueSince: 4500, task: { name: 'eaas-create' }, actions: action('web3', 'pod-kill') },
    ];
    const runs = parseInjectionBuilds(builds, queue, 'eaas-inject');
    assert.deepEqual(runs.map((r) => r.envId), ['web2', 'web1', 'web1']);
    assert.equal(runs[0]?.queued, true);
    assert.equal(runs[0]?.number, null);
    assert.equal(runs[1]?.failure, 'node-kill');
    assert.equal(runs[2]?.result, 'SUCCESS');
  });
});
