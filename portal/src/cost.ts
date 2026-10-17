import type { Size } from './types.js';

// On-demand estimates for ap-south-1 (Mumbai). Instance prices come from public listings
// checked in October 2026; the IPv4 and EBS figures are approximate. This is an estimate,
// not a bill: it excludes data transfer and tax. Verify at https://aws.amazon.com/ec2/pricing/on-demand/
export const PRICES_AS_OF = '2026-10';

const INSTANCE_USD_PER_HOUR: Record<Size, number> = { small: 0.0224, medium: 0.0448 };
const NODES: Record<Size, number> = { small: 1, medium: 2 };
const PUBLIC_IPV4_USD_PER_HOUR = 0.005;
const ROOT_VOLUME_GB = 20;
const EBS_GP3_USD_PER_GB_MONTH = 0.0912;
const HOURS_PER_MONTH = 730;
const HOUR_MS = 3_600_000;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export interface CostEstimate {
  hourly: number;
  soFar: number | null;
  projected: number | null;
  asOf: string;
}

export function hourlyRate(size: Size): number {
  const perNode =
    INSTANCE_USD_PER_HOUR[size] +
    PUBLIC_IPV4_USD_PER_HOUR +
    (ROOT_VOLUME_GB * EBS_GP3_USD_PER_GB_MONTH) / HOURS_PER_MONTH;
  return perNode * NODES[size];
}

export function estimateCost(input: {
  size: Size;
  launchedAt: string | null;
  expiresAt: string | null;
  now: number;
}): CostEstimate {
  const hourly = hourlyRate(input.size);
  const launched = input.launchedAt !== null ? Date.parse(input.launchedAt) : Number.NaN;
  const expires = input.expiresAt !== null ? Date.parse(input.expiresAt) : Number.NaN;

  const soFar = Number.isNaN(launched) ? null : (Math.max(0, input.now - launched) / HOUR_MS) * hourly;
  const projected =
    Number.isNaN(launched) || Number.isNaN(expires) ? null : (Math.max(0, expires - launched) / HOUR_MS) * hourly;

  return {
    hourly: round(hourly, 4),
    soFar: soFar === null ? null : round(soFar, 3),
    projected: projected === null ? null : round(projected, 3),
    asOf: PRICES_AS_OF,
  };
}

export function estimateForRequest(size: Size, ttlHours: number) {
  const hourly = hourlyRate(size);
  return {
    size,
    ttlHours,
    nodes: NODES[size],
    hourly: round(hourly, 4),
    total: round(hourly * ttlHours, 3),
    asOf: PRICES_AS_OF,
  };
}
