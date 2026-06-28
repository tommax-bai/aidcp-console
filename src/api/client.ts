/**
 * 面板 API 客户端：挂 Bearer、统一 JSON、401 抛 UnauthorizedError（上层跳登录）。
 *
 * JWT 存储：design 开放问题倾向同站 httpOnly cookie；当前持久化到 localStorage（刷新不掉登录、
 * 多标签共享），内存镜像加速读取。token 过期由后端 401 兜底（getToken 取到的过期 token 一旦
 * 调用即被 setToken(null) 清掉并跳登录）。留 setToken/getToken 缝，后续可换 httpOnly cookie
 * （届时请求改 credentials:'include'）。
 */

const TOKEN_KEY = 'aidcp.panel.token';

function readStoredToken(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

// 内存镜像：加载时从 localStorage 回灌，使刷新后仍保持登录态。
let token: string | null = readStoredToken();

export function setToken(t: string | null): void {
  token = t;
  try {
    if (typeof localStorage === 'undefined') return;
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage 不可用（隐私模式/禁用）时降级为内存态，不致崩 */
  }
}
export function getToken(): string | null {
  return token;
}

/** 401：未授权 / token 过期，上层跳登录。 */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/** 其余非 2xx。 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 会话失效通知缝：任何请求收到 401 时回调。鉴权上下文注册它，用于「当场关掉登录态 + 清缓存 +
 * 跳登录页」，不再依赖用户手动刷新整页才被动弹回登录。登录请求显式不触发它（被拒是凭据错误，非会话过期）。
 */
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  sessionExpiredHandler = fn;
}

interface RequestOptions {
  /** 默认 true；登录请求设 false：登录被拒是「用户名/密码错误」，不应触发全局会话过期跳转。 */
  notifySessionExpired?: boolean;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    setToken(null);
    if (opts.notifySessionExpired !== false) sessionExpiredHandler?.();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // 非 JSON 错误体，沿用 statusText
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  );
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** DELETE（精选内容后台管理 change curated-content-admin-page）：账号等约束走 query string。 */
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
