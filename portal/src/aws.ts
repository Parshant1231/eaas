import { DescribeInstancesCommand, DescribeVpcsCommand, EC2Client, type Tag } from '@aws-sdk/client-ec2';
import { UpstreamError } from './errors.js';
import type { AwsEnvironment, Size } from './types.js';
import { isIpv4, isValidEnvId } from './validation.js';

export interface AwsReader {
  listEnvironments(): Promise<AwsEnvironment[]>;
}

function tagMap(tags: Tag[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags ?? []) {
    if (tag.Key !== undefined && tag.Value !== undefined) out[tag.Key] = tag.Value;
  }
  return out;
}

export function createAwsReader(region: string): AwsReader {
  const ec2 = new EC2Client({ region });

  return {
    async listEnvironments(): Promise<AwsEnvironment[]> {
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

        const perEnv = new Map<string, { count: number; serverIp: string | null }>();
        for (const reservation of instances.Reservations ?? []) {
          for (const instance of reservation.Instances ?? []) {
            const tags = tagMap(instance.Tags);
            const envId = tags['env-id'];
            if (!isValidEnvId(envId)) continue;
            const entry = perEnv.get(envId) ?? { count: 0, serverIp: null };
            entry.count += 1;
            if (tags['role'] === 'server' && isIpv4(instance.PublicIpAddress)) {
              entry.serverIp = instance.PublicIpAddress;
            }
            perEnv.set(envId, entry);
          }
        }

        const out: AwsEnvironment[] = [];
        for (const vpc of vpcs.Vpcs ?? []) {
          const tags = tagMap(vpc.Tags);
          const envId = tags['env-id'];
          if (!isValidEnvId(envId)) continue;
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
            instanceCount: info?.count ?? 0,
          });
        }
        return out;
      } catch {
        throw new UpstreamError('Could not read environment state from AWS', 502);
      }
    },
  };
}
