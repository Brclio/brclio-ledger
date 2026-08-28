export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface ApiResponse {
  status(statusCode: number): ApiResponse;
  setHeader(name: string, value: string | string[]): void;
  json(payload: unknown): void;
  end(payload?: string): void;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function prepareApiResponse(res: ApiResponse): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function sendJson(res: ApiResponse, status: number, payload: unknown): void {
  prepareApiResponse(res);
  res.status(status).json(payload);
}

export function sendError(
  res: ApiResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorBody = {
    error: details === undefined ? { code, message } : { code, message, details },
  };
  sendJson(res, status, body);
}

export function methodNotAllowed(res: ApiResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持此请求方法。');
}

export function handleApiError(res: ApiResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendError(res, error.status, error.code, error.message, error.details);
    return;
  }

  // Keep implementation details, credentials and upstream response bodies out of
  // client-visible errors. Vercel still captures an exception-free 500 response.
  sendError(res, 500, 'INTERNAL_ERROR', '服务器暂时无法处理此请求。');
}

export function getHeader(req: ApiRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()] ?? req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function parseJsonBody(body: unknown, maxBytes = 1_100_000): unknown {
  let value = body;
  let byteLength = 0;

  try {
    if (typeof body === 'string') {
      byteLength = Buffer.byteLength(body, 'utf8');
      value = JSON.parse(body) as unknown;
    } else if (Buffer.isBuffer(body)) {
      byteLength = body.byteLength;
      value = JSON.parse(body.toString('utf8')) as unknown;
    } else if (body !== undefined) {
      byteLength = Buffer.byteLength(JSON.stringify(body), 'utf8');
    }
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '请求正文不是有效的 JSON。');
  }

  if (body === undefined) {
    throw new ApiError(400, 'INVALID_REQUEST', '缺少请求正文。');
  }
  if (byteLength > maxBytes) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求数据过大。');
  }

  return value;
}
