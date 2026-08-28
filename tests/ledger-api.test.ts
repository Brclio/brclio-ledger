import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from '../src/lib/api.js';
import { createDefaultLedger } from '../src/lib/ledger.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ledger API client', () => {
  it('authenticates with cookies and parses auth state', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        authenticated: true,
        editor: 'esther',
        expiresAt: '2026-08-29T00:00:00Z',
        configured: true,
      }),
    );
    const client = createApiClient({ baseUrl: '/custom-api/', fetch: fetchMock });

    await expect(client.authenticate('secret')).resolves.toMatchObject({
      authenticated: true,
      editor: 'esther',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/custom-api/auth',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ password: 'secret' }),
      }),
    );
  });

  it('loads, normalizes and saves a ledger using expectedSha', async () => {
    const data = createDefaultLedger();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data, sha: 'old-sha', commitUrl: null }))
      .mockResolvedValueOnce(
        jsonResponse({ data, sha: 'new-sha', commitUrl: 'https://github.com/commit/new' }),
      );
    const client = createApiClient({ fetch: fetchMock });

    await expect(client.getLedger()).resolves.toMatchObject({ sha: 'old-sha' });
    await expect(client.saveLedger(data, 'old-sha')).resolves.toMatchObject({ sha: 'new-sha' });

    const [, saveInit] = fetchMock.mock.calls[1];
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ledger');
    expect(saveInit.method).toBe('PUT');
    expect(JSON.parse(String(saveInit.body))).toMatchObject({
      data,
      expectedSha: 'old-sha',
    });
  });

  it('exposes the latest remote payload on a 409 conflict', async () => {
    const remote = {
      data: createDefaultLedger(),
      sha: 'remote-sha',
      commitUrl: 'https://github.com/commit/remote',
    };
    const client = createApiClient({
      fetch: vi.fn(async () =>
        jsonResponse(
          {
            error: { code: 'CONFLICT', message: '账本已被其他人更新' },
            remote,
          },
          409,
        ),
      ),
    });

    const error = await client
      .saveLedger(createDefaultLedger(), 'stale')
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: '账本已被其他人更新',
      remote: { sha: 'remote-sha' },
    });
  });

  it('fetches history with a bounded limit', async () => {
    const items = [
      {
        sha: 'abc',
        message: '更新账本',
        author: 'esther',
        date: '2026-08-28T00:00:00Z',
        url: 'https://github.com/commit/abc',
      },
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ items }),
    );
    const client = createApiClient({ fetch: fetchMock });

    await expect(client.getHistory(999)).resolves.toEqual(items);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/history?limit=30');
  });

  it('turns network and invalid-response failures into ApiError', async () => {
    const offline = createApiClient({
      fetch: vi.fn(async () => {
        throw new TypeError('offline');
      }),
    });
    await expect(offline.getLedger()).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });

    const malformed = createApiClient({
      fetch: vi.fn(async () => jsonResponse({ surprise: true })),
    });
    await expect(malformed.getAuthState()).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
    });
  });
});
