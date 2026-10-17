import type { DestroyQueue, QueueMessage } from './sqs.js';
import type { EnvironmentView } from './types.js';
import { isValidEnvId } from './validation.js';

// A destroy request is only acted on for environments in one of these states
const DESTROYABLE: ReadonlySet<string> = new Set(['ready', 'needs-cleanup', 'external']);

export interface Decision {
  envId: string;
  action: 'destroy' | 'skip';
  reason: string;
}

export function parseRequests(messages: QueueMessage[]): { envIds: string[]; invalid: number } {
  const ids = new Set<string>();
  let invalid = 0;
  for (const message of messages) {
    try {
      const data: unknown = JSON.parse(message.body);
      const envId = typeof data === 'object' && data !== null ? (data as { envId?: unknown }).envId : undefined;
      if (isValidEnvId(envId)) ids.add(envId);
      else invalid += 1;
    } catch {
      invalid += 1;
    }
  }
  return { envIds: [...ids].sort(), invalid };
}

/**
 * Messages are hints, never commands. The decision is made from the live state in AWS, so a stale
 * message, a duplicate, or a race with "Extend TTL" can never destroy an environment that is not expired.
 */
export function decide(envIds: string[], environments: EnvironmentView[], now: number): Decision[] {
  return envIds.map((envId): Decision => {
    const env = environments.find((e) => e.envId === envId);
    if (env === undefined) return { envId, action: 'skip', reason: 'no longer exists' };
    if (!DESTROYABLE.has(env.state)) return { envId, action: 'skip', reason: `state is ${env.state}` };
    const expires = env.expiresAt !== null ? Date.parse(env.expiresAt) : Number.NaN;
    if (Number.isNaN(expires)) return { envId, action: 'skip', reason: 'no valid expiry' };
    if (expires > now) return { envId, action: 'skip', reason: 'not expired (extended?)' };
    return { envId, action: 'destroy', reason: 'expired' };
  });
}

export interface PollerDeps {
  queue: DestroyQueue;
  loadEnvironments: () => Promise<EnvironmentView[]>;
  triggerDestroy: (envId: string) => Promise<void>;
  serialize: <T>(fn: () => Promise<T>) => Promise<T>;
  now: () => number;
  log?: (message: string) => void;
}

export async function pollOnce(deps: PollerDeps): Promise<void> {
  const log = deps.log ?? console.log;
  const messages = await deps.queue.receive();
  if (messages.length === 0) return;

  const { envIds, invalid } = parseRequests(messages);
  if (invalid > 0) log(`reaper: ignoring ${invalid} malformed message(s)`);

  const decisions = await deps.serialize(async () => {
    const environments = await deps.loadEnvironments();
    const out = decide(envIds, environments, deps.now());
    for (const decision of out) {
      if (decision.action === 'destroy') await deps.triggerDestroy(decision.envId);
    }
    return out;
  });

  // Only reached if every trigger succeeded; otherwise the messages reappear and we retry.
  // The reaper re-sends on every run until the environment is gone, so nothing is lost either way.
  await deps.queue.remove(messages);
  for (const decision of decisions) log(`reaper: ${decision.envId}: ${decision.action} (${decision.reason})`);
}

export function startReaperPoller(deps: PollerDeps, intervalMs = 20_000): () => void {
  const log = deps.log ?? console.log;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    try {
      await pollOnce(deps);
    } catch (err) {
      log(`reaper poller error: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
