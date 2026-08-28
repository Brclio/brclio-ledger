import { ApiError } from './http.js';
import {
  MAX_LEDGER_BYTES,
  parseLedgerData,
  serializeLedger,
  type LedgerData,
} from './ledger.js';

const GITHUB_API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 12_000;

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  dataPath: string;
  token?: string;
  committer?: { name: string; email: string };
}

export interface RemoteLedger {
  data: LedgerData;
  sha: string;
  commitUrl: string | null;
}

export interface HistoryItem {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

interface GitHubContentResponse {
  type?: unknown;
  sha?: unknown;
  content?: unknown;
  encoding?: unknown;
  html_url?: unknown;
}

interface GitHubWriteResponse {
  content?: { sha?: unknown } | null;
  commit?: { sha?: unknown; html_url?: unknown } | null;
}

export class GitHubConflictError extends Error {
  constructor() {
    super('GitHub rejected the write due to a content conflict');
    this.name = 'GitHubConflictError';
  }
}

function requiredSafeSegment(value: string, fallback: string): string {
  const resolved = value.trim() || fallback;
  if (!/^[A-Za-z0-9_.-]+$/u.test(resolved)) {
    throw new ApiError(500, 'SERVER_MISCONFIGURED', 'GitHub 仓库配置无效。');
  }
  return resolved;
}

function validateBranch(value: string): string {
  const branch = value.trim();
  if (!branch || branch.length > 255 || /[\u0000-\u001f\u007f]/u.test(branch)) {
    throw new ApiError(500, 'SERVER_MISCONFIGURED', 'GitHub 分支配置无效。');
  }
  return branch;
}

function validateDataPath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/gu, '');
  const segments = path.split('/');
  if (
    !path ||
    path.length > 512 ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/u.test(segment),
    )
  ) {
    throw new ApiError(500, 'SERVER_MISCONFIGURED', 'GitHub 数据路径配置无效。');
  }
  return path;
}

export function loadGitHubConfig(env: NodeJS.ProcessEnv = process.env): GitHubConfig {
  const owner = requiredSafeSegment(env.GITHUB_OWNER ?? '', 'Brclio');
  const repo = requiredSafeSegment(env.GITHUB_REPO ?? '', 'brclio-ledger');
  const branch = validateBranch(env.GITHUB_BRANCH ?? 'main');
  const dataPath = validateDataPath(env.GITHUB_DATA_PATH ?? 'data/ledger.json');
  const token = env.GITHUB_TOKEN?.trim() || undefined;
  const committerName = env.GITHUB_COMMITTER_NAME?.trim();
  const committerEmail = env.GITHUB_COMMITTER_EMAIL?.trim();
  let committer: GitHubConfig['committer'];

  if (committerName && committerEmail) {
    if (
      committerName.length > 100 ||
      committerEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(committerEmail)
    ) {
      throw new ApiError(500, 'SERVER_MISCONFIGURED', 'GitHub 提交者配置无效。');
    }
    committer = { name: committerName, email: committerEmail };
  }

  return { owner, repo, branch, dataPath, token, committer };
}

