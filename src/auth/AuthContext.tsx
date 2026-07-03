import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  getToken,
  setToken,
  setSessionExpiredHandler,
  refreshToken,
  logoutServer,
  tokenExpiresInMs,
} from '../api/client';
import type { LoginResponse } from '../types/api';

const REFRESH_WHEN_MS_LEFT = 5 * 60_000; // token 剩余 < 5 分钟即续签
const REFRESH_CHECK_INTERVAL_MS = 60_000;

interface AuthState {
  authed: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);

  // 会话过期兜底（#24）：任何请求 / WS 收到 401·4401（token 失效）时，当场关登录态 → 路由守卫弹回登录页、
  // 清残留缓存、并给「登录已过期」提示（与「凭据错被登出」区分，运营一眼知道发生了什么）。
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAuthed(false);
      queryClient.clear();
      message.warning('登录已过期，请重新登录');
    });
    return () => setSessionExpiredHandler(null);
  }, [queryClient, message]);

  // 滑动续签（#24）：活跃期间 token 临近过期即自动换新，活跃使用不被定长 TTL 踢。
  // refresh 失败（token 已失效）会经 401 走上面的会话过期流程。
  useEffect(() => {
    if (!authed) return;
    const tick = () => {
      const left = tokenExpiresInMs();
      if (left !== null && left < REFRESH_WHEN_MS_LEFT) void refreshToken();
    };
    const id = window.setInterval(tick, REFRESH_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [authed]);

  const login = useCallback(async (username: string, password: string) => {
    // 登录被拒（凭据错误）不应触发上面的全局会话过期跳转，故显式 notifySessionExpired:false。
    const r = await apiPost<LoginResponse>(
      '/api/auth/login',
      { username, password },
      { notifySessionExpired: false },
    );
    setToken(r.token);
    setAuthed(true);
  }, []);

  const logout = useCallback(() => {
    void logoutServer(); // #26：通知服务端拉黑当前 jti，令牌立即失效（不再等自然过期）
    setToken(null);
    setAuthed(false);
    queryClient.clear();
  }, [queryClient]);

  return <AuthCtx.Provider value={{ authed, login, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
