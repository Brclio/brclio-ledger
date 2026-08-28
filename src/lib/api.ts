import { z } from 'zod';

import type { AuthState, HistoryItem, LedgerData, RemoteLedger } from '../types.js';
import { normalizeLedgerData } from './ledger.js';

const authStateSchema = z.object({
  authenticated: z.boolean(),
  editor: z.string().nullable(),
  expiresAt: z.string().nullable(),
  configured: z.boolean(),
});

const remoteLedgerSchema = z.object({
  data: z.unknown(),
  sha: z.string().nullable(),
  commitUrl: z.string().nullable().optional(),
});

const historyItemSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  date: z.string(),
  url: z.string(),
});

const historyResponseSchema = z.object({
  items: z.array(historyItemSchema),
});

const errorEnvelopeSchema = z.object({
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
  remote: remoteLedgerSchema.optional(),
});

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ApiErrorOptions {
  status: number;
  code?: string;
  details?: unknown;
  remote?: RemoteLedger | null;
  body?: unknown;
  cause?: unknown;
}

/** A predictable error shape for HTTP, validation, network and 409 failures. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly remote: RemoteLedger | null;
  readonly remoteLedger: RemoteLedger | null;
  readonly body: unknown;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code ?? 'API_ERROR';
    this.details = options.details;
    this.remote = options.remote ?? null;
    this.remoteLedger = this.remote;
    this.body = options.body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface SaveLedgerOptions {
  force?: boolean;
}

export interface LedgerApiClient {
  getAuthState(): Promise<AuthState>;
  authenticate(password: string): Promise<AuthState>;
  logout(): Promise<AuthState>;
  getLedger(): Promise<RemoteLedger>;
  saveLedger(
    data: LedgerData,
    expectedSha: string | null,
    options?: SaveLedgerOptions,
  ): Promise<RemoteLedger>;
  getHistory(limit?: number): Promise<HistoryItem[]>;
}

function joinUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeRemote(value: unknown): RemoteLedger | null {
  const parsed = remoteLedgerSchema.safeParse(value);
  if (!parsed.success) return null;

  return {
    data: normalizeLedgerData(parsed.data.data),
    sha: parsed.data.sha,
    commitUrl: parsed.data.commitUrl ?? null,
  };
}

function invalidResponse(status: number, issues: unknown, body: unknown): ApiError {
  return new ApiError('服务器返回了无法识别的数据。', {
    status,
    code: 'INVALID_RESPONSE',
    details: issues,
    body,
  });
}

export function createApiClient(options: ApiClientOptions = {}): LedgerApiClient {
  const baseUrl = options.baseUrl ?? '/api';
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);

  async function request(endpoint: string, init: RequestInit = {}): Promise<{
    body: unknown;
    status: number;
  }> {
    if (!fetchImpl) {
      throw new ApiError('当前环境不支持网络请求。', {
        status: 0,
        code: 'FETCH_UNAVAILABLE',
      });
    }

    let response: Response;
    try {
      response = await fetchImpl(joinUrl(baseUrl, endpoint), {
        ...init,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...init.headers,
        },
      });
    } catch (cause) {
      throw new ApiError('无法连接服务器，请检查网络后重试。', {
        status: 0,
        code: 'NETWORK_ERROR',
        cause,
      });
    }

    const body = await readResponseBody(response);
    if (!response.ok) {
      const envelope = errorEnvelopeSchema.safeParse(body);
      const remote = envelope.success ? normalizeRemote(envelope.data.remote) : null;
      const serverError = envelope.success ? envelope.data.error : undefined;
      const defaultMessage =
        response.status === 401
          ? '验证已失效，请重新输入密码。'
          : response.status === 409
            ? '远程账本已更新，请先处理冲突。'
            : `请求失败（${response.status}）。`;

      throw new ApiError(serverError?.message || defaultMessage, {
        status: response.status,
        code: serverError?.code ?? (response.status === 409 ? 'CONFLICT' : 'HTTP_ERROR'),
        details: serverError?.details,
        remote,
        body,
      });
    }

    return { body, status: response.status };
  }

  function parseAuth(body: unknown, status: number): AuthState {
    const parsed = authStateSchema.safeParse(body);
    if (!parsed.success) throw invalidResponse(status, parsed.error.issues, body);
    return parsed.data;
  }

  function parseRemote(body: unknown, status: number): RemoteLedger {
    const parsed = remoteLedgerSchema.safeParse(body);
    if (!parsed.success) throw invalidResponse(status, parsed.error.issues, body);
    return {
      data: normalizeLedgerData(parsed.data.data),
      sha: parsed.data.sha,
      commitUrl: parsed.data.commitUrl ?? null,
    };
  }

  return {
    async getAuthState() {
      const response = await request('auth');
      return parseAuth(response.body, response.status);
    },

    async authenticate(password) {
      if (!password) {
        throw new ApiError('请输入编辑密码。', {
          status: 400,
          code: 'PASSWORD_REQUIRED',
        });
      }
      const response = await request('auth', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      return parseAuth(response.body, response.status);
    },

    async logout() {
      const response = await request('auth', { method: 'DELETE' });
      return parseAuth(response.body, response.status);
    },

    async getLedger() {
      const response = await request('ledger');
      return parseRemote(response.body, response.status);
    },

    async saveLedger(data, expectedSha, saveOptions = {}) {
      const response = await request('ledger', {
        method: 'PUT',
        body: JSON.stringify({
          data: normalizeLedgerData(data),
          expectedSha,
          ...(saveOptions.force ? { force: true } : {}),
        }),
      });
      return parseRemote(response.body, response.status);
    },

    async getHistory(limit = 10) {
      const normalizedLimit = Math.max(1, Math.min(30, Math.trunc(limit) || 10));
      const response = await request(`history?limit=${normalizedLimit}`);
      const parsed = historyResponseSchema.safeParse(response.body);
      if (!parsed.success) {
        throw invalidResponse(response.status, parsed.error.issues, response.body);
      }
      return parsed.data.items;
    },
  };
}

export const apiClient = createApiClient();
export const getAuthState = apiClient.getAuthState;
export const authenticate = apiClient.authenticate;
export const logout = apiClient.logout;
export const fetchLedger = apiClient.getLedger;
export const saveLedger = apiClient.saveLedger;
export const fetchHistory = apiClient.getHistory;
