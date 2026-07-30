import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus } from 'react-native';
import { rescheduleAllNotifications } from '../utils/notifications';
import { supabase } from '../lib/supabase';

/**
 * 오전/오후 저장값. **표시 문자열이 아니라 식별자다** — 화면에는 t('common.am'/'common.pm') 로 그린다.
 * 예전에는 '오전'/'오후' 를 그대로 저장했다(2026-07-30 오너 확정으로 영어 키로 교체).
 * 옛 행 호환은 normalizeAmPm 이 담당한다.
 */
export type AmPm = 'am' | 'pm';

/**
 * DB 에 남아 있는 옛 저장값도 받아준다.
 * 예전에는 표시 문자열을 그대로 저장했다 — 그 값들과 비교해야 하므로 여기서만 남긴다.
 * (2026-07-30 마이그레이션으로 운영 DB 는 전부 am/pm 이지만, 미업데이트 앱이 다시 쓸 수 있다.)
 */
const LEGACY_PM = '\uC624\uD6C4'; // '오후'
export function normalizeAmPm(v: unknown): AmPm {
  return v === 'pm' || v === LEGACY_PM ? 'pm' : 'am';
}

export interface MedNotif {
  id: string;
  minutes: number;
  enabled: boolean;
  /** 이 알림에 쓸 녹음 목소리(custom_sounds.id). 없으면 기본 목소리(단일 설정)로 폴백 */
  soundId?: string | null;
}

export interface ExerciseNotif {
  id: string;
  ampm: AmPm;
  hour: number;
  minute: number;
  enabled: boolean;
  /** 이 알림에 쓸 녹음 목소리(custom_sounds.id). 없으면 기본 목소리(단일 설정)로 폴백 */
  soundId?: string | null;
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
  /**
   * 실시간 동기화 전용 — 원격(다른 기기/보호자)에서 바뀐 값을 로컬 state에만 반영.
   * DB에 다시 쓰지 않아 에코 루프를 막는다.
   */
  applyRemoteNotifPrefs: (row: {
    med_notif_prefs?: MedNotif[] | null;
    exercise_notif_prefs?: ExerciseNotif[] | null;
    notification_enabled?: boolean | null;
  }) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STORAGE_KEY_MED = 'settings_med_notifs';
const STORAGE_KEY_EXERCISE = 'settings_exercise_notifs';

export const DEFAULT_MED_NOTIFS: MedNotif[] = [
  { id: '2', minutes: 30, enabled: true },
  { id: '3', minutes: 120, enabled: true },
];

const DEFAULT_EXERCISE_NOTIFS: ExerciseNotif[] = [
  { id: '1', ampm: 'pm', hour: 2, minute: 0, enabled: false },
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
        // denied → OS가 알림을 막으므로 앱도 강제 OFF + DB 저장 (하드 제약)
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
          console.warn('[SettingsContext] error syncing blocked system permission to DB:', e);
        }
      }
      // granted / undetermined → 시스템 권한 상태(systemPermissionGranted)만 갱신하고
      // 앱의 전체 알림 토글(notificationEnabled)은 사용자가 저장한 DB 값을 그대로 따른다.
      // ⚠️ 예전엔 granted면 무조건 true로 덮어써, 사용자가 끈 전체 알림 OFF가
      //    앱 재시작/포그라운드마다 ON으로 되살아나는 버그가 있었음 → 강제 ON 제거.
    } catch (e) {
      console.warn('[SettingsContext] system permission check error:', e);
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
              setMedNotifsState((userRow.med_notif_prefs as unknown as MedNotif[]).filter((n) => n.minutes !== 0));
            }
            if (userRow.exercise_notif_prefs) {
              setExerciseNotifsState(userRow.exercise_notif_prefs as unknown as ExerciseNotif[]);
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
        console.warn('[SettingsContext] settings load error:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // medNotifs 변경 시 AsyncStorage + DB 저장
  // ⚠️ supabase-js .update()는 New Architecture에서 hang됨 → fetch API 직접 사용
  const setMedNotifs: React.Dispatch<React.SetStateAction<MedNotif[]>> = useCallback(
    (value) => {
      setMedNotifsState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        AsyncStorage.setItem(STORAGE_KEY_MED, JSON.stringify(next)).catch(console.warn);
        // DB 저장 (fetch API 직접 사용 — New Architecture hang 우회)
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
            body: JSON.stringify({ med_notif_prefs: next }),
          }).catch(console.warn);
        }).catch(console.warn);
        return next;
      });
    },
    []
  );

  // exerciseNotifs 변경 시 AsyncStorage + DB 저장
  // ⚠️ supabase-js .update()는 New Architecture에서 hang됨 → fetch API 직접 사용
  const setExerciseNotifs: React.Dispatch<React.SetStateAction<ExerciseNotif[]>> = useCallback(
    (value) => {
      setExerciseNotifsState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        AsyncStorage.setItem(STORAGE_KEY_EXERCISE, JSON.stringify(next)).catch(console.warn);
        // DB 저장 (fetch API 직접 사용 — New Architecture hang 우회)
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
            body: JSON.stringify({ exercise_notif_prefs: next }),
          }).catch(console.warn);
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
        console.error('[SettingsContext] notification_enabled save error:', res.status, txt);
      }
    } catch (e) {
      console.error('[SettingsContext] _persistNotificationEnabled error:', e);
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
      // 전체 알림 OFF: 예약 알림 전부 취소
      try {
        await Notifications.cancelAllScheduledNotificationsAsync();
      } catch (e) {
        console.warn('[SettingsContext] notification cancel error:', e);
      }
    }

    // 전체 토글 → 개별(약효 추적/운동) 알림 일괄 반영 + AsyncStorage + DB 저장
    // (영속 setter 사용 — 이전엔 state/AsyncStorage만 바꿔 재시작 시 DB값으로 되돌아갔음)
    setMedNotifs(prev => prev.map(n => ({ ...n, enabled })));
    setExerciseNotifs(prev => prev.map(n => ({ ...n, enabled })));

    await _persistNotificationEnabled(enabled);
  }, [_persistNotificationEnabled, setMedNotifs, setExerciseNotifs]);

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
        console.warn('[SettingsContext] notification cancel error:', e);
      }
    }
    await _persistNotificationEnabled(enabled);
  }, [_persistNotificationEnabled]);

  // 실시간 동기화 전용: 원격에서 바뀐 값을 로컬 state + AsyncStorage에만 반영 (DB 재쓰기 X)
  const applyRemoteNotifPrefs = useCallback((row: {
    med_notif_prefs?: MedNotif[] | null;
    exercise_notif_prefs?: ExerciseNotif[] | null;
    notification_enabled?: boolean | null;
  }) => {
    if (row.med_notif_prefs) {
      const med = (row.med_notif_prefs as MedNotif[]).filter(n => n.minutes !== 0);
      setMedNotifsState(med);
      AsyncStorage.setItem(STORAGE_KEY_MED, JSON.stringify(med)).catch(() => {});
    }
    if (row.exercise_notif_prefs) {
      const ex = row.exercise_notif_prefs as ExerciseNotif[];
      setExerciseNotifsState(ex);
      AsyncStorage.setItem(STORAGE_KEY_EXERCISE, JSON.stringify(ex)).catch(() => {});
    }
    if (typeof row.notification_enabled === 'boolean') {
      setNotificationEnabledState(row.notification_enabled);
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
      applyRemoteNotifPrefs,
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
