import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
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
  // 진짜 값을 한 번이라도 확정했는지(로그인 사용자 확인 + DB 조회 완료, 또는 비로그인 확정).
  //   ⚠️ 이게 없으면 마운트 시 초기값 0이 그대로 OS 배지에 찍혀버린다 — refreshBadge()의
  //   DB 조회가 끝나기 전에 사용자가 앱을 배경으로 보내면, 실제 안읽음이 남아있어도
  //   배지가 0으로 굳어버린다(오너 제보 2026-08-01: "앱 열고 닫으니 숫자가 사라진다").
  const settledRef = useRef(false);

  // 홈 화면 앱 아이콘의 숫자 배지.
  //   톱바 종 아이콘 숫자는 DB 에서 직접 세어 표시하지만, 앱 아이콘 배지는 OS 에 따로
  //   알려줘야 한다. 알려주는 코드가 아예 없어 아이콘에는 늘 아무것도 안 떴다(오너 제보).
  //   setUnreadCount 가 여러 곳에 흩어져 있어 각 자리에 붙이면 빠뜨리게 되므로,
  //   값이 바뀌는 순간을 한 곳에서 받아 반영한다.
  useEffect(() => {
    if (!settledRef.current) return; // 아직 실제 값을 모름 — OS 배지를 함부로 0으로 덮어쓰지 않는다
    Notifications.setBadgeCountAsync(unreadCount).catch(() => {});
  }, [unreadCount]);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const refreshBadge = useCallback(async () => {
    if (!user?.id) {
      settledRef.current = true;
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
        settledRef.current = true;
        setUnreadCount(count);
      }
    } catch (e) {
      // 조용히 실패 — settledRef 를 세우지 않아 다음 refreshBadge 때 다시 시도한다.
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

  // ⚠️ 콜드 스타트 직후엔 Supabase 세션이 아직 안 붙어있어 위 최초 조회가 조용히
  //   실패할 수 있다(오너 제보 2026-08-02: 서버 0건인데 배지는 그대로 남음). 재시도가
  //   없으면 다음 배경→포그라운드 전환 전까지 영영 못 고친다. settled 될 때까지
  //   짧은 간격으로 최대 5번 다시 시도한다.
  useEffect(() => {
    if (!user?.id) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (settledRef.current || attempts > 5) {
        clearInterval(timer);
        return;
      }
      refreshBadge();
    }, 2000);
    return () => clearInterval(timer);
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
    // ⚠️ user 미로딩 시 조용히 return하면 호출부(handleMarkAllRead)가 "성공"으로 오인해
    //   로컬 상태만 전부 읽음 처리하고 서버는 그대로 안 읽음으로 남는다 — 화면(전체 읽음)과
    //   OS 아이콘 배지(서버 기준)가 서로 어긋나는 버그의 원인이었다(오너 제보 2026-08-01).
    if (!user?.id) throw new Error('markAllRead: user not loaded');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
      const res = await fetch(
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
      // ⚠️ 예전엔 응답을 확인하지 않고 실패도 조용히 삼켰다. 그래서 서버가 거부해도
      //   "눌러도 아무 반응 없음"으로만 보이고 원인을 알 방법이 없었다(오너 제보).
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`markAllRead ${res.status}: ${body.slice(0, 200)}`);
      }
      setUnreadCount(0);
    } catch (e) {
      console.error('[알림] 모두 읽음 처리 실패:', e);
      throw e; // 화면이 실패를 알 수 있게 올린다(예전엔 여기서 삼켜 무반응처럼 보였다).
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
