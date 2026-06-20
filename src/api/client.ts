/**
 * 面板 API 客户端：挂 Bearer、统一 JSON、401 抛 UnauthorizedError（上层跳登录）。
 *
 * JWT 存储：design 开放问题倾向同站 httpOnly cookie；MVP 先用内存 token（刷新即重登），
 * 留 setToken/getToken 缝，后续可换 cookie（届时请求改 credentials:'include'）。
 */

let token: string | null = null;

export function setToken(t: string | null): void {
  token = t;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    setToken(null);
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

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
