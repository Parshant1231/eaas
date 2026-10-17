import { isValidEnvId } from './validation.js';

export const FAILURE_TYPES = ['pod-kill', 'service-crash', 'node-kill', 'cpu-spike', 'disk-fill'] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

export function isFailureType(value: unknown): value is FailureType {
  return typeof value === 'string' && (FAILURE_TYPES as readonly string[]).includes(value);
}

export interface FailureInfo {
  type: FailureType;
  label: string;
  description: string;
  recovery: string;
  expectedRun: string;
}

export const FAILURE_INFO: FailureInfo[] = [
  {
    type: 'pod-kill',
    label: 'Kill an API pod',
    description: 'Deletes one API pod.',
    recovery: 'The Deployment controller creates a replacement.',
    expectedRun: 'about a minute',
  },
  {
    type: 'service-crash',
    label: 'Crash the node agent service',
    description: 'Sends SIGKILL to the k3s agent process on the worker node.',
    recovery: 'systemd restarts the service.',
    expectedRun: 'about a minute',
  },
  {
    type: 'node-kill',
    label: 'Power off the worker node',
    description: 'Shuts the worker node down. The test starts it again afterwards.',
    recovery: 'Kubernetes marks the node NotReady and reschedules its pods on the other node; the NodeDown alert fires.',
    expectedRun: 'about 6 to 8 minutes including the node restart',
  },
  {
    type: 'cpu-spike',
    label: 'Spike CPU on the worker node',
    description: 'Runs a CPU stress for 5 minutes.',
    recovery: 'Detected by the HighCpu alert; clears after the stress ends.',
    expectedRun: 'about 6 minutes',
  },
  {
    type: 'disk-fill',
    label: 'Fill the worker node disk',
    description: 'Fills the disk until about 5% is free, then removes the file again.',
    recovery: 'Detected as a DiskPressure node condition; the condition clears several minutes after the file is removed.',
    expectedRun: 'about 8 to 10 minutes',
  },
];

export interface RecoveryResult {
  envId: string;
  failure: FailureType;
  target: string;
  injectedAt: string;
  detectedSeconds: number | null;
  recoveredSeconds: number | null;
  revertSeconds: number | null;
  restoredSeconds: number | null;
  alertName: string | null;
  alertSeconds: number | null;
  recovered: boolean;
  failedRequests: number;
  totalRequests: number;
  mechanism: string;
  definition: string;
  grafanaAnnotated: boolean;
  notes: string;
}

/** One Jenkins build of the injection job (or a queued one). */
export interface InjectionBuild {
  number: number | null;
  envId: string;
  failure: FailureType;
  queued: boolean;
  building: boolean;
  result: string | null;
  timestamp: number;
  durationMs: number;
}

export type InjectionRun = InjectionBuild & { recovery: RecoveryResult | null };

const MAX_TEXT = 400;
const clip = (value: unknown): string => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : '');

type OptionalSeconds = { ok: true; value: number | null } | { ok: false };

function optionalSeconds(value: unknown): OptionalSeconds {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 86_400) {
    return { ok: true, value };
  }
  return { ok: false };
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000 ? value : null;
}

/** The artifact is written by our own script, but it is still treated as untrusted data. */
export function parseRecovery(raw: unknown): RecoveryResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const envId = r['env_id'];
  const failure = r['failure'];
  const recovered = r['recovered'];
  if (!isValidEnvId(envId) || !isFailureType(failure) || typeof recovered !== 'boolean') return null;

  const detected = optionalSeconds(r['detected_seconds']);
  const recoveredSeconds = optionalSeconds(r['recovered_seconds']);
  const revert = optionalSeconds(r['revert_seconds']);
  const restored = optionalSeconds(r['restored_seconds']);
  const alert = optionalSeconds(r['alert_seconds']);
  const failed = count(r['failed_requests']);
  const total = count(r['total_requests']);
  if (!detected.ok || !recoveredSeconds.ok || !revert.ok || !restored.ok || !alert.ok) return null;
  if (failed === null || total === null) return null;

  const alertName = clip(r['alert_name']);
  return {
    envId,
    failure,
    target: clip(r['target']),
    injectedAt: clip(r['injected_at']),
    detectedSeconds: detected.value,
    recoveredSeconds: recoveredSeconds.value,
    revertSeconds: revert.value,
    restoredSeconds: restored.value,
    alertName: alertName === '' ? null : alertName,
    alertSeconds: alert.value,
    recovered,
    failedRequests: failed,
    totalRequests: total,
    mechanism: clip(r['mechanism']),
    definition: clip(r['definition']),
    grafanaAnnotated: r['grafana_annotated'] === true,
    notes: clip(r['notes']),
  };
}
