import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { AwsReader } from './aws.js';
import { buildEnvironmentList, occupiesCapacity } from './envs.js';
import { JenkinsError, UpstreamError } from './errors.js';
import type { JenkinsApi } from './jenkins.js';
import type { JobKind } from './types.js';
import { startReaperPoller } from './reaper.js';
import type { DestroyQueue } from './sqs.js';
import type { InjectApi } from './inject-client.js';
import { registerInjectRoutes } from './inject-routes.js';
import { registerTtlRoutes } from './ttl-routes.js';
import { isValidEnvId, parseCreateRequest } from './validation.js';

export interface AppConfig {
  owner: string;
  maxEnvironments: number;
  publicDir: string;
  now?: () => number;
}

export interface Deps {
  jenkins: JenkinsApi;
  aws: AwsReader;
  queue?: DestroyQueue;
  injector?: InjectApi;
  config: AppConfig;
}

function allowedHosts(req: Request): string[] {
  const port = req.socket.localPort;
  return [`localhost:${port}`, `127.0.0.1:${port}`];
}

// Defends against DNS rebinding: a hostile site that resolves to 127.0.0.1 still sends its own Host header
function hostGuard(req: Request, res: Response, next: NextFunction): void {
  if (!allowedHosts(req).includes(req.headers.host ?? '')) {
    res.status(403).json({ error: 'Forbidden host' });
    return;
  }
  next();
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

// Defends against CSRF: a page on another site cannot set this header without a CORS preflight (which we never allow)
function mutationGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedHosts(req).some((host) => origin === `http://${host}`)) {
    res.status(403).json({ error: 'Forbidden origin' });
    return;
  }
  if (req.headers['x-eaas-request'] !== '1') {
    res.status(403).json({ error: 'Missing request header' });
    return;
  }
  if (req.method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json' });
    return;
  }
  next();
}

function parseJob(value: string): JobKind | null {
  return value === 'create' || value === 'destroy' || value === 'inject' ? value : null;
}

function parseBuildNumber(value: string): number | null {
  return /^\d{1,7}$/.test(value) ? Number(value) : null;
}

export function createApp(deps: Deps): Express {
  const { jenkins, aws, config } = deps;
  const now = config.now ?? Date.now;
  const app = express();

  app.disable('x-powered-by');
  app.use(hostGuard);
  app.use(securityHeaders);
  app.use(mutationGuard);
  app.use(express.json({ limit: '2kb' }));

  // Check-then-trigger must not interleave, or a double click could slip past the cap
  let chain: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(() => fn());
    chain = run.catch(() => undefined);
    return run;
  }

  async function loadEnvironments() {
    const [awsEnvs, builds] = await Promise.all([aws.listEnvironments(), jenkins.listBuilds()]);
    return buildEnvironmentList({ aws: awsEnvs, builds, now: now() });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/environments', async (_req, res) => {
    const environments = await loadEnvironments();
    res.json({ environments, maxEnvironments: config.maxEnvironments });
  });

  app.post('/api/environments', async (req, res) => {
    const parsed = parseCreateRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { name, size, ttlHours } = parsed.value;

    const outcome = await serialize(async () => {
      const active = (await loadEnvironments()).filter((e) => occupiesCapacity(e.state));
      if (active.some((e) => e.envId === name)) {
        return { status: 409, error: `Environment "${name}" already exists` } as const;
      }
      if (active.length >= config.maxEnvironments) {
        return {
          status: 409,
          error: `Capacity reached (${active.length}/${config.maxEnvironments}). Destroy an environment first.`,
        } as const;
      }
      await jenkins.triggerCreate({ name, size, ttlHours, owner: config.owner });
      return { status: 202 } as const;
    });

    if (outcome.status !== 202) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.status(202).json({ accepted: true, name });
  });

  app.delete('/api/environments/:id', async (req, res) => {
    const id = req.params.id;
    if (!isValidEnvId(id)) {
      res.status(400).json({ error: 'Invalid environment name' });
      return;
    }

    const outcome = await serialize(async () => {
      const env = (await loadEnvironments()).find((e) => e.envId === id);
      if (!env || env.state === 'failed') return { status: 404, error: 'No such environment' } as const;
      if (env.state === 'destroying') return { status: 409, error: 'A destroy is already in progress' } as const;
      if (env.state === 'creating') {
        return { status: 409, error: 'The environment is still being created. Wait for the build to finish.' } as const;
      }
      await jenkins.triggerDestroy(id);
      return { status: 202 } as const;
    });

    if (outcome.status !== 202) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.status(202).json({ accepted: true, name: id });
  });

  registerTtlRoutes(app, { aws, loadEnvironments, serialize, now });
  if (deps.injector) {
    registerInjectRoutes(app, { injector: deps.injector, loadEnvironments, serialize });
  }

  app.get('/api/builds/:job/:number/stages', async (req, res) => {
    const job = parseJob(req.params.job);
    const number = parseBuildNumber(req.params.number);
    if (job === null || number === null) {
      res.status(400).json({ error: 'Invalid build reference' });
      return;
    }
    res.json(await jenkins.getStages(job, number));
  });

  // Server-Sent Events: one connection per open log panel
  app.get('/api/builds/:job/:number/logs', async (req, res) => {
    const job = parseJob(req.params.job);
    const number = parseBuildNumber(req.params.number);
    if (job === null || number === null) {
      res.status(400).json({ error: 'Invalid build reference' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { result } = await jenkins.streamLog(job, number, controller.signal, (text) => send('log', text));
      send('done', { result });
    } catch (err) {
      if (!controller.signal.aborted) {
        send('failure', { message: err instanceof JenkinsError ? err.message : 'Log stream failed' });
      }
    } finally {
      res.end();
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(express.static(config.publicDir));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof UpstreamError) {
      console.error('upstream error:', err.message);
      res.status(502).json({ error: err.message });
      return;
    }
    const status =
      typeof err === 'object' && err !== null && typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: 'Bad request' });
      return;
    }
    console.error('unexpected error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({ error: 'Internal error' });
  });

  if (deps.queue) {
    startReaperPoller({
      queue: deps.queue,
      loadEnvironments,
      triggerDestroy: (envId) => jenkins.triggerDestroy(envId),
      serialize,
      now,
    });
    console.log('TTL poller started: expired environments are destroyed automatically');
  }

  return app;
}
