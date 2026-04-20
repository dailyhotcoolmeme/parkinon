import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus } from 'react-native';
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
  /**
   * DB/시스템 상태 동기화 전용 — 개별 알림 state를 건드리지 않고
   * notificationEnabled 값만 업데이트 + DB 저장.
   * useFocusEffect에서 DB 재로드 시 사용.
   */
  setNotificationEnabledOnly: (enabled: boolean) => Promise<void>;
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
  // 초기값 false: 앱 시작 후 실제 시스템 권한 확인 전에 배너가 잘못 숨겨지지 않도록
  // (초기 useEffect에서 getPermissionsAsync() 호출 후 실제 값으로 업데이트됨)
  const [systemPermissionGranted, setSystemPermissionGranted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ─── 시스템 알림 권한 상태 확인 및 동기화 ────────────────────────────────────
  // ⚠️ 중요: undetermined = "아직 사용자에게 팝업을 보여주지 않은 상태"
  //   → denied와 반드시 구분해서 처리
  //   → undetermined: systemPermissionGranted = false (배너 표시), notificationEnabled는 건드리지 않음
  //   → denied:       systemPermissionGranted = false (배너 표시), notificationEnabled = false (앱 설정 동기화)
  //   → granted:      systemPermissionGranted = true,  notificationEnabled는 건드리지 않음
  const recheckSystemPermission = useCallback(async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const granted = status === 'granted';
      setSystemPermissionGranted(granted);

      if (status !== 'granted' && status !== 'undetermined') {
        // denied → 앱 강제 OFF + DB 저장 (기존 로직 유지)
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
      } else if (status === 'granted') {
        // granted로 복귀 → 앱 알림도 자동 ON + DB 저장
        setNotificationEnabledState(true);
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
              body: JSON.stringify({ notification_enabled: true }),
            });
          }
        } catch (e) {
          console.warn('[SettingsContext] 시스템 권한 허용 DB 동기화 오류:', e);
        }
      }
    } catch (e) {
      console.warn('[SettingsContext] 시스템 권한 확인 오류:', e);
    }
  }, []);

  // 앱이 백그라운드 → 포그라운드로 복귀할 때 시스템 권한 상태 자동 동기화
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        recheckSystemPermission().catch(console.warn);
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [recheckSystemPermission]);

  // AsyncStorage에서 알림 시간 설정 로드 + DB에서 notification_enabled 로드 + 시스템 권한 확인
  useEffect(() => {
    (async () => {
      try {
        const [medRaw, exRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_MED),
          AsyncStorage.getItem(STORAGE_KEY_EXERCISE),
        ]);
        if (medRaw) {
          const parsed: MedNotif[] = JSON.parse(medRaw);
          // 복용 직후(minutes=0) 항목 제거 — 서버 전환 후 불필요
          setMedNotifsState(parsed.filter((n) => n.minutes !== 0));
        }
        if (exRaw) setExerciseNotifsState(JSON.parse(exRaw));

        // 시스템 알림 권한 상태 확인 (최우선)
        const { status: sysStatus } = await Notifications.getPermissionsAsync();
        const sysGranted = sysStatus === 'granted';
        setSystemPermissionGranted(sysGranted);

        // DB에서 notification_enabled + med_notif_prefs + exercise_notif_prefs 로드
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: userRow } = await supabase
            .from('users')
            .select('notification_enabled, med_notif_prefs, exercise_notif_prefs')
            .eq('id', session.user.id)
            .single();
          if (userRow != null) {
            // med_notif_prefs가 DB에 있으면 AsyncStorage보다 DB 우선
            if (userRow.med_notif_prefs) {
              setMedNotifsState((userRow.med_notif_prefs as MedNotif[]).filter((n) => n.minutes !== 0));
            }
            if (userRow.exercise_notif_prefs) {
              setExerciseNotifsState(userRow.exercise_notif_prefs as ExerciseNotif[]);
            }
            // 'granted'가 아닌 경우 DB 값과 무관하게 false로 처리 (denied, blocked 등 모든 비허용 상태)
            // 단, 'undetermined'는 아직 결정 전이므로 DB 값 그대로 반영
            const notGranted = sysStatus !== 'granted' && sysStatus !== 'undetermined';
            const enabled = notGranted ? false : (userRow.notification_enabled ?? true);
            setNotificationEnabledState(enabled);
            // 시스템이 비허용(undetermined 제외)인데 DB에 true로 저장되어 있으면 false로 동기화
            if (notGranted && userRow.notification_enabled !== false) {
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

  // medNotifs 변경 시 AsyncStorage + DB 저장
  const setMedNotifs: React.Dispatch<React.SetStateAction<MedNotif[]>> = useCallback(
    (value) => {
      setMedNotifsState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        AsyncStorage.setItem(STORAGE_KEY_MED, JSON.stringify(next)).catch(console.warn);
        // DB 저장
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session?.user) return;
          supabase.from('users').update({ med_notif_prefs: next }).eq('id', session.user.id).catch(console.warn);
        }).catch(console.warn);
        return next;
      });
    },
    []
  );

  // exerciseNotifs 변경 시 AsyncStorage + DB 저장
  const setExerciseNotifs: React.Dispatch<React.SetStateAction<ExerciseNotif[]>> = useCallback(
    (value) => {
      setExerciseNotifsState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        AsyncStorage.setItem(STORAGE_KEY_EXERCISE, JSON.stringify(next)).catch(console.warn);
        // DB 저장
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session?.user) return;
          supabase.from('users').update({ exercise_notif_prefs: next }).eq('id', session.user.id).catch(console.warn);
        }).catch(console.warn);
        return next;
      });
    },
    []
  );

  // notification_enabled DB 저장 공통 헬퍼
  const _persistNotificationEnabled = useCallback(async (enabled: boolean) => {
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
      console.error('[SettingsContext] _persistNotificationEnabled 오류:', e);
    }
  }, []);

  /**
   * 전체 알림 토글 (사용자 액션용):
   * - OFF → 개별 알림 모두 enabled: false + AsyncStorage 저장 + 예약 알림 전부 취소 + DB 저장
   * - ON  → 개별 알림 모두 enabled: true + AsyncStorage 저장 + DB 저장
   */
  const setNotificationEnabled = useCallback(async (enabled: boolean) => {
    setNotificationEnabledState(enabled);

    if (!enabled) {
      // 전체 알림 OFF: 예약 알림 전부 취소 + 개별 알림 state 모두 false
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
    } else {
      // 전체 알림 ON: 개별 알림 state 모두 true
      setMedNotifsState(prev => {
        const next = prev.map(n => ({ ...n, enabled: true }));
        AsyncStorage.setItem(STORAGE_KEY_MED, JSON.stringify(next)).catch(console.warn);
        return next;
      });
      setExerciseNotifsState(prev => {
        const next = prev.map(n => ({ ...n, enabled: true }));
        AsyncStorage.setItem(STORAGE_KEY_EXERCISE, JSON.stringify(next)).catch(console.warn);
        return next;
      });
    }

    await _persistNotificationEnabled(enabled);
  }, [_persistNotificationEnabled]);

  /**
   * DB/시스템 상태 동기화 전용 — 개별 알림 state를 건드리지 않고
   * notificationEnabled 값만 업데이트 + DB 저장.
   * useFocusEffect에서 DB 재로드 시 사용 (개별 항목 state 보존).
   */
  const setNotificationEnabledOnly = useCallback(async (enabled: boolean) => {
    setNotificationEnabledState(enabled);
    // 전체 OFF 시 예약 알림만 취소 (개별 state는 건드리지 않음)
    if (!enabled) {
      try {
        await Notifications.cancelAllScheduledNotificationsAsync();
      } catch (e) {
        console.warn('[SettingsContext] 알림 취소 오류:', e);
      }
    }
    await _persistNotificationEnabled(enabled);
  }, [_persistNotificationEnabled]);

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
  // notificationEnabled가 false이면 재스케줄 함수 내부에서 모든 알림 취소
  useEffect(() => {
    if (!loaded) return;
    rescheduleAllNotifications(medNotifs, exerciseNotifs, notificationEnabled).catch(console.error);
  }, [medNotifs, exerciseNotifs, notificationEnabled, loaded]);

  return (
    <SettingsContext.Provider value={{
      medNotifs,
      setMedNotifs,
      exerciseNotifs,
      setExerciseNotifs,
      notificationEnabled,
      setNotificationEnabled,
      setNotificationEnabledOnly,
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
