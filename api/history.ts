import { getHistory, loadGitHubConfig } from '../server/github.js';
import {
  ApiError,
  handleApiError,
  methodNotAllowed,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from '../server/http.js';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET']);
      return;
    }

    const queryLimit = req.query?.limit;
    if (
      Array.isArray(queryLimit) ||
      (queryLimit !== undefined && !/^(?:[1-9]|[12]\d|30)$/u.test(queryLimit))
    ) {
      throw new ApiError(400, 'INVALID_QUERY', 'limit 必须是 1 到 30 之间的整数。');
    }
    const limit = queryLimit === undefined ? 10 : Number(queryLimit);
    const items = await getHistory(loadGitHubConfig(), limit);
    sendJson(res, 200, { items });
  } catch (error) {
    handleApiError(res, error);
  }
}
