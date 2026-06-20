import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { apiPost, getToken, setToken } from '../api/client';
import type { LoginResponse } from '../types/api';

interface AuthState {
  authed: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);

  const login = useCallback(async (username: string, password: string) => {
    const r = await apiPost<LoginResponse>('/api/auth/login', { username, password });
    setToken(r.token);
    setAuthed(true);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setAuthed(false);
  }, []);

  return <AuthCtx.Provider value={{ authed, login, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
