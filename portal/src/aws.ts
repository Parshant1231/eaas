import { CreateTagsCommand, DescribeInstancesCommand, DescribeVpcsCommand, EC2Client, type Tag } from '@aws-sdk/client-ec2';
import { UpstreamError } from './errors.js';
import type { AwsEnvironment, Size } from './types.js';
import { isIpv4, isValidEnvId } from './validation.js';

export interface AwsReader {
  listEnvironments(): Promise<AwsEnvironment[]>;
  /** Moves an environment's expiry. This is the only thing the portal may write in AWS. */
  extendExpiry(envId: string, expiresAt: string): Promise<void>;
}

const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const VPC_ID_RE = /^vpc-[0-9a-f]{8,17}$/;
const INSTANCE_ID_RE = /^i-[0-9a-f]{8,17}$/;

function tagMap(tags: Tag[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags ?? []) {
    if (tag.Key !== undefined && tag.Value !== undefined) out[tag.Key] = tag.Value;
  }
  return out;
}

interface InstanceInfo {
  ids: string[];
  serverIp: string | null;
  launchedAt: number | null;
}

export function createAwsReader(region: string): AwsReader {
  const ec2 = new EC2Client({ region });

  async function listEnvironments(): Promise<AwsEnvironment[]> {
    try {
      const [vpcs, instances] = await Promise.all([
        ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: 'tag:project', Values: ['eaas'] }] })),
        ec2.send(
          new DescribeInstancesCommand({
            Filters: [
              { Name: 'tag:project', Values: ['eaas'] },
              { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
            ],
          }),
        ),
      ]);

      const perEnv = new Map<string, InstanceInfo>();
      for (const reservation of instances.Reservations ?? []) {
        for (const instance of reservation.Instances ?? []) {
          const tags = tagMap(instance.Tags);
          const envId = tags['env-id'];
          if (!isValidEnvId(envId) || instance.InstanceId === undefined) continue;
          const entry = perEnv.get(envId) ?? { ids: [], serverIp: null, launchedAt: null };
          entry.ids.push(instance.InstanceId);
          if (tags['role'] === 'server' && isIpv4(instance.PublicIpAddress)) {
            entry.serverIp = instance.PublicIpAddress;
          }
          const launch = instance.LaunchTime?.getTime();
          if (launch !== undefined && (entry.launchedAt === null || launch < entry.launchedAt)) {
            entry.launchedAt = launch;
          }
          perEnv.set(envId, entry);
        }
      }

      const out: AwsEnvironment[] = [];
      for (const vpc of vpcs.Vpcs ?? []) {
        const tags = tagMap(vpc.Tags);
        const envId = tags['env-id'];
        if (!isValidEnvId(envId) || vpc.VpcId === undefined) continue;
        const info = perEnv.get(envId);
        const sizeTag = tags['size'];
        const size: Size | null = sizeTag === 'small' || sizeTag === 'medium' ? sizeTag : null;
        const ttlTag = tags['ttl-hours'];
        const ttl = ttlTag !== undefined ? Number(ttlTag) : Number.NaN;
        out.push({
          envId,
          owner: tags['owner'] ?? null,
          size,
          ttlHours: Number.isFinite(ttl) ? ttl : null,
          expiresAt: tags['expires-at'] ?? null,
          serverPublicIp: info?.serverIp ?? null,
          instanceCount: info?.ids.length ?? 0,
          vpcId: vpc.VpcId,
          instanceIds: info?.ids ?? [],
          launchedAt: info?.launchedAt != null ? new Date(info.launchedAt).toISOString() : null,
        });
      }
      return out;
    } catch (err) {
      // The real cause is logged on the server only; the browser still gets the generic message
      console.error('aws read failed:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error');
      throw new UpstreamError('Could not read environment state from AWS', 502);
    }
  }

  async function extendExpiry(envId: string, expiresAt: string): Promise<void> {
    if (!isValidEnvId(envId) || !EXPIRY_RE.test(expiresAt)) throw new UpstreamError('Invalid extend request', 400);
    const env = (await listEnvironments()).find((e) => e.envId === envId);
    if (env === undefined) throw new UpstreamError('Environment not found', 404);

    // Only ids that look exactly like VPC or instance ids are ever sent to AWS
    const resources = [env.vpcId, ...env.instanceIds].filter((id) => VPC_ID_RE.test(id) || INSTANCE_ID_RE.test(id));
    if (resources.length === 0) throw new UpstreamError('Nothing to update for this environment', 404);

    try {
      await ec2.send(new CreateTagsCommand({ Resources: resources, Tags: [{ Key: 'expires-at', Value: expiresAt }] }));
    } catch {
      throw new UpstreamError('Could not update the expiry tag in AWS', 502);
    }
  }

  return { listEnvironments, extendExpiry };
}
