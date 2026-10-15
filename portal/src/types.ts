export type Size = 'small' | 'medium';
export type Ttl = 1 | 2 | 4;
export type JobKind = 'create' | 'destroy';

/** What exists in AWS right now (read from VPC and instance tags). */
export interface AwsEnvironment {
  envId: string;
  owner: string | null;
  size: Size | null;
  ttlHours: number | null;
  expiresAt: string | null;
  serverPublicIp: string | null;
  instanceCount: number;
}

/** One Jenkins build (or a queued build that has not started yet). */
export interface BuildInfo {
  job: JobKind;
  number: number | null;
  envId: string;
  queued: boolean;
  building: boolean;
  result: string | null;
  timestamp: number;
  durationMs: number;
  size: Size | null;
  ttlHours: number | null;
  owner: string | null;
}

export type EnvState = 'creating' | 'ready' | 'destroying' | 'failed' | 'needs-cleanup' | 'external';

export interface EnvironmentView {
  envId: string;
  state: EnvState;
  note: string;
  owner: string | null;
  size: Size | null;
  ttlHours: number | null;
  expiresAt: string | null;
  minutesRemaining: number | null;
  appUrl: string | null;
  grafanaUrl: string | null;
  latestBuild: {
    job: JobKind;
    number: number | null;
    result: string | null;
    building: boolean;
    queued: boolean;
    durationMs: number;
  } | null;
}
