import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import type { AwsReader } from '../src/aws.js';
import { buildEnvironmentList } from '../src/envs.js';
import type { JenkinsApi } from '../src/jenkins.js';
import { computeExtension } from '../src/ttl-routes.js';
import type { AwsEnvironment, BuildInfo } from '../src/types.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const MIN = 60_000;

let awsEnvs: AwsEnvironment[] = [];
let builds: BuildInfo[] = [];
let extended: Array<{ envId: string; expiresAt: string }> = [];

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
  async extendExpiry(envId, expiresAt) {
    extended.push({ envId, expiresAt });
  },
};

const awsEnv = (o: Partial<AwsEnvironment> = {}): AwsEnvironment => ({
  envId: 'web1',
  owner: 'kelvrix',
  size: 'small',
  ttlHours: 1,
  expiresAt: '2026-10-20T13:00:00Z',
  serverPublicIp: '13.201.10.20',
  instanceCount: 1,
  vpcId: 'vpc-0abc12345',
  instanceIds: ['i-0abc12345'],
  launchedAt: '2026-10-20T11:30:00Z',
  ...o,
});

const build = (o: Partial<BuildInfo> = {}): BuildInfo => ({
  job: 'create',
  number: 1,
  envId: 'web1',
  queued: false,
  building: false,
  result: 'SUCCESS',
  timestamp: NOW - 10 * MIN,
  durationMs: 9 * MIN,
  size: 'small',
  ttlHours: 1,
  owner: 'kelvrix',
  ...o,
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
  extended = [];
});

describe('computeExtension', () => {
  it('adds the hours to the current expiry', () => {
    const result = computeExtension({ currentExpiresAt: '2026-10-20T13:00:00Z', hours: 1, now: NOW });
    assert.deepEqual(result, { ok: true, newExpiresAt: '2026-10-20T14:00:00Z' });
  });

  it('extends an already expired environment from now, not from the past', () => {
    const result = computeExtension({ currentExpiresAt: '2026-10-20T11:00:00Z', hours: 1, now: NOW });
    assert.deepEqual(result, { ok: true, newExpiresAt: '2026-10-20T13:00:00Z' });
  });

  it('refuses when the remaining time would exceed four hours', () => {
    const result = computeExtension({ currentExpiresAt: '2026-10-20T15:30:00Z', hours: 1, now: NOW });
    assert.equal(result.ok, false);
  });

  it('refuses a missing expiry and invalid hours', () => {
    assert.equal(computeExtension({ currentExpiresAt: null, hours: 1, now: NOW }).ok, false);
    assert.equal(computeExtension({ currentExpiresAt: '2026-10-20T13:00:00Z', hours: 3, now: NOW }).ok, false);
  });
});

describe('POST /api/environments/:id/extend', () => {
  it('extends a ready environment and writes the new expiry', async () => {
    awsEnvs.push(awsEnv());
    builds.push(build());
    const res = await call('POST', '/api/environments/web1/extend', { hours: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(extended, [{ envId: 'web1', expiresAt: '2026-10-20T14:00:00Z' }]);
  });

  it('allows +2 hours when the cap is respected', async () => {
    awsEnvs.push(awsEnv());
    builds.push(build());
    const res = await call('POST', '/api/environments/web1/extend', { hours: 2 });
    assert.equal(res.status, 200);
    assert.equal(extended[0]?.expiresAt, '2026-10-20T15:00:00Z');
  });

  it('refuses past the four-hour cap and does not touch AWS', async () => {
    awsEnvs.push(awsEnv({ expiresAt: '2026-10-20T15:30:00Z' }));
    builds.push(build());
    const res = await call('POST', '/api/environments/web1/extend', { hours: 1 });
    assert.equal(res.status, 409);
    assert.deepEqual(extended, []);
  });

  it('rejects invalid hours and invalid names', async () => {
    assert.equal((await call('POST', '/api/environments/web1/extend', { hours: 3 })).status, 400);
    assert.equal((await call('POST', '/api/environments/Bad_Name/extend', { hours: 1 })).status, 400);
  });

  it('refuses environments that are not ready, and unknown ones', async () => {
    awsEnvs.push(awsEnv());
    builds.push(build({ building: true, result: null }));
    assert.equal((await call('POST', '/api/environments/web1/extend', { hours: 1 })).status, 409);
    assert.equal((await call('POST', '/api/environments/ghost1/extend', { hours: 1 })).status, 404);
    assert.deepEqual(extended, []);
  });

  it('is protected by the CSRF header', async () => {
    awsEnvs.push(awsEnv());
    builds.push(build());
    const res = await call('POST', '/api/environments/web1/extend', { hours: 1 }, {});
    assert.equal(res.status, 403);
    assert.deepEqual(extended, []);
  });
});

describe('GET /api/estimate', () => {
  it('returns an hourly rate and a total', async () => {
    const res = await call('GET', '/api/estimate?size=small&ttlHours=2');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body) as { hourly: number; total: number };
    assert.ok(Math.abs(data.hourly - 0.0299) < 0.0005);
    assert.ok(Math.abs(data.total - data.hourly * 2) < 0.001);
  });

  it('rejects invalid input', async () => {
    assert.equal((await call('GET', '/api/estimate?size=huge&ttlHours=2')).status, 400);
    assert.equal((await call('GET', '/api/estimate?size=small&ttlHours=3')).status, 400);
  });
});

describe('state after the TTL reaper terminated the instances', () => {
  it('shows needs-cleanup, with no links and no cost', () => {
    const [env] = buildEnvironmentList({
      aws: [awsEnv({ instanceCount: 0, instanceIds: [], serverPublicIp: null, launchedAt: null })],
      builds: [build()],
      now: NOW,
    });
    assert.equal(env?.state, 'needs-cleanup');
    assert.equal(env?.appUrl, null);
    assert.equal(env?.cost, null);
  });

  it('a ready environment gets a cost estimate', () => {
    const [env] = buildEnvironmentList({ aws: [awsEnv()], builds: [build()], now: NOW });
    assert.equal(env?.state, 'ready');
    assert.ok((env?.cost?.soFar ?? 0) > 0);
  });
});
