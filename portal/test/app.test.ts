import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import type { AwsReader } from '../src/aws.js';
import type { JenkinsApi } from '../src/jenkins.js';
import type { AwsEnvironment, BuildInfo } from '../src/types.js';

let awsEnvs: AwsEnvironment[] = [];
let builds: BuildInfo[] = [];
let created: Array<{ name: string; size: string; ttlHours: number; owner: string }> = [];
let destroyed: string[] = [];
let nextNumber = 1;

const fakeJenkins: JenkinsApi = {
  async triggerCreate(p) {
    created.push(p);
  },
  async triggerDestroy(id) {
    destroyed.push(id);
  },
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
  async extendExpiry() {
    /* not used in these tests */
  },
};

function readyEnv(id: string): void {
  awsEnvs.push({ envId: id, owner: 'kelvrix', size: 'small', ttlHours: 1, expiresAt: '2099-01-01T00:00:00Z', serverPublicIp: '13.201.10.20', instanceCount: 1, vpcId: 'vpc-0abc12345', instanceIds: ['i-0abc12345'], launchedAt: null });
  builds.push({ job: 'create', number: nextNumber++, envId: id, queued: false, building: false, result: 'SUCCESS', timestamp: Date.now() - 600_000, durationMs: 540_000, size: 'small', ttlHours: 1, owner: 'kelvrix' });
}

let server: http.Server;
let port = 0;

function raw(method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...opts.headers } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const GOOD = { 'Content-Type': 'application/json', 'X-EaaS-Request': '1' };
const post = (path: string, body: unknown, headers: Record<string, string> = GOOD) =>
  raw('POST', path, { headers, body: JSON.stringify(body) });
const del = (path: string) => raw('DELETE', path, { headers: { 'X-EaaS-Request': '1' } });

before(async () => {
  const app = createApp({
    jenkins: fakeJenkins,
    aws: fakeAws,
    config: { owner: 'kelvrix', maxEnvironments: 3, publicDir: fileURLToPath(new URL('../public', import.meta.url)) },
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
  created = [];
  destroyed = [];
  nextNumber = 1;
});

describe('browser-attack guards', () => {
  it('rejects a wrong Host header (DNS rebinding)', async () => {
    const res = await raw('GET', '/api/environments', { headers: { Host: 'evil.example' } });
    assert.equal(res.status, 403);
  });

  it('rejects a mutation without the custom header (CSRF)', async () => {
    const res = await post('/api/environments', { name: 'demo1', size: 'small', ttlHours: 1 }, { 'Content-Type': 'application/json' });
    assert.equal(res.status, 403);
    assert.equal(created.length, 0);
  });

  it('rejects a cross-site Origin', async () => {
    const res = await post('/api/environments', { name: 'demo1', size: 'small', ttlHours: 1 }, { ...GOOD, Origin: 'http://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(created.length, 0);
  });

  it('rejects a non-JSON POST', async () => {
    const res = await post('/api/environments', 'x', { 'Content-Type': 'text/plain', 'X-EaaS-Request': '1' });
    assert.equal(res.status, 415);
  });

  it('serves the page with a strict Content Security Policy', async () => {
    const res = await raw('GET', '/');
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-security-policy']), /default-src 'self'/);
  });
});

describe('create', () => {
  it('queues a build with exactly the four real parameters', async () => {
    const res = await post('/api/environments', { name: 'newenv', size: 'small', ttlHours: 1 });
    assert.equal(res.status, 202);
    assert.deepEqual(created, [{ name: 'newenv', size: 'small', ttlHours: 1, owner: 'kelvrix' }]);
  });

  it('rejects invalid input without calling Jenkins', async () => {
    const res = await post('/api/environments', { name: 'Bad_Name!', size: 'small', ttlHours: 1 });
    assert.equal(res.status, 400);
    assert.equal(created.length, 0);
  });

  it('rejects a duplicate name', async () => {
    readyEnv('demo1');
    const res = await post('/api/environments', { name: 'demo1', size: 'small', ttlHours: 1 });
    assert.equal(res.status, 409);
    assert.equal(created.length, 0);
  });

  it('enforces the 3-environment cap', async () => {
    readyEnv('env-a');
    readyEnv('env-b');
    readyEnv('env-c');
    const res = await post('/api/environments', { name: 'env-d', size: 'small', ttlHours: 1 });
    assert.equal(res.status, 409);
    assert.match(res.body, /Capacity reached/);
    assert.equal(created.length, 0);
  });

  it('lets a failed-and-cleaned name be reused', async () => {
    builds.push({ job: 'create', number: 1, envId: 'retry1', queued: false, building: false, result: 'FAILURE', timestamp: Date.now() - 600_000, durationMs: 1000, size: 'small', ttlHours: 1, owner: 'kelvrix' });
    const res = await post('/api/environments', { name: 'retry1', size: 'small', ttlHours: 1 });
    assert.equal(res.status, 202);
  });
});

describe('destroy', () => {
  it('queues a destroy for a ready environment', async () => {
    readyEnv('demo1');
    const res = await del('/api/environments/demo1');
    assert.equal(res.status, 202);
    assert.deepEqual(destroyed, ['demo1']);
  });

  it('returns 404 for an unknown environment', async () => {
    const res = await del('/api/environments/ghost1');
    assert.equal(res.status, 404);
    assert.deepEqual(destroyed, []);
  });

  it('refuses while the environment is still being created', async () => {
    awsEnvs.push({ envId: 'busy1', owner: 'kelvrix', size: 'small', ttlHours: 1, expiresAt: null, serverPublicIp: null, instanceCount: 0, vpcId: 'vpc-0abc12345', instanceIds: [], launchedAt: null });
    builds.push({ job: 'create', number: 1, envId: 'busy1', queued: false, building: true, result: null, timestamp: Date.now(), durationMs: 0, size: 'small', ttlHours: 1, owner: 'kelvrix' });
    const res = await del('/api/environments/busy1');
    assert.equal(res.status, 409);
    assert.deepEqual(destroyed, []);
  });

  it('rejects an invalid name', async () => {
    const res = await del('/api/environments/Bad_Name');
    assert.equal(res.status, 400);
  });
});

describe('build references', () => {
  it('rejects unknown jobs and non-numeric build numbers', async () => {
    assert.equal((await raw('GET', '/api/builds/evil/1/logs')).status, 400);
    assert.equal((await raw('GET', '/api/builds/create/abc/logs')).status, 400);
    assert.equal((await raw('GET', '/api/builds/create/abc/stages')).status, 400);
  });
});
