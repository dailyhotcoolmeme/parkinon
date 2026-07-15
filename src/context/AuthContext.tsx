/**
 * AuthContext.tsx
 * 앱 전체에서 인증 상태를 공유하는 Context.
 * useAuth()를 여러 컴포넌트에서 호출해도 모두 동일한 state를 참조함.
 */
import React, { createContext, useContext, useEffect } from 'react';
import { useAuthProvider, UseAuthReturn } from '../hooks/useAuth';
import { setActivityUser, clearActivityUser } from '../utils/activityLog';

const AuthContext = createContext<UseAuthReturn | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider();
  // 로그인/로그아웃/프로필 변화 시 행동 로거의 주체를 동기화.
  useEffect(() => {
    const u = auth.user;
    if (u?.id) {
      setActivityUser({
        userId: u.id,
        patientGroupId: (u as any).patient_group_id ?? null,
        role: (u as any).role ?? null,
      });
    } else {
      clearActivityUser();
    }
  }, [auth.user?.id, (auth.user as any)?.patient_group_id, (auth.user as any)?.role]);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): UseAuthReturn {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
