import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { rescheduleAllNotifications } from '../utils/notifications';
import { supabase } from '../lib/supabase';

export interface MedNotif {
  id: string;
  minutes: number;
  enabled: boolean;
}

export interface ExerciseNotif {
  id: string;
  ampm: '오전' | '오후';
  hour: number;
  minute: number;
  enabled: boolean;
}

interface SettingsContextValue {
  medNotifs: MedNotif[];
  setMedNotifs: React.Dispatch<React.SetStateAction<MedNotif[]>>;
  exerciseNotifs: ExerciseNotif[];
  setExerciseNotifs: React.Dispatch<React.SetStateAction<ExerciseNotif[]>>;
  notificationEnabled: boolean;
  setNotificationEnabled: (enabled: boolean) => Promise<void>;
  /** 시스템 알림 권한이 실제로 허용되어 있는지 여부 */
  systemPermissionGranted: boolean;
  /** 시스템 권한 상태를 다시 확인하고 동기화 */
  recheckSystemPermission: () => Promise<void>;
  /** 개별 알림 전체 OFF 여부를 반영해 전체 알림 토글 자동 동기화 */
  syncGlobalFromIndividual: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STORAGE_KEY_MED = 'settings_med_notifs';
const STORAGE_KEY_EXERCISE = 'settings_exercise_notifs';

const DEFAULT_MED_NOTIFS: MedNotif[] = [
  { id: '1', minutes: 0, enabled: true },
  { id: '2', minutes: 30, enabled: true },
  { id: '3', minutes: 120, enabled: true },
];

const DEFAULT_EXERCISE_NOTIFS: ExerciseNotif[] = [
  { id: '1', ampm: '오후', hour: 2, minute: 0, enabled: true },
];

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [medNotifs, setMedNotifsState] = useState<MedNotif[]>(DEFAULT_MED_NOTIFS);
  const [exerciseNotifs, setExerciseNotifsState] = useState<ExerciseNotif[]>(DEFAULT_EXERCISE_NOTIFS);
  const [notificationEnabled, setNotificationEnabledState] = useState(true);
  const [systemPermissionGranted, setSystemPermissionGranted] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // 시스템 알림 권한 상태 확인 및 동기화
  const recheckSystemPermission = useCallback(async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const granted = status === 'granted';
      setSystemPermissionGranted(granted);
      // 시스템에서 차단된 경우 DB의 notification_enabled도 false로 동기화
      if (!granted) {
        setNotificationEnabledState(false);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
            const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
            await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${session.user.id}`, {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({ notification_enabled: false }),
            });
          }
        } catch (e) {
          console.warn('[SettingsContext] 시스템 권한 차단 DB 동기화 오류:', e);
        }
      }
    } catch (e) {
      console.warn('[SettingsContext] 시스템 권한 확인 오류:', e);
    }
  }, []);

  // AsyncStorage에서 알림 시간 설정 로드 + DB에서 notification_enabled 로드 + 시스템 권한 확인
  useEffect(() => {
    (async () => {
      try {
        const [medRaw, exRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_MED),
          AsyncStorage.getItem(STORAGE_KEY_EXERCISE),
        ]);
        if (medRaw) setMedNotifsState(JSON.parse(medRaw));
        if (exRaw) setExerciseNotifsState(JSON.parse(exRaw));

        // 시스템 알림 권한 상태 확인 (최우선)
        const { status: sysStatus } = await Notifications.getPermissionsAsync();
        const sysGranted = sysStatus === 'granted';
        setSystemPermissionGranted(sysGranted);

        // DB에서 notification_enabled 로드
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: userRow } = await supabase
            .from('users')
            .select('notification_enabled')
            .eq('id', session.user.id)
            .single();
          if (userRow != null) {
            // 시스템 권한이 차단된 경우 DB 값과 무관하게 false
            const enabled = sysGranted ? (userRow.notification_enabled ?? true) : false;
            setNotificationEnabledState(enabled);
            // 시스템 차단인데 DB에 true로 저장되어 있으면 false로 동기화
            if (!sysGranted && userRow.notification_enabled !== false) {
              const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
              const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
              fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${session.user.id}`, {
                method: 'PATCH',
                headers: {
                  'apikey': SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({ notification_enabled: false }),
              }).catch(console.warn);
            }
          }
        }
      } catch (e) {
        console.warn('[SettingsContext] 설정 로드 오류:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // medNotifs 변경 시 AsyncStorage 저장
  const setMedNotifs: React.Dispatch<React.SetStateAction<MedNotif[]>> = useCallback(
    (value) => {
      setMedNotifsState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        AsyncStorage.setItem(STORAGE_KEY_MED, JSON.stringify(next)).catch(console.warn);
        return next;
      });
    },
    []
  );

  // exerciseNotifs 변경 시 AsyncStorage 저장
  const setExerciseNotifs: React.Dispatch<React.SetStateAction<ExerciseNotif[]>> = useCallback(
    (value) => {
      setExerciseNotifsState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        AsyncStorage.setItem(STORAGE_KEY_EXERCISE, JSON.stringify(next)).catch(console.warn);
        return next;
      });
    },
    []
  );

  // notification_enabled → users 테이블 UPDATE (fetch API 사용 — 새 아키텍처 hang 우회)
  const setNotificationEnabled = useCallback(async (enabled: boolean) => {
    setNotificationEnabledState(enabled);

    // 전체 알림 OFF 시: 모든 개별 알림도 화면·AsyncStorage에서 끄기 + 예약 알림 전부 취소
    if (!enabled) {
      try {
        await Notifications.cancelAllScheduledNotificationsAsync();
      } catch (e) {
        console.warn('[SettingsContext] 알림 취소 오류:', e);
      }
      setMedNotifsState(prev => {
        const next = prev.map(n => ({ ...n, enabled: false }));
        AsyncStorage.setItem(STORAGE_KEY_MED, JSON.stringify(next)).catch(console.warn);
        return next;
      });
      setExerciseNotifsState(prev => {
        const next = prev.map(n => ({ ...n, enabled: false }));
        AsyncStorage.setItem(STORAGE_KEY_EXERCISE, JSON.stringify(next)).catch(console.warn);
        return next;
      });
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${session.user.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ notification_enabled: enabled }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error('[SettingsContext] notification_enabled 저장 오류:', res.status, txt);
      }
    } catch (e) {
      console.error('[SettingsContext] setNotificationEnabled 오류:', e);
    }
  }, []);

  // 개별 알림이 변경될 때마다: 전부 OFF면 전체 알림도 OFF, 하나라도 ON이면 전체 알림 ON
  const syncGlobalFromIndividual = useCallback(() => {
    setMedNotifsState(currentMed => {
      setExerciseNotifsState(currentEx => {
        const anyOn = currentMed.some(n => n.enabled) || currentEx.some(n => n.enabled);
        setNotificationEnabledState(prev => {
          if (prev === anyOn) return prev; // 변화 없으면 DB 호출 불필요
          // DB 업데이트 (비동기, fire-and-forget)
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session?.user) return;
            const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
            const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
            fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${session.user.id}`, {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({ notification_enabled: anyOn }),
            }).catch(console.warn);
          }).catch(console.warn);
          return anyOn;
        });
        return currentEx; // 상태값은 그대로 유지
      });
      return currentMed; // 상태값은 그대로 유지
    });
  }, []);

  // 설정 변경 시 알림 재스케줄 (초기 로드 완료 후에만)
  useEffect(() => {
    if (!loaded) return;
    rescheduleAllNotifications(medNotifs, exerciseNotifs).catch(console.error);
  }, [medNotifs, exerciseNotifs, loaded]);

  return (
    <SettingsContext.Provider value={{
      medNotifs,
      setMedNotifs,
      exerciseNotifs,
      setExerciseNotifs,
      notificationEnabled,
      setNotificationEnabled,
      systemPermissionGranted,
      recheckSystemPermission,
      syncGlobalFromIndividual,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
