import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, getToken, setToken, setSessionExpiredHandler } from '../api/client';
import type { LoginResponse } from '../types/api';

interface AuthState {
  authed: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);

  // 会话过期兜底：任何请求收到 401（token 失效）时，当场关掉登录态 → 路由守卫立即弹回登录页，
  // 并清掉残留缓存数据，避免再次登录时闪一帧旧数据。不再等用户手动刷新整页才被动跳转。
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAuthed(false);
      queryClient.clear();
    });
    return () => setSessionExpiredHandler(null);
  }, [queryClient]);

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
