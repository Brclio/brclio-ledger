import { z } from 'zod';

import { loadAuthConfig, readSession } from '../server/auth.js';
import {
  getRemoteLedger,
  GitHubConflictError,
  loadGitHubConfig,
  putRemoteLedger,
  type RemoteLedger,
} from '../server/github.js';
import {
  ApiError,
  handleApiError,
  methodNotAllowed,
  parseJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from '../server/http.js';
import {
  formatValidationIssues,
  parseLedgerPut,
  stampAndValidateLedger,
} from '../server/ledger.js';

function sendConflict(res: ApiResponse, remote: RemoteLedger): void {
  sendJson(res, 409, {
    error: {
      code: 'CONFLICT',
      message: '远程账本已更新，请刷新后重试，或确认后强制覆盖。',
    },
    remote,
  });
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const github = loadGitHubConfig();

    if (req.method === 'GET') {
      sendJson(res, 200, await getRemoteLedger(github));
      return;
    }

    if (req.method !== 'PUT') {
      methodNotAllowed(res, ['GET', 'PUT']);
      return;
    }

    const auth = loadAuthConfig();
    if (!auth.configured) {
      sendError(res, 503, 'AUTH_NOT_CONFIGURED', '服务器尚未配置编辑密码。');
      return;
    }
    const session = readSession(req, auth);
    if (!session) {
      sendError(res, 401, 'UNAUTHORIZED', '请先验证密码以获取编辑权限。');
      return;
    }
    if (!github.token) {
      sendError(res, 503, 'WRITE_NOT_CONFIGURED', '服务器尚未配置 GitHub 写入凭据。');
      return;
    }

    let input;
    try {
      input = parseLedgerPut(parseJsonBody(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(
          res,
          400,
          'INVALID_LEDGER',
          '账本数据未通过校验。',
          formatValidationIssues(error),
        );
        return;
      }
      throw error;
    }

    const remote = await getRemoteLedger(github);
    if (!input.force && input.expectedSha !== remote.sha) {
      sendConflict(res, remote);
      return;
    }

    let stamped;
    try {
      stamped = stampAndValidateLedger(input.data, session.editor);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(
          res,
          400,
          'STAMPED_LEDGER_TOO_LARGE',
          '加入保存元数据后，账本超过大小限制。请精简记录后重试。',
          formatValidationIssues(error),
        );
        return;
      }
      throw error;
    }
    try {
      const saved = await putRemoteLedger(github, stamped, remote.sha, session.editor);
      sendJson(res, 200, { data: stamped, sha: saved.sha, commitUrl: saved.commitUrl });
    } catch (error) {
      if (error instanceof GitHubConflictError) {
        // A commit landed between our read and write. Return the new remote state
        // in the same shape as a preflight optimistic-lock conflict.
        try {
          sendConflict(res, await getRemoteLedger(github));
        } catch {
          throw new ApiError(409, 'CONFLICT', '远程账本已更新，请刷新后重试。');
        }
        return;
      }
      throw error;
    }
  } catch (error) {
    handleApiError(res, error);
  }
}