export function contentApiUrl(config: GitHubConfig): string {
  const path = config.dataPath.split('/').map(encodeURIComponent).join('/');
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`;
}

function requestHeaders(config: GitHubConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'brclio-ledger',
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  return headers;
}

async function githubFetch(
  url: string,
  config: GitHubConfig,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...requestHeaders(config), ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, 'GITHUB_UNAVAILABLE', '暂时无法连接 GitHub。');
  }

  if (response.status === 409) throw new GitHubConflictError();
  if (response.status === 404) {
    throw new ApiError(502, 'LEDGER_NOT_FOUND', 'GitHub 仓库中未找到账本文件。');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(502, 'GITHUB_AUTH_ERROR', 'GitHub 访问凭据无效或权限不足。');
  }
  if (!response.ok) {
    throw new ApiError(502, 'GITHUB_ERROR', 'GitHub 暂时无法处理请求。');
  }
  return response;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiError(502, 'INVALID_GITHUB_RESPONSE', 'GitHub 返回了无效数据。');
  }
}

export async function getRemoteLedger(config: GitHubConfig): Promise<RemoteLedger> {
  const url = new URL(contentApiUrl(config));
  url.searchParams.set('ref', config.branch);
  const raw = (await readJsonResponse(await githubFetch(url.toString(), config))) as GitHubContentResponse;

  if (
    raw.type !== 'file' ||
    typeof raw.sha !== 'string' ||
    !/^[a-f0-9]{40}$/iu.test(raw.sha) ||
    raw.encoding !== 'base64' ||
    typeof raw.content !== 'string'
  ) {
    throw new ApiError(502, 'INVALID_GITHUB_RESPONSE', 'GitHub 账本文件格式无效。');
  }

  let decoded: Buffer;
  let parsed: unknown;
  try {
    decoded = Buffer.from(raw.content.replace(/\s/gu, ''), 'base64');
    if (decoded.byteLength > MAX_LEDGER_BYTES) {
      throw new ApiError(502, 'LEDGER_TOO_LARGE', 'GitHub 中的账本文件超过大小限制。');
    }
    parsed = JSON.parse(decoded.toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'INVALID_LEDGER_DATA', 'GitHub 中的账本数据无效。');
  }

  try {
    return {
      data: parseLedgerData(parsed),
      sha: raw.sha,
      commitUrl: typeof raw.html_url === 'string' ? raw.html_url : null,
    };
  } catch {
    throw new ApiError(502, 'INVALID_LEDGER_DATA', 'GitHub 中的账本数据无效。');
  }
}

export async function putRemoteLedger(
  config: GitHubConfig,
  data: LedgerData,
  currentSha: string,
  editor: string,
): Promise<{ sha: string; commitUrl: string | null }> {
  if (!config.token) {
    throw new ApiError(503, 'WRITE_NOT_CONFIGURED', '服务器尚未配置 GitHub 写入凭据。');
  }

  const requestBody: Record<string, unknown> = {
    message: `ledger: save by ${editor}`,
    content: Buffer.from(serializeLedger(data), 'utf8').toString('base64'),
    sha: currentSha,
    branch: config.branch,
  };
  if (config.committer) requestBody.committer = config.committer;

  const response = await githubFetch(contentApiUrl(config), config, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const raw = (await readJsonResponse(response)) as GitHubWriteResponse;
  const sha = raw.content?.sha;
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/iu.test(sha)) {
    throw new ApiError(502, 'INVALID_GITHUB_RESPONSE', 'GitHub 未返回有效的文件版本。');
  }
  return {
    sha,
    commitUrl: typeof raw.commit?.html_url === 'string' ? raw.commit.html_url : null,
  };
}

export function normalizeHistory(input: unknown): HistoryItem[] {
  if (!Array.isArray(input)) {
    throw new ApiError(502, 'INVALID_GITHUB_RESPONSE', 'GitHub 返回了无效的历史记录。');
  }

  return input.flatMap((item): HistoryItem[] => {
    if (item === null || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const commit = record.commit;
    if (commit === null || typeof commit !== 'object') return [];
    const commitRecord = commit as Record<string, unknown>;
    const author = commitRecord.author;
    const committer = commitRecord.committer;
    const authorRecord = author && typeof author === 'object' ? (author as Record<string, unknown>) : {};
    const committerRecord =
      committer && typeof committer === 'object' ? (committer as Record<string, unknown>) : {};
    const accountAuthor = record.author;
    const accountAuthorRecord =
      accountAuthor && typeof accountAuthor === 'object'
        ? (accountAuthor as Record<string, unknown>)
        : {};
    const sha = record.sha;
    const url = record.html_url;
    const rawMessage = commitRecord.message;
    const date = authorRecord.date ?? committerRecord.date;
    const name = accountAuthorRecord.login ?? authorRecord.name ?? committerRecord.name;

    if (
      typeof sha !== 'string' ||
      typeof url !== 'string' ||
      typeof rawMessage !== 'string' ||
      typeof date !== 'string' ||
      typeof name !== 'string'
    ) {
      return [];
    }

    return [
      {
        sha,
        message: rawMessage.split(/\r?\n/u, 1)[0].slice(0, 240),
        author: name.slice(0, 100),
        date,
        url,
      },
    ];
  });
}

export async function getHistory(config: GitHubConfig, limit: number): Promise<HistoryItem[]> {
  const url = new URL(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/commits`,
  );
  url.searchParams.set('path', config.dataPath);
  url.searchParams.set('sha', config.branch);
  url.searchParams.set('per_page', String(limit));
  const response = await githubFetch(url.toString(), config);
  return normalizeHistory(await readJsonResponse(response)).slice(0, limit);
}
