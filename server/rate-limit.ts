import { createHmac } from 'node:crypto';

import { getHeader, type ApiRequest } from './http.js';

const WINDOW_MS = 15 * 60 * 1_000;
const BLOCK_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 8;
const MAX_TRACKED_CLIENTS = 5_000;

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

const attempts = new Map<string, AttemptState>();

function normalizedClientAddress(req: ApiRequest): string {
  const forwarded = getHeader(req, 'x-forwarded-for')?.split(',', 1)[0].trim();
  const direct = getHeader(req, 'x-real-ip')?.trim();
  const candidate = forwarded || direct || 'unknown';
  return /^[A-Fa-f0-9:.]{2,64}$/u.test(candidate) ? candidate : 'unknown';
}

/** Hash the address so the in-memory limiter does not retain raw client IPs. */
export function loginClientKey(req: ApiRequest, secret: string): string {
  return createHmac('sha256', secret)
    .update(`login-rate-limit-v1\0${normalizedClientAddress(req)}`, 'utf8')
    .digest('base64url');
}

function retrySeconds(blockedUntil: number, nowMs: number): number | null {
  return blockedUntil > nowMs ? Math.max(1, Math.ceil((blockedUntil - nowMs) / 1_000)) : null;
}

export function loginRetryAfter(key: string, nowMs = Date.now()): number | null {
  const current = attempts.get(key);
  if (!current) return null;
  const retry = retrySeconds(current.blockedUntil, nowMs);
  if (retry !== null) return retry;
  if (nowMs - current.windowStartedAt >= WINDOW_MS) attempts.delete(key);
  return null;
}

export function recordLoginFailure(key: string, nowMs = Date.now()): number | null {
  let current = attempts.get(key);
  if (!current || nowMs - current.windowStartedAt >= WINDOW_MS) {
    current = { failures: 0, windowStartedAt: nowMs, blockedUntil: 0 };
  }
  current.failures += 1;
  if (current.failures >= MAX_FAILURES) current.blockedUntil = nowMs + BLOCK_MS;

  if (!attempts.has(key) && attempts.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = attempts.keys().next().value as string | undefined;
    if (oldestKey) attempts.delete(oldestKey);
  }
  attempts.delete(key);
  attempts.set(key, current);
  return retrySeconds(current.blockedUntil, nowMs);
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
