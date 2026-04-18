/**
 * AuthContext.tsx
 * 앱 전체에서 인증 상태를 공유하는 Context.
 * useAuth()를 여러 컴포넌트에서 호출해도 모두 동일한 state를 참조함.
 */
import React, { createContext, useContext } from 'react';
import { useAuthProvider, UseAuthReturn } from '../hooks/useAuth';

const AuthContext = createContext<UseAuthReturn | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): UseAuthReturn {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
