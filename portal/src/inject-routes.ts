import type { Express } from 'express';
import { FAILURE_INFO, isFailureType, type InjectionRun, type RecoveryResult } from './failures.js';
import type { InjectApi } from './inject-client.js';
import type { EnvironmentView } from './types.js';
import { isValidEnvId } from './validation.js';

export interface InjectRouteDeps {
  injector: InjectApi;
  loadEnvironments: () => Promise<EnvironmentView[]>;
  serialize: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function registerInjectRoutes(app: Express, deps: InjectRouteDeps): void {
  // Finished builds never change, so each artifact is fetched once
  const cache = new Map<number, RecoveryResult | null>();

  app.get('/api/failures', (_req, res) => {
    res.json({ failures: FAILURE_INFO });
  });

  app.get('/api/injections', async (_req, res) => {
    const builds = await deps.injector.list();
    const injections = await Promise.all(
      builds.map(async (b): Promise<InjectionRun> => {
        if (b.number === null || b.queued || b.building || b.result === null) return { ...b, recovery: null };
        if (!cache.has(b.number)) cache.set(b.number, await deps.injector.getRecovery(b.number));
        return { ...b, recovery: cache.get(b.number) ?? null };
      }),
    );
    res.json({ injections });
  });

  app.post('/api/environments/:id/inject', async (req, res) => {
    const id = req.params.id;
    if (!isValidEnvId(id)) {
      res.status(400).json({ error: 'Invalid environment name' });
      return;
    }
    const failure = typeof req.body === 'object' && req.body !== null ? (req.body as { failure?: unknown }).failure : undefined;
    if (!isFailureType(failure)) {
      res.status(400).json({ error: 'Unknown failure type' });
      return;
    }

    const outcome = await deps.serialize(async () => {
      const env = (await deps.loadEnvironments()).find((e) => e.envId === id);
      if (env === undefined) return { status: 404, error: 'No such environment' } as const;
      if (env.state !== 'ready') {
        return { status: 409, error: `Only ready environments can be tested (this one is ${env.state})` } as const;
      }
      if (env.size !== 'medium') {
        return { status: 409, error: 'Failure injection needs a medium environment (two nodes and monitoring)' } as const;
      }
      const active = (await deps.injector.list()).find((b) => b.queued || b.building);
      if (active !== undefined) {
        return {
          status: 409,
          error: `An injection is already running (${active.failure} on ${active.envId}). Wait for it to finish.`,
        } as const;
      }
      await deps.injector.trigger(id, failure);
      return { status: 202 } as const;
    });

    if (outcome.status !== 202) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.status(202).json({ accepted: true, name: id, failure });
  });
}
