import { JenkinsError } from './errors.js';
import type { BuildInfo, JobKind, Size } from './types.js';
import { isValidEnvId, isValidOwner } from './validation.js';

export interface JenkinsConfig {
  baseUrl: string;
  user: string;
  token: string;
  createJob: string;
  destroyJob: string;
}

export interface StageInfo {
  name: string;
  status: string;
  durationMs: number;
}

export interface BuildStages {
  status: string;
  stages: StageInfo[];
}

export interface JenkinsApi {
  triggerCreate(p: { name: string; size: Size; ttlHours: number; owner: string }): Promise<void>;
  triggerDestroy(envId: string): Promise<void>;
  listBuilds(): Promise<BuildInfo[]>;
  getStages(job: JobKind, number: number): Promise<BuildStages>;
  streamLog(
    job: JobKind,
    number: number,
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<{ result: string | null }>;
}

interface RawParam {
  name?: string;
  value?: unknown;
}
interface RawAction {
  parameters?: RawParam[];
}
interface RawBuild {
  number: number;
  building: boolean;
  result: string | null;
  timestamp: number;
  duration: number;
  actions?: RawAction[];
}
interface RawQueueItem {
  id: number;
  inQueueSince: number;
  task?: { name?: string };
  actions?: RawAction[];
}

const BUILD_TREE = 'builds[number,building,result,timestamp,duration,actions[parameters[name,value]]]{0,30}';
const QUEUE_TREE = 'items[id,inQueueSince,task[name],actions[parameters[name,value]]]';

function readParams(actions: RawAction[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const action of actions ?? []) {
    for (const param of action.parameters ?? []) {
      if (typeof param.name === 'string' && typeof param.value === 'string') out[param.name] = param.value;
    }
  }
  return out;
}

function asSize(value: string | undefined): Size | null {
  return value === 'small' || value === 'medium' ? value : null;
}

function asNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createJenkinsClient(cfg: JenkinsConfig): JenkinsApi {
  const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.token}`).toString('base64')}`;
  const jobName = (kind: JobKind): string => (kind === 'create' ? cfg.createJob : cfg.destroyJob);

  async function request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', auth);
    const timeout = AbortSignal.timeout(15_000);
    try {
      return await fetch(`${cfg.baseUrl}${path}`, {
        ...init,
        headers,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new JenkinsError('Jenkins is not reachable');
    }
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await request(path);
    if (res.status === 401 || res.status === 403) throw new JenkinsError('Jenkins rejected the portal credentials');
    if (!res.ok) throw new JenkinsError(`Jenkins returned HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async function trigger(job: string, params: Record<string, string>): Promise<void> {
    const res = await request(`/job/${job}/buildWithParameters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    if (res.status === 401 || res.status === 403) throw new JenkinsError('Jenkins rejected the portal credentials');
    if (res.status !== 201) throw new JenkinsError(`Jenkins did not queue the build (HTTP ${res.status})`);
  }

  return {
    async triggerCreate(p) {
      // Defence in depth: the API already validated these
      if (!isValidEnvId(p.name) || !isValidOwner(p.owner)) throw new JenkinsError('Invalid build parameters', 400);
      // FAIL_AT is deliberately never sent: the portal cannot trigger the test hook
      await trigger(cfg.createJob, {
        ENV_NAME: p.name,
        SIZE: p.size,
        TTL_HOURS: String(p.ttlHours),
        OWNER: p.owner,
      });
    },

    async triggerDestroy(envId) {
      if (!isValidEnvId(envId)) throw new JenkinsError('Invalid environment id', 400);
      await trigger(cfg.destroyJob, { ENV_NAME: envId });
    },

    async listBuilds() {
      const enc = encodeURIComponent;
      const [creates, destroys, queue] = await Promise.all([
        getJson<{ builds?: RawBuild[] }>(`/job/${cfg.createJob}/api/json?tree=${enc(BUILD_TREE)}`),
        getJson<{ builds?: RawBuild[] }>(`/job/${cfg.destroyJob}/api/json?tree=${enc(BUILD_TREE)}`),
        getJson<{ items?: RawQueueItem[] }>(`/queue/api/json?tree=${enc(QUEUE_TREE)}`),
      ]);

      const out: BuildInfo[] = [];

      const fromBuilds = (job: JobKind, builds: RawBuild[] | undefined): void => {
        for (const b of builds ?? []) {
          const params = readParams(b.actions);
          const envId = params['ENV_NAME'];
          if (!isValidEnvId(envId)) continue; // e.g. the first "setup" build with no parameters
          out.push({
            job,
            number: b.number,
            envId,
            queued: false,
            building: b.building,
            result: b.result,
            timestamp: b.timestamp,
            durationMs: b.duration,
            size: asSize(params['SIZE']),
            ttlHours: asNumber(params['TTL_HOURS']),
            owner: params['OWNER'] ?? null,
          });
        }
      };
      fromBuilds('create', creates.builds);
      fromBuilds('destroy', destroys.builds);

      for (const item of queue.items ?? []) {
        const name = item.task?.name;
        const job: JobKind | null = name === cfg.createJob ? 'create' : name === cfg.destroyJob ? 'destroy' : null;
        if (job === null) continue;
        const params = readParams(item.actions);
        const envId = params['ENV_NAME'];
        if (!isValidEnvId(envId)) continue;
        out.push({
          job,
          number: null,
          envId,
          queued: true,
          building: false,
          result: null,
          timestamp: item.inQueueSince,
          durationMs: 0,
          size: asSize(params['SIZE']),
          ttlHours: asNumber(params['TTL_HOURS']),
          owner: params['OWNER'] ?? null,
        });
      }
      return out;
    },

    async getStages(job, number) {
      const raw = await getJson<{
        status?: string;
        stages?: Array<{ name?: string; status?: string; durationMillis?: number }>;
      }>(`/job/${jobName(job)}/${number}/wfapi/describe`);
      return {
        status: raw.status ?? 'UNKNOWN',
        stages: (raw.stages ?? []).map((s) => ({
          name: s.name ?? '?',
          status: s.status ?? 'UNKNOWN',
          durationMs: s.durationMillis ?? 0,
        })),
      };
    },

    async streamLog(job, number, signal, onText) {
      const base = `/job/${jobName(job)}/${number}`;
      let offset = 0;
      for (;;) {
        const res = await request(`${base}/logText/progressiveText?start=${offset}`, {}, signal);
        if (res.status === 404) throw new JenkinsError('Build not found (it may still be waiting in the queue)', 404);
        if (!res.ok) throw new JenkinsError(`Jenkins returned HTTP ${res.status}`);
        const text = await res.text();
        if (text.length > 0) onText(text);

        const header = res.headers.get('X-Text-Size');
        if (header !== null && Number.isFinite(Number(header))) offset = Number(header);
        else offset += Buffer.byteLength(text);

        if (res.headers.get('X-More-Data') !== 'true') break;
        await sleep(1500, signal);
      }
      const info = await getJson<{ result?: string | null }>(`${base}/api/json?tree=result`);
      return { result: info.result ?? null };
    },
  };
}
