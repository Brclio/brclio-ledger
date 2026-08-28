import { z } from 'zod';

import {
  createSessionToken,
  loadAuthConfig,
  makeClearSessionCookie,
  makeSessionCookie,
  readSession,
  shouldUseSecureCookie,
  verifyPassword,
} from '../server/auth.js';
import {
  handleApiError,
  methodNotAllowed,
  parseJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from '../server/http.js';
import {
  clearLoginFailures,
  loginClientKey,
  loginRetryAfter,
  recordLoginFailure,
} from '../server/rate-limit.js';

const loginSchema = z.object({ password: z.string().min(1).max(1024) }).strict();

function state(
  configured: boolean,
  session: { editor: string; expiresAt: string } | null,
) {
  return {
    authenticated: session !== null,
    editor: session?.editor ?? null,
    expiresAt: session?.expiresAt ?? null,
    configured,
  };
}

export default function handler(req: ApiRequest, res: ApiResponse): void {
  try {
    const config = loadAuthConfig();
    const secureCookie = shouldUseSecureCookie();

    if (req.method === 'GET') {
      sendJson(res, 200, state(config.configured, readSession(req, config)));
      return;
    }

    if (req.method === 'POST') {
      if (!config.configured) {
        sendError(res, 503, 'AUTH_NOT_CONFIGURED', '服务器尚未配置编辑密码。');
        return;
      }

      const parsed = loginSchema.safeParse(parseJsonBody(req.body, 4_096));
      if (!parsed.success) {
        sendError(res, 400, 'INVALID_REQUEST', '登录请求格式无效。');
        return;
      }
      const clientKey = loginClientKey(req, config.secret);
      const retryAfter = loginRetryAfter(clientKey);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        sendError(res, 429, 'TOO_MANY_ATTEMPTS', '密码尝试过多，请稍后再试。');
        return;
      }
      const editor = verifyPassword(config, parsed.data.password);
      if (!editor) {
        const blockedFor = recordLoginFailure(clientKey);
        if (blockedFor !== null) {
          res.setHeader('Retry-After', String(blockedFor));
          sendError(res, 429, 'TOO_MANY_ATTEMPTS', '密码尝试过多，请稍后再试。');
          return;
        }
        sendError(res, 401, 'INVALID_PASSWORD', '密码不正确。');
        return;
      }

      clearLoginFailures(clientKey);
      const session = createSessionToken(config, editor);
      res.setHeader(
        'Set-Cookie',
        makeSessionCookie(session.token, config.ttlSeconds, secureCookie),
      );
      sendJson(res, 200, state(true, session.claims));
      return;
    }

    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', makeClearSessionCookie(secureCookie));
      sendJson(res, 200, state(config.configured, null));
      return;
    }

    methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  } catch (error) {
    handleApiError(res, error);
  }
}
