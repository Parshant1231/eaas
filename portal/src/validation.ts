import type { Size, Ttl } from './types.js';

// Same rule as the Jenkins pipeline, Terraform, and every script
export const ENV_NAME_RE = /^[a-z][a-z0-9-]{2,19}$/;
export const OWNER_RE = /^[a-z][a-z0-9-]{2,30}$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

const SIZES: readonly string[] = ['small', 'medium'];
const TTLS: readonly number[] = [1, 2, 4];

export function isValidEnvId(value: unknown): value is string {
  return typeof value === 'string' && ENV_NAME_RE.test(value);
}

export function isValidOwner(value: unknown): value is string {
  return typeof value === 'string' && OWNER_RE.test(value);
}

export function isIpv4(value: unknown): value is string {
  if (typeof value !== 'string' || !IPV4_RE.test(value)) return false;
  return value.split('.').every((part) => Number(part) <= 255);
}

export interface CreateRequest {
  name: string;
  size: Size;
  ttlHours: Ttl;
}

export type ParseResult = { ok: true; value: CreateRequest } | { ok: false; error: string };

export function parseCreateRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const { name, size, ttlHours } = body as Record<string, unknown>;
  if (!isValidEnvId(name)) {
    return { ok: false, error: 'name must be 3-20 characters: lowercase letters, digits and hyphens, starting with a letter' };
  }
  if (typeof size !== 'string' || !SIZES.includes(size)) {
    return { ok: false, error: 'size must be "small" or "medium"' };
  }
  if (typeof ttlHours !== 'number' || !TTLS.includes(ttlHours)) {
    return { ok: false, error: 'ttlHours must be 1, 2 or 4' };
  }
  return { ok: true, value: { name, size: size as Size, ttlHours: ttlHours as Ttl } };
}
