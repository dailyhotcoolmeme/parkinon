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
      try {
        // 콜드스타트 등으로 컨텍스트 user 가 아직 로딩되지 않았을 때도 읽음 처리가 되도록
        // 세션에서 userId 를 직접 해석한다. (알림 탭했는데 user 미로딩으로 읽음처리가
        // 건너뛰어져 배지가 안 꺼지던 문제 방지)
        let userId = user?.id ?? null;
        if (!userId) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            userId = session?.user?.id ?? null;
          } catch {}
        }
        if (!userId) return;
        const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
        const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

        // push payload type → DB에 저장된 type 매핑
        // 서버는 DB에 'missed_medication'으로 저장하지만 push payload에는
        // 'missed_medication_first' / 'missed_medication_second'를 사용함
        const PAYLOAD_TO_DB_TYPE: Record<string, string> = {
          missed_medication_first: 'missed_medication',
          missed_medication_second: 'missed_medication',
        };
        const dbType = PAYLOAD_TO_DB_TYPE[type] ?? type;

        if (readAt) {
          // 탭한 경우 — 24시간 내 미읽음 동일 알림 찾아 읽음 처리
          const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: unread } = await supabase
            .from('notification_logs')
            .select('id, read_at')
            .eq('user_id', userId)
            .eq('type', dbType)
            .eq('title', title)
            .gte('created_at', since24h)
            .is('read_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (unread) {
            const { data: { session } } = await supabase.auth.getSession();
            await fetch(
              `${SUPA_URL}/rest/v1/notification_logs?id=eq.${unread.id}`,
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
            return;
          }
          // 서버 미기록 알림 탭 — 5분 내 동일 알림 있으면 중복 삽입 방지
          const since5m = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: recentAny } = await supabase
            .from('notification_logs')
            .select('id')
            .eq('user_id', userId)
            .eq('type', dbType)
            .eq('title', title)
            .gte('created_at', since5m)
            .limit(1)
            .maybeSingle();
          if (recentAny) return;

          // 읽음 상태로 새 record 삽입 (뱃지 증가 없음)
          const { data: { session } } = await supabase.auth.getSession();
          await fetch(`${SUPA_URL}/rest/v1/notification_logs`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPA_KEY,
              'Authorization': `Bearer ${session?.access_token ?? ''}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ user_id: userId, type: dbType, title, body, data, read_at: readAt }),
          });
          return;
        }

        // 포그라운드 수신 — 60초 내 중복 체크 후 미읽음 insert
        const since = new Date(Date.now() - 60 * 1000).toISOString();
        const { data: existing } = await supabase
          .from('notification_logs')
          .select('id')
          .eq('user_id', userId)
          .eq('type', dbType)
          .eq('title', title)
          .gte('created_at', since)
          .limit(1)
          .maybeSingle();

        if (existing) {
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
                user_id: userId,
                type: dbType,
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
