import { JenkinsError } from './errors.js';
import {
  isFailureType,
  parseRecovery,
  type FailureType,
  type InjectionBuild,
  type RecoveryResult,
} from './failures.js';
import { isValidEnvId } from './validation.js';

export interface InjectConfig {
  baseUrl: string;
  user: string;
  token: string;
  job: string;
}

export interface InjectApi {
  trigger(envId: string, failure: FailureType): Promise<void>;
  list(): Promise<InjectionBuild[]>;
  getRecovery(number: number): Promise<RecoveryResult | null>;
}

interface RawParam {
  name?: string;
  value?: unknown;
}
interface RawAction {
  parameters?: RawParam[];
}
export interface RawInjectBuild {
  number: number;
  building: boolean;
  result: string | null;
  timestamp: number;
  duration: number;
  actions?: RawAction[];
}
export interface RawInjectQueueItem {
  inQueueSince: number;
  task?: { name?: string };
  actions?: RawAction[];
}

const MAX_RUNS = 30;
const BUILD_TREE = `builds[number,building,result,timestamp,duration,actions[parameters[name,value]]]{0,${MAX_RUNS}}`;
const QUEUE_TREE = 'items[inQueueSince,task[name],actions[parameters[name,value]]]';

function readParams(actions: RawAction[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const action of actions ?? []) {
    for (const param of action.parameters ?? []) {
      if (typeof param.name === 'string' && typeof param.value === 'string') out[param.name] = param.value;
    }
  }
  return out;
}

/** Pure: turns Jenkins' raw build and queue data into injection runs, newest first. */
export function parseInjectionBuilds(
  builds: RawInjectBuild[],
  queue: RawInjectQueueItem[],
  jobName: string,
): InjectionBuild[] {
  const out: InjectionBuild[] = [];

  for (const b of builds) {
    const params = readParams(b.actions);
    const envId = params['ENV_NAME'];
    const failure = params['FAILURE'];
    if (!isValidEnvId(envId) || !isFailureType(failure)) continue; // e.g. the first "setup" build
    out.push({
      number: b.number,
      envId,
      failure,
      queued: false,
      building: b.building,
      result: b.result,
      timestamp: b.timestamp,
      durationMs: b.duration,
    });
  }

  for (const item of queue) {
    if (item.task?.name !== jobName) continue;
    const params = readParams(item.actions);
    const envId = params['ENV_NAME'];
    const failure = params['FAILURE'];
    if (!isValidEnvId(envId) || !isFailureType(failure)) continue;
    out.push({
      number: null,
      envId,
      failure,
      queued: true,
      building: false,
      result: null,
      timestamp: item.inQueueSince,
      durationMs: 0,
    });
  }

  return out.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_RUNS);
}

export function createInjectClient(cfg: InjectConfig): InjectApi {
  const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.token}`).toString('base64')}`;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', auth);
    try {
      return await fetch(`${cfg.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new JenkinsError('Jenkins is not reachable');
    }
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await request(path);
    if (res.status === 401 || res.status === 403) throw new JenkinsError('Jenkins rejected the portal credentials');
    if (!res.ok) throw new JenkinsError(`Jenkins returned HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async trigger(envId, failure) {
      // Defence in depth: the API already validated these
      if (!isValidEnvId(envId) || !isFailureType(failure)) throw new JenkinsError('Invalid injection parameters', 400);
      const res = await request(`/job/${cfg.job}/buildWithParameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ENV_NAME: envId, FAILURE: failure }).toString(),
      });
      if (res.status === 401 || res.status === 403) throw new JenkinsError('Jenkins rejected the portal credentials');
      if (res.status === 404) throw new JenkinsError('The eaas-inject Jenkins job does not exist yet', 404);
      if (res.status !== 201) throw new JenkinsError(`Jenkins did not queue the build (HTTP ${res.status})`);
    },

    async list() {
      const enc = encodeURIComponent;
      const [job, queue] = await Promise.all([
        getJson<{ builds?: RawInjectBuild[] }>(`/job/${cfg.job}/api/json?tree=${enc(BUILD_TREE)}`),
        getJson<{ items?: RawInjectQueueItem[] }>(`/queue/api/json?tree=${enc(QUEUE_TREE)}`),
      ]);
      return parseInjectionBuilds(job.builds ?? [], queue.items ?? [], cfg.job);
    },

    async getRecovery(number) {
      if (!Number.isInteger(number) || number < 1) return null;
      const res = await request(`/job/${cfg.job}/${number}/artifact/recovery.json`);
      if (!res.ok) return null;
      try {
        return parseRecovery(await res.json());
      } catch {
        return null;
      }
    },
  };
}
