import type { AwsEnvironment, BuildInfo, EnvState, EnvironmentView } from './types.js';
import { isIpv4 } from './validation.js';

// A failed, fully cleaned-up build stays visible for a while so you can read its log
const FAILED_VISIBLE_MS = 6 * 60 * 60 * 1000;

const isActive = (b: BuildInfo): boolean => b.queued || b.building;
const isFailed = (b: BuildInfo): boolean => !b.queued && !b.building && b.result !== null && b.result !== 'SUCCESS';

/** A failed-and-cleaned environment holds no resources, so it does not count towards the cap. */
export function occupiesCapacity(state: EnvState): boolean {
  return state !== 'failed';
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function classify(
  envId: string,
  awsEnv: AwsEnvironment | null,
  envBuilds: BuildInfo[],
  now: number,
): EnvironmentView | null {
  const lastCreate = envBuilds.find((b) => b.job === 'create') ?? null;
  const lastDestroy = envBuilds.find((b) => b.job === 'destroy') ?? null;
  const destroyIsNewer =
    lastDestroy !== null && (lastCreate === null || lastDestroy.timestamp > lastCreate.timestamp);

  let state: EnvState;
  let note: string;

  if (destroyIsNewer && lastDestroy !== null && isActive(lastDestroy)) {
    state = 'destroying';
    note = 'Destroy in progress';
  } else if (awsEnv !== null) {
    if (destroyIsNewer && lastDestroy !== null && isFailed(lastDestroy)) {
      state = 'needs-cleanup';
      note = 'The last destroy failed. Run Destroy again.';
    } else if (destroyIsNewer) {
      state = 'destroying';
      note = 'Destroy finished; waiting for AWS to show the resources gone';
    } else if (lastCreate !== null && isActive(lastCreate)) {
      state = 'creating';
      note = lastCreate.queued ? 'Waiting in the Jenkins queue' : 'Provisioning';
    } else if (lastCreate !== null && lastCreate.result === 'SUCCESS') {
      state = 'ready';
      note = `Created in ${formatDuration(lastCreate.durationMs)}`;
    } else if (lastCreate !== null) {
      state = 'needs-cleanup';
      note = 'The build failed but resources still exist. Destroy it.';
    } else {
      state = 'external';
      note = 'No build record (created outside the pipeline)';
    }
  } else if (!destroyIsNewer && lastCreate !== null && isActive(lastCreate)) {
    state = 'creating';
    note = lastCreate.queued ? 'Waiting in the Jenkins queue' : 'Provisioning';
  } else if (
    !destroyIsNewer &&
    lastCreate !== null &&
    isFailed(lastCreate) &&
    now - lastCreate.timestamp < FAILED_VISIBLE_MS
  ) {
    state = 'failed';
    note = 'The build failed and everything was cleaned up';
  } else {
    // Destroyed, expired, or an old failure: nothing to show
    return null;
  }

  const latest = envBuilds[0] ?? null;
  const size = awsEnv?.size ?? lastCreate?.size ?? null;
  const ttlHours = awsEnv?.ttlHours ?? lastCreate?.ttlHours ?? null;
  const owner = awsEnv?.owner ?? lastCreate?.owner ?? null;
  const expiresAt = awsEnv?.expiresAt ?? null;
  const expiresMs = expiresAt !== null ? Date.parse(expiresAt) : Number.NaN;
  const minutesRemaining = Number.isNaN(expiresMs) ? null : Math.max(0, Math.round((expiresMs - now) / 60_000));

  const ip = awsEnv?.serverPublicIp ?? null;
  const showLinks = state === 'ready' && ip !== null && isIpv4(ip);

  return {
    envId,
    state,
    note,
    owner,
    size,
    ttlHours,
    expiresAt,
    minutesRemaining,
    appUrl: showLinks ? `http://${ip}:30080` : null,
    grafanaUrl: showLinks && size === 'medium' ? `http://${ip}:30300` : null,
    latestBuild: latest
      ? {
          job: latest.job,
          number: latest.number,
          result: latest.result,
          building: latest.building,
          queued: latest.queued,
          durationMs: latest.durationMs,
        }
      : null,
  };
}

export function buildEnvironmentList(input: {
  aws: AwsEnvironment[];
  builds: BuildInfo[];
  now: number;
}): EnvironmentView[] {
  const { aws, builds, now } = input;
  const awsById = new Map(aws.map((e) => [e.envId, e]));
  const buildsById = new Map<string, BuildInfo[]>();
  for (const build of builds) {
    const list = buildsById.get(build.envId) ?? [];
    list.push(build);
    buildsById.set(build.envId, list);
  }

  const ids = new Set<string>([...awsById.keys(), ...buildsById.keys()]);
  const views: EnvironmentView[] = [];
  for (const envId of ids) {
    const envBuilds = (buildsById.get(envId) ?? []).sort((a, b) => b.timestamp - a.timestamp);
    const view = classify(envId, awsById.get(envId) ?? null, envBuilds, now);
    if (view !== null) views.push(view);
  }
  return views.sort((a, b) => a.envId.localeCompare(b.envId));
}
