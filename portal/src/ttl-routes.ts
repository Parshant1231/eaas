import type { Express } from 'express';
import type { AwsReader } from './aws.js';
import { estimateForRequest } from './cost.js';
import type { EnvironmentView } from './types.js';
import { isValidEnvId } from './validation.js';

export const MAX_REMAINING_HOURS = 4;
const HOUR_MS = 3_600_000;

export type Extension = { ok: true; newExpiresAt: string } | { ok: false; error: string };

export function computeExtension(input: { currentExpiresAt: string | null; hours: number; now: number }): Extension {
  if (input.hours !== 1 && input.hours !== 2) return { ok: false, error: 'hours must be 1 or 2' };
  const current = input.currentExpiresAt !== null ? Date.parse(input.currentExpiresAt) : Number.NaN;
  if (Number.isNaN(current)) return { ok: false, error: 'This environment has no valid expiry to extend' };

  // An already-expired (but not yet reaped) environment is extended from now, not from the past
  const next = Math.max(current, input.now) + input.hours * HOUR_MS;
  if (next - input.now > MAX_REMAINING_HOURS * HOUR_MS) {
    return { ok: false, error: `The remaining time cannot exceed ${MAX_REMAINING_HOURS} hours. Extend again later.` };
  }
  // Same format Terraform writes: 2026-10-20T13:00:00Z
  return { ok: true, newExpiresAt: new Date(next).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

export interface TtlRouteDeps {
  aws: AwsReader;
  loadEnvironments: () => Promise<EnvironmentView[]>;
  serialize: <T>(fn: () => Promise<T>) => Promise<T>;
  now: () => number;
}

export function registerTtlRoutes(app: Express, deps: TtlRouteDeps): void {
  app.get('/api/estimate', (req, res) => {
    const size = req.query.size;
    const ttlHours = Number(req.query.ttlHours);
    if (size !== 'small' && size !== 'medium') {
      res.status(400).json({ error: 'size must be "small" or "medium"' });
      return;
    }
    if (![1, 2, 4].includes(ttlHours)) {
      res.status(400).json({ error: 'ttlHours must be 1, 2 or 4' });
      return;
    }
    res.json(estimateForRequest(size, ttlHours));
  });

  app.post('/api/environments/:id/extend', async (req, res) => {
    const id = req.params.id;
    if (!isValidEnvId(id)) {
      res.status(400).json({ error: 'Invalid environment name' });
      return;
    }
    const hours = typeof req.body === 'object' && req.body !== null ? (req.body as { hours?: unknown }).hours : undefined;
    if (hours !== 1 && hours !== 2) {
      res.status(400).json({ error: 'hours must be 1 or 2' });
      return;
    }

    const outcome = await deps.serialize(async () => {
      const env = (await deps.loadEnvironments()).find((e) => e.envId === id);
      if (env === undefined) return { status: 404, error: 'No such environment' } as const;
      if (env.state !== 'ready') {
        return { status: 409, error: `Only ready environments can be extended (this one is ${env.state})` } as const;
      }
      const extension = computeExtension({ currentExpiresAt: env.expiresAt, hours, now: deps.now() });
      if (!extension.ok) return { status: 409, error: extension.error } as const;
      await deps.aws.extendExpiry(id, extension.newExpiresAt);
      return { status: 200, expiresAt: extension.newExpiresAt } as const;
    });

    if (outcome.status !== 200) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.json({ expiresAt: outcome.expiresAt });
  });
}
