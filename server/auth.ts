import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

import type { ApiRequest } from './http.js';
import { getHeader } from './http.js';

export const SESSION_COOKIE_NAME = 'ledger_session';
export const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;

const MIN_SECRET_LENGTH = 32;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_PATTERN = /^scrypt\$16384\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/u;

export interface AuthConfig {
  configured: boolean;
  credentials: ReadonlyArray<{ label: string; digest: string }>;
  credentialVersion: string;
  secret: string;
  ttlSeconds: number;
}

export interface SessionClaims {
  editor: string;
  expiresAt: string;
}

interface SessionPayload {
  v: 1;
  editor: string;
  exp: number;
  cv: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeCredentialVerifier(value: string, sourceType: 'hash' | 'plaintext'): string | null {
  if (sourceType === 'plaintext') return `sha256$${sha256(value)}`;

  const normalized = value.trim();
  if (/^[a-f0-9]{64}$/iu.test(normalized)) return `sha256$${normalized.toLowerCase()}`;
  const match = SCRYPT_PATTERN.exec(normalized);
  if (!match) return null;
  try {
    if (
      Buffer.from(match[1], 'base64url').byteLength !== 16 ||
      Buffer.from(match[2], 'base64url').byteLength !== SCRYPT_KEY_LENGTH
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return normalized;
}

function parseCredentialObject(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return null;

    const result: Record<string, string> = {};
    for (const [label, value] of Object.entries(parsed)) {
      if (
        label.length < 1 ||
        label.length > 64 ||
        label !== label.trim() ||
        /[\u0000-\u001f\u007f]/u.test(label) ||
        typeof value !== 'string' ||
        value.length < 1
      ) {
        return null;
      }
      result[label] = value;
    }
    return result;
  } catch {
    return null;
  }
}

function parseTtl(value: string | undefined): number {
  if (!value) return DEFAULT_SESSION_TTL_SECONDS;
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl)) return DEFAULT_SESSION_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttl));
}

/** Load and normalize auth configuration without retaining plaintext passwords. */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const hashSource = env.LEDGER_PASSWORD_HASHES?.trim();
  const plaintextSource = env.LEDGER_PASSWORDS?.trim();
  let parsed: Record<string, string> | null = {};
  let sourceType: 'hash' | 'plaintext' = 'hash';

  if (hashSource) {
    parsed = parseCredentialObject(hashSource);
  } else if (plaintextSource) {
    parsed = parseCredentialObject(plaintextSource);
    sourceType = 'plaintext';
  }

  const credentials: Array<{ label: string; digest: string }> = [];
  let valid = parsed !== null;
  if (parsed) {
    for (const [label, value] of Object.entries(parsed)) {
      const digest = normalizeCredentialVerifier(value, sourceType);
      if (!digest) {
        valid = false;
        break;
      }
      credentials.push({ label, digest });
    }
  }

  credentials.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const secret = env.SESSION_SECRET ?? '';
  const canonicalCredentials = credentials
    .map(({ label, digest }) => `${label.length}:${label}:${digest}`)
    .join('|');
  // The version is carried inside the cookie to invalidate sessions after a
  // password change. Keying it prevents the password-hash-derived value from
  // becoming an offline password oracle for anyone who can read their cookie.
  const credentialVersion = createHmac('sha256', secret)
    .update(`credential-version-v1\0${canonicalCredentials}`, 'utf8')
    .digest('base64url');
  const configured =
    valid && credentials.length > 0 && Buffer.byteLength(secret, 'utf8') >= MIN_SECRET_LENGTH;

  return {
    configured,
    credentials: configured ? credentials : [],
    credentialVersion,
    secret,
    ttlSeconds: parseTtl(env.SESSION_TTL_SECONDS),
  };
}

function safeDigestEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyCredential(password: string, verifier: string): boolean {
  if (verifier.startsWith('sha256$')) {
    return safeDigestEqual(sha256(password), verifier.slice('sha256$'.length));
  }

  const match = SCRYPT_PATTERN.exec(verifier);
  if (!match) return false;
  const salt = Buffer.from(match[1], 'base64url');
  const expected = Buffer.from(match[2], 'base64url');
  const candidate = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function verifyPassword(config: AuthConfig, password: string): string | null {
  if (!config.configured || password.length > 1024) return null;
  let matched: string | null = null;

  // Check every configured digest so matching an early entry does not have a
  // noticeably different execution path from matching a later entry.
  for (const credential of config.credentials) {
    if (verifyCredential(password, credential.digest) && matched === null) {
      matched = credential.label;
    }
  }
  return matched;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url');
}

export function createSessionToken(
  config: AuthConfig,
  editor: string,
  nowMs = Date.now(),
): { token: string; claims: SessionClaims } {
  if (!config.configured) throw new Error('Auth is not configured');
  if (!config.credentials.some((credential) => credential.label === editor)) {
    throw new Error('Unknown editor');
  }
  const exp = Math.floor(nowMs / 1000) + config.ttlSeconds;
  const payload: SessionPayload = {
    v: 1,
    editor,
    exp,
    cv: config.credentialVersion,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return {
    token: `${encoded}.${sign(encoded, config.secret)}`,
    claims: { editor, expiresAt: new Date(exp * 1000).toISOString() },
  };
}

export function verifySessionToken(
  config: AuthConfig,
  token: string,
  nowMs = Date.now(),
): SessionClaims | null {
  if (!config.configured || token.length > 4096) return null;
  const segments = token.split('.');
  if (segments.length !== 2) return null;
  const [encoded, signature] = segments;
  const expectedSignature = sign(encoded, config.secret);

  const receivedBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expectedSignature, 'utf8');
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    const nowSeconds = Math.floor(nowMs / 1000);
    if (
      payload.v !== 1 ||
      typeof payload.editor !== 'string' ||
      !config.credentials.some((item) => item.label === payload.editor) ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= nowSeconds ||
      payload.cv !== config.credentialVersion
    ) {
      return null;
    }
    return { editor: payload.editor, expiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      // Ignore malformed cookies instead of rejecting unrelated requests.
    }
  }
  return cookies;
}

export function readSession(
  req: ApiRequest,
  config: AuthConfig,
  nowMs = Date.now(),
): SessionClaims | null {
  const token = parseCookies(getHeader(req, 'cookie'))[SESSION_COOKIE_NAME];
  return token ? verifySessionToken(config, token, nowMs) : null;
}

export function shouldUseSecureCookie(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.VERCEL);
}

export function makeSessionCookie(token: string, ttlSeconds: number, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${ttlSeconds}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function makeClearSessionCookie(secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}
