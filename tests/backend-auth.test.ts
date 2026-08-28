import { describe, expect, it } from 'vitest';
import { scryptSync } from 'node:crypto';

import {
  createSessionToken,
  loadAuthConfig,
  makeSessionCookie,
  verifyPassword,
  verifySessionToken,
} from '../server/auth.js';
import {
  clearLoginFailures,
  loginRetryAfter,
  recordLoginFailure,
} from '../server/rate-limit.js';

const secret = 'a-test-session-secret-that-is-at-least-32-characters';

describe('auth configuration and sessions', () => {
  it('supports multiple hashed passwords and returns their editor labels', () => {
    const config = loadAuthConfig({
      SESSION_SECRET: secret,
      LEDGER_PASSWORD_HASHES: JSON.stringify({
        owner: '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b',
        teammate: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
      }),
    });

    expect(config.configured).toBe(true);
    expect(verifyPassword(config, 'secret')).toBe('owner');
    expect(verifyPassword(config, 'password')).toBe('teammate');
    expect(verifyPassword(config, 'wrong')).toBeNull();
  });

  it('supports the recommended salted scrypt verifier', () => {
    const salt = Buffer.from('0123456789abcdef', 'utf8');
    const digest = scryptSync('a long unique password', salt, 32, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const verifier = `scrypt$16384$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
    const config = loadAuthConfig({
      SESSION_SECRET: secret,
      LEDGER_PASSWORD_HASHES: JSON.stringify({ owner: verifier }),
    });

    expect(config.configured).toBe(true);
    expect(verifyPassword(config, 'a long unique password')).toBe('owner');
    expect(verifyPassword(config, 'wrong')).toBeNull();
  });

  it('supports plaintext JSON fallback without retaining plaintext', () => {
    const config = loadAuthConfig({
      SESSION_SECRET: secret,
      LEDGER_PASSWORDS: JSON.stringify({ editor: 'correct horse battery staple' }),
    });

    expect(config.configured).toBe(true);
    expect(verifyPassword(config, 'correct horse battery staple')).toBe('editor');
    expect(JSON.stringify(config)).not.toContain('correct horse battery staple');
  });

  it('invalidates a signed session when password configuration changes', () => {
    const original = loadAuthConfig({
      SESSION_SECRET: secret,
      LEDGER_PASSWORDS: JSON.stringify({ editor: 'before' }),
      SESSION_TTL_SECONDS: '600',
    });
    const changed = loadAuthConfig({
      SESSION_SECRET: secret,
      LEDGER_PASSWORDS: JSON.stringify({ editor: 'after' }),
      SESSION_TTL_SECONDS: '600',
    });
    const now = Date.UTC(2026, 7, 28, 8);
    const { token } = createSessionToken(original, 'editor', now);

    expect(verifySessionToken(original, token, now + 1_000)?.editor).toBe('editor');
    expect(verifySessionToken(changed, token, now + 1_000)).toBeNull();
  });

  it('rejects expired and tampered sessions', () => {
    const config = loadAuthConfig({
      SESSION_SECRET: secret,
      LEDGER_PASSWORDS: JSON.stringify({ editor: 'before' }),
      SESSION_TTL_SECONDS: '300',
    });
    const now = Date.UTC(2026, 7, 28, 8);
    const { token } = createSessionToken(config, 'editor', now);

    expect(verifySessionToken(config, token, now + 301_000)).toBeNull();
    expect(verifySessionToken(config, `${token.slice(0, -1)}x`, now)).toBeNull();
  });

  it('sets hardened cookie attributes', () => {
    const cookie = makeSessionCookie('token', 600, true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
  });

  it('fails closed for malformed credential configuration or a short secret', () => {
    expect(
      loadAuthConfig({ SESSION_SECRET: secret, LEDGER_PASSWORD_HASHES: '{bad json' }).configured,
    ).toBe(false);
    expect(
      loadAuthConfig({ SESSION_SECRET: 'short', LEDGER_PASSWORDS: '{"editor":"password"}' })
        .configured,
    ).toBe(false);
  });

  it('temporarily blocks repeated failed login attempts', () => {
    const key = 'test-client-rate-limit';
    const now = Date.UTC(2026, 7, 28, 8);
    clearLoginFailures(key);
    for (let attempt = 1; attempt < 8; attempt += 1) {
      expect(recordLoginFailure(key, now + attempt)).toBeNull();
    }
    expect(recordLoginFailure(key, now + 8)).toBe(900);
    expect(loginRetryAfter(key, now + 1_008)).toBe(899);
    expect(loginRetryAfter(key, now + 15 * 60 * 1_000 + 9)).toBeNull();
    clearLoginFailures(key);
  });
});
