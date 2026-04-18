import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const [loaded, setLoaded] = useState(false);

  // AsyncStorage에서 알림 시간 설정 로드 + DB에서 notification_enabled 로드
  useEffect(() => {
    (async () => {
      try {
        const [medRaw, exRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_MED),
          AsyncStorage.getItem(STORAGE_KEY_EXERCISE),
        ]);
        if (medRaw) setMedNotifsState(JSON.parse(medRaw));
        if (exRaw) setExerciseNotifsState(JSON.parse(exRaw));

        // DB에서 notification_enabled 로드
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: userRow } = await supabase
            .from('users')
            .select('notification_enabled')
            .eq('id', session.user.id)
            .single();
          if (userRow != null) {
            setNotificationEnabledState(userRow.notification_enabled ?? true);
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

  // notification_enabled → users 테이블 UPDATE
  const setNotificationEnabled = useCallback(async (enabled: boolean) => {
    setNotificationEnabledState(enabled);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { error } = await supabase
        .from('users')
        .update({ notification_enabled: enabled })
        .eq('id', session.user.id);
      if (error) console.error('[SettingsContext] notification_enabled 저장 오류:', error.message);
    } catch (e) {
      console.error('[SettingsContext] setNotificationEnabled 오류:', e);
    }
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
