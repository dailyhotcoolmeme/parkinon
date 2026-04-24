import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface NotificationBadgeContextValue {
  unreadCount: number;
  refreshBadge: () => Promise<void>;
  saveNotification: (
    type: string,
    title: string,
    body: string,
    data?: Record<string, any>,
    readAt?: string | null,
  ) => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

const NotificationBadgeContext = createContext<NotificationBadgeContextValue | null>(null);

export function NotificationBadgeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const refreshBadge = useCallback(async () => {
    if (!user?.id) {
      setUnreadCount(0);
      return;
    }
    try {
      const { count, error } = await supabase
        .from('notification_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null);
      if (!error && count !== null) {
        setUnreadCount(count);
      }
    } catch (e) {
      // 조용히 실패
    }
  }, [user?.id]);

  // 로그인 사용자가 있을 때 초기 뱃지 조회
  useEffect(() => {
    if (user?.id) {
      refreshBadge();
    } else {
      setUnreadCount(0);
    }
  }, [user?.id, refreshBadge]);

  // AppState 리스너: background → active 전환 시 뱃지 갱신
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        refreshBadge();
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [refreshBadge]);

  const saveNotification = useCallback(
    async (
      type: string,
      title: string,
      body: string,
      data: Record<string, any> = {},
      readAt: string | null = null,
    ) => {
      if (!user?.id) return;
      try {
        // 60초 내 동일 type+title 중복 체크 — OTA 리로드/포그라운드+탭 이중 저장 방지
        const since = new Date(Date.now() - 60 * 1000).toISOString();
        const { data: existing } = await supabase
          .from('notification_logs')
          .select('id, read_at')
          .eq('user_id', user.id)
          .eq('type', type)
          .eq('title', title)
          .gte('created_at', since)
          .limit(1)
          .maybeSingle();

        if (existing) {
          // 이미 저장된 알림 — 미읽 상태인데 탭(readAt 있음)이면 읽음 처리만
          if (readAt && !existing.read_at) {
            const { data: { session } } = await supabase.auth.getSession();
            const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
            const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
            await fetch(
              `${SUPA_URL}/rest/v1/notification_logs?id=eq.${existing.id}`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPA_KEY,
                  'Authorization': `Bearer ${session?.access_token ?? ''}`,
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({ read_at: readAt }),
              },
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
          return;
        }

        {
          const { data: { session } } = await supabase.auth.getSession();
          const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
          const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
          await fetch(
            `${SUPA_URL}/rest/v1/notification_logs`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPA_KEY,
                'Authorization': `Bearer ${session?.access_token ?? ''}`,
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({
                user_id: user.id,
                type,
                title,
                body,
                data,
                read_at: readAt,
              }),
            },
          );
        }
        if (!readAt) {
          setUnreadCount((prev) => prev + 1);
        }
      } catch (e) {
        // 조용히 실패
      }
    },
    [user?.id],
  );

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
      await fetch(
        `${SUPA_URL}/rest/v1/notification_logs?user_id=eq.${user.id}&read_at=is.null`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPA_KEY,
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ read_at: new Date().toISOString() }),
        },
      );
      setUnreadCount(0);
    } catch (e) {
      // 조용히 실패
    }
  }, [user?.id]);

  const markRead = useCallback(
    async (id: string) => {
      if (!user?.id) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
        const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
        const res = await fetch(
          `${SUPA_URL}/rest/v1/notification_logs?id=eq.${id}&user_id=eq.${user.id}&read_at=is.null`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPA_KEY,
              'Authorization': `Bearer ${session?.access_token ?? ''}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ read_at: new Date().toISOString() }),
          },
        );
        if (res.ok) {
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
      } catch (e) {
        // 조용히 실패
      }
    },
    [user?.id],
  );

  return (
    <NotificationBadgeContext.Provider
      value={{ unreadCount, refreshBadge, saveNotification, markAllRead, markRead }}
    >
      {children}
    </NotificationBadgeContext.Provider>
  );
}

export function useNotificationBadge(): NotificationBadgeContextValue {
  const ctx = useContext(NotificationBadgeContext);
  if (!ctx) {
    throw new Error('useNotificationBadge must be used inside <NotificationBadgeProvider>');
  }
  return ctx;
}
