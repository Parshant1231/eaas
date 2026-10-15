import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEnvironmentList, occupiesCapacity } from '../src/envs.js';
import type { AwsEnvironment, BuildInfo } from '../src/types.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const MIN = 60_000;

const aws = (o: Partial<AwsEnvironment> = {}): AwsEnvironment => ({
  envId: 'demo1',
  owner: 'kelvrix',
  size: 'medium',
  ttlHours: 2,
  expiresAt: '2026-10-20T13:30:00Z',
  serverPublicIp: '13.201.10.20',
  instanceCount: 2,
  ...o,
});

const build = (o: Partial<BuildInfo> = {}): BuildInfo => ({
  job: 'create',
  number: 7,
  envId: 'demo1',
  queued: false,
  building: false,
  result: 'SUCCESS',
  timestamp: NOW - 20 * MIN,
  durationMs: 9 * MIN + 12_000,
  size: 'medium',
  ttlHours: 2,
  owner: 'kelvrix',
  ...o,
});

const list = (a: AwsEnvironment[], b: BuildInfo[]) => buildEnvironmentList({ aws: a, builds: b, now: NOW });

describe('environment state', () => {
  it('ready: links, time remaining and creation time', () => {
    const [env] = list([aws()], [build()]);
    assert.equal(env?.state, 'ready');
    assert.equal(env?.appUrl, 'http://13.201.10.20:30080');
    assert.equal(env?.grafanaUrl, 'http://13.201.10.20:30300');
    assert.equal(env?.minutesRemaining, 90);
    assert.match(env?.note ?? '', /Created in 9m 12s/);
  });

  it('small environments have no Grafana link', () => {
    const [env] = list([aws({ size: 'small' })], [build({ size: 'small' })]);
    assert.equal(env?.state, 'ready');
    assert.equal(env?.grafanaUrl, null);
  });

  it('never builds links from a suspicious address', () => {
    const [env] = list([aws({ serverPublicIp: '1.2.3.4; evil' })], [build()]);
    assert.equal(env?.appUrl, null);
  });

  it('creating: queued build, nothing in AWS yet', () => {
    const [env] = list([], [build({ number: null, queued: true, result: null, timestamp: NOW - MIN })]);
    assert.equal(env?.state, 'creating');
    assert.equal(env?.latestBuild?.number, null);
    assert.equal(env?.appUrl, null);
  });

  it('creating: build running and resources appearing', () => {
    const [env] = list([aws()], [build({ building: true, result: null })]);
    assert.equal(env?.state, 'creating');
    assert.equal(env?.appUrl, null);
  });

  it('destroying: a newer destroy build is running', () => {
    const [env] = list([aws()], [build(), build({ job: 'destroy', number: 3, building: true, result: null, timestamp: NOW - MIN })]);
    assert.equal(env?.state, 'destroying');
  });

  it('failed: build failed and AWS is clean', () => {
    const [env] = list([], [build({ result: 'FAILURE', timestamp: NOW - 30 * MIN })]);
    assert.equal(env?.state, 'failed');
    assert.equal(env?.appUrl, null);
  });

  it('old cleaned-up failures disappear', () => {
    assert.deepEqual(list([], [build({ result: 'FAILURE', timestamp: NOW - 7 * 60 * MIN })]), []);
  });

  it('needs-cleanup: build failed but resources remain', () => {
    const [env] = list([aws()], [build({ result: 'FAILURE' })]);
    assert.equal(env?.state, 'needs-cleanup');
  });

  it('needs-cleanup: the latest destroy failed', () => {
    const [env] = list([aws()], [build({ timestamp: NOW - 60 * MIN }), build({ job: 'destroy', number: 3, result: 'FAILURE', timestamp: NOW - 30 * MIN })]);
    assert.equal(env?.state, 'needs-cleanup');
  });

  it('external: exists in AWS with no build record', () => {
    const [env] = list([aws()], []);
    assert.equal(env?.state, 'external');
  });

  it('destroyed environments are not listed', () => {
    const destroyed = [build({ timestamp: NOW - 60 * MIN }), build({ job: 'destroy', number: 3, timestamp: NOW - 30 * MIN })];
    assert.deepEqual(list([], destroyed), []);
  });

  it('environments that expired out of AWS are not listed', () => {
    assert.deepEqual(list([], [build()]), []);
  });

  it('re-creating after a destroy shows creating', () => {
    const builds = [
      build({ job: 'destroy', number: 3, timestamp: NOW - 60 * MIN }),
      build({ number: 8, building: true, result: null, timestamp: NOW - MIN }),
    ];
    const [env] = list([], builds);
    assert.equal(env?.state, 'creating');
  });

  it('only failed environments are free of the capacity cap', () => {
    assert.equal(occupiesCapacity('failed'), false);
    for (const state of ['creating', 'ready', 'destroying', 'needs-cleanup', 'external'] as const) {
      assert.equal(occupiesCapacity(state), true, state);
    }
  });
});
