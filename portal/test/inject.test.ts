import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import type { AwsReader } from '../src/aws.js';
import type { InjectionBuild, RecoveryResult } from '../src/failures.js';
import type { InjectApi } from '../src/inject-client.js';
import type { JenkinsApi } from '../src/jenkins.js';
import type { AwsEnvironment, BuildInfo } from '../src/types.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const MIN = 60_000;

let awsEnvs: AwsEnvironment[] = [];
let builds: BuildInfo[] = [];
let injBuilds: InjectionBuild[] = [];
let recoveries = new Map<number, RecoveryResult | null>();
let triggered: Array<{ envId: string; failure: string }> = [];
let recoveryFetches = 0;

const fakeJenkins: JenkinsApi = {
  async triggerCreate() {},
  async triggerDestroy() {},
  async listBuilds() {
    return builds;
  },
  async getStages() {
    return { status: 'SUCCESS', stages: [] };
  },
  async streamLog() {
    return { result: 'SUCCESS' };
  },
};

const fakeAws: AwsReader = {
  async listEnvironments() {
    return awsEnvs;
  },
  async extendExpiry() {},
};

const fakeInjector: InjectApi = {
  async trigger(envId, failure) {
    triggered.push({ envId, failure });
  },
  async list() {
    return injBuilds;
  },
  async getRecovery(number) {
    recoveryFetches += 1;
    return recoveries.get(number) ?? null;
  },
};

const awsEnv = (o: Partial<AwsEnvironment> = {}): AwsEnvironment => ({
  envId: 'web1',
  owner: 'kelvrix',
  size: 'medium',
  ttlHours: 2,
  expiresAt: '2026-10-20T14:00:00Z',
  serverPublicIp: '13.201.10.20',
  instanceCount: 2,
  vpcId: 'vpc-0abc12345',
  instanceIds: ['i-0aaa11111', 'i-0bbb22222'],
  launchedAt: '2026-10-20T11:30:00Z',
  ...o,
});

const createBuild = (o: Partial<BuildInfo> = {}): BuildInfo => ({
  job: 'create',
  number: 1,
  envId: 'web1',
  queued: false,
  building: false,
  result: 'SUCCESS',
  timestamp: NOW - 20 * MIN,
  durationMs: 9 * MIN,
  size: 'medium',
  ttlHours: 2,
  owner: 'kelvrix',
  ...o,
});

const injection = (o: Partial<InjectionBuild> = {}): InjectionBuild => ({
  number: 5,
  envId: 'web1',
  failure: 'pod-kill',
  queued: false,
  building: false,
  result: 'SUCCESS',
  timestamp: NOW - 5 * MIN,
  durationMs: 60_000,
  ...o,
});

const recovery = (): RecoveryResult => ({
  envId: 'web1',
  failure: 'pod-kill',
  target: 'pod/api-1',
  injectedAt: '2026-10-20T11:55:00Z',
  detectedSeconds: 2,
  recoveredSeconds: 14,
  revertSeconds: null,
  restoredSeconds: null,
  alertName: null,
  alertSeconds: null,
  recovered: true,
  failedRequests: 0,
  totalRequests: 30,
  mechanism: 'Deployment controller',
  definition: 'replicas ready',
  grafanaAnnotated: true,
  notes: '',
});

let server: http.Server;
let port = 0;

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-EaaS-Request': '1' }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { Host: `127.0.0.1:${port}`, ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  const app = createApp({
    jenkins: fakeJenkins,
    aws: fakeAws,
    injector: fakeInjector,
    config: {
      owner: 'kelvrix',
      maxEnvironments: 3,
      publicDir: fileURLToPath(new URL('../public', import.meta.url)),
      now: () => NOW,
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  awsEnvs = [];
  builds = [];
  injBuilds = [];
  recoveries = new Map();
  triggered = [];
  recoveryFetches = 0;
});

function readyMedium(): void {
  awsEnvs.push(awsEnv());
  builds.push(createBuild());
}

describe('POST /api/environments/:id/inject', () => {
  it('queues the injection for a ready medium environment', async () => {
    readyMedium();
    const res = await call('POST', '/api/environments/web1/inject', { failure: 'node-kill' });
    assert.equal(res.status, 202);
    assert.deepEqual(triggered, [{ envId: 'web1', failure: 'node-kill' }]);
  });

  it('rejects unknown failure types and invalid names without calling Jenkins', async () => {
    readyMedium();
    assert.equal((await call('POST', '/api/environments/web1/inject', { failure: 'rm -rf /' })).status, 400);
    assert.equal((await call('POST', '/api/environments/web1/inject', {})).status, 400);
    assert.equal((await call('POST', '/api/environments/Bad_Name/inject', { failure: 'pod-kill' })).status, 400);
    assert.deepEqual(triggered, []);
  });

  it('is protected by the CSRF header', async () => {
    readyMedium();
    const res = await call('POST', '/api/environments/web1/inject', { failure: 'pod-kill' }, {});
    assert.equal(res.status, 403);
    assert.deepEqual(triggered, []);
  });

  it('refuses small environments', async () => {
    awsEnvs.push(awsEnv({ size: 'small' }));
    builds.push(createBuild({ size: 'small' }));
    const res = await call('POST', '/api/environments/web1/inject', { failure: 'pod-kill' });
    assert.equal(res.status, 409);
    assert.match(res.body, /medium/);
    assert.deepEqual(triggered, []);
  });

  it('refuses environments that are not ready, and unknown ones', async () => {
    awsEnvs.push(awsEnv());
    builds.push(createBuild({ building: true, result: null }));
    assert.equal((await call('POST', '/api/environments/web1/inject', { failure: 'pod-kill' })).status, 409);
    assert.equal((await call('POST', '/api/environments/ghost1/inject', { failure: 'pod-kill' })).status, 404);
    assert.deepEqual(triggered, []);
  });

  it('allows only one injection at a time', async () => {
    readyMedium();
    injBuilds.push(injection({ building: true, result: null }));
    const res = await call('POST', '/api/environments/web1/inject', { failure: 'pod-kill' });
    assert.equal(res.status, 409);
    assert.match(res.body, /already running/);

    injBuilds = [injection({ number: null, queued: true, result: null })];
    assert.equal((await call('POST', '/api/environments/web1/inject', { failure: 'pod-kill' })).status, 409);
    assert.deepEqual(triggered, []);
  });

  it('allows a new injection once the previous one has finished', async () => {
    readyMedium();
    injBuilds.push(injection());
    assert.equal((await call('POST', '/api/environments/web1/inject', { failure: 'pod-kill' })).status, 202);
  });
});

describe('GET /api/injections and /api/failures', () => {
  it('attaches the recovery result to finished runs only, and caches it', async () => {
    injBuilds = [
      injection({ number: 6, building: true, result: null, timestamp: NOW - MIN }),
      injection({ number: 5 }),
    ];
    recoveries.set(5, recovery());

    const first = JSON.parse((await call('GET', '/api/injections')).body) as { injections: Array<{ number: number; recovery: unknown }> };
    assert.equal(first.injections[0]?.recovery, null);
    assert.notEqual(first.injections[1]?.recovery, null);

    await call('GET', '/api/injections');
    assert.equal(recoveryFetches, 1);
  });

  it('lists the five failure types', async () => {
    const res = JSON.parse((await call('GET', '/api/failures')).body) as { failures: Array<{ type: string }> };
    assert.equal(res.failures.length, 5);
  });
});
