/**
 * 알림 유틸리티
 * - 권한 요청 + Expo Push Token 저장
 * - 약 복용 예정 알림 (서버 cron 전담)
 * - 약효 추적 알림 (복용 후 n분)
 * - 운동 알림 (매일 반복)
 *
 * 미복용 체크 로컬 알림은 서버 cron(send-medication-reminders)과 중복되어 제거됨.
 */
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import type { MedNotif, ExerciseNotif } from '../context/SettingsContext';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const MISSED_MED_REMIND_IDS_KEY = 'missedMedRemindNotifIds';

/**
 * 특정 식사시간 미복용 재알림 취소 (복용 완료 시 호출).
 * 과거 버전에서 등록된 잔여 로컬 알림을 정리하는 용도로만 보존.
 */
export async function cancelMissedMedRemindNotif(mealTime: string): Promise<void> {
  const identifier = `missed-med-remind-${mealTime}`;
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
    const savedRaw = await AsyncStorage.getItem(MISSED_MED_REMIND_IDS_KEY).catch(() => null);
    if (savedRaw) {
      const savedIds: string[] = JSON.parse(savedRaw);
      const filtered = savedIds.filter(id => id !== identifier);
      await AsyncStorage.setItem(MISSED_MED_REMIND_IDS_KEY, JSON.stringify(filtered));
    }
  } catch {}
}

// 포그라운드 알림 표시 설정
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const MEAL_TIMES: Record<string, { hour: number; minute: number; label: string }> = {
  morning: { hour: 8, minute: 0, label: '아침' },
  lunch: { hour: 12, minute: 0, label: '점심' },
  dinner: { hour: 18, minute: 0, label: '저녁' },
  bedtime: { hour: 22, minute: 0, label: '취침' },
};

function minutesToLabel(m: number): string {
  if (m === 0) return '복용 직후';
  if (m < 60) return `${m}분 후`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`;
}

/**
 * 권한 요청 + Android 알림 채널 설정 + Expo Push Token 획득 → users 테이블 저장
 *
 * - 권한이 이미 거부된 경우 시스템 설정으로 안내하는 Alert 표시
 * - Android 알림 채널을 MAX 중요도로 생성 (시스템 알림 설정에 채널이 보여야 함)
 * - supabase-js PostgREST 대신 직접 fetch 사용 (새 아키텍처 hang 버그 우회)
 * - accessToken 미전달 시 supabase.auth.getSession()으로 폴백
 */
export async function requestPermissionsAndSaveToken(
  userId: string,
  accessToken?: string,
): Promise<string | null> {
  // 1. 현재 권한 상태 확인
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // undetermined인 경우에만 시스템 다이얼로그 요청
  if (existingStatus === 'undetermined') {
    console.log('[notifications] 권한 미설정 → 권한 요청 다이얼로그 표시');
    const { status: requestedStatus } = await Notifications.requestPermissionsAsync();
    finalStatus = requestedStatus;
  }

  if (finalStatus !== 'granted') {
    console.warn('[notifications] 알림 권한 없음 (상태:', finalStatus, ') — push token 저장 스킵');
    return null;
  }

  console.log('[notifications] 알림 권한 있음 → push token 저장 진행');

  // 2. Android 알림 채널 생성 (MAX 중요도 — 시스템 알림 설정에 채널이 표시되어야 차단 해제 가능)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '파킨온 알림',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAF50',
      sound: 'default',
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
    });
    // 약 복용 알림 전용 채널
    await Notifications.setNotificationChannelAsync('medication', {
      name: '약 복용 알림',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAF50',
      sound: 'default',
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
    });
  }

  // 3. Expo Push Token 획득
  try {
    console.log('[notifications] Expo Push Token 획득 시작...');
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    console.log('[notifications] projectId:', projectId);

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenData.data;
    console.log('[notifications] Expo Push Token 획득 성공:', token.substring(0, 30) + '...');

    // 4. users 테이블에 push_token 저장
    //    supabase-js PostgREST 대신 직접 fetch 사용 (새 아키텍처 hang 버그 우회)
    let token_ = accessToken;
    if (!token_) {
      console.log('[notifications] accessToken 미전달 → getSession()으로 폴백');
      const { data: { session } } = await supabase.auth.getSession();
      token_ = session?.access_token;
    }

    if (!token_) {
      console.error('[notifications] ❌ accessToken 없음 — push_token DB 저장 불가');
      return null;
    }

    console.log('[notifications] DB 저장 시작 → userId:', userId);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token_}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ push_token: token }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('[notifications] ❌ push_token PATCH 실패:', res.status, txt);
      console.error('[notifications] userId:', userId);
      console.error('[notifications] SUPABASE_URL:', SUPABASE_URL);
      return null;
    }

    console.log('[notifications] ✅ push_token DB 저장 성공');
    return token;
  } catch (e) {
    console.error('[notifications] ❌ push token 획득/저장 실패:', e);
    if (e instanceof Error) {
      console.error('[notifications] 에러 상세:', e.message);
      console.error('[notifications] 스택:', e.stack);
    }
    return null;
  }
}

/**
 * 약 복용 예정 알림 — 서버 크론(send-medication-reminders)이 전담.
 * 로컬 알림 등록 제거 (서버 크론과 중복 발송 방지).
 * 기존에 등록된 로컬 약 복용 알림이 있으면 취소만 수행.
 */
export async function scheduleMedicationReminders(): Promise<void> {
  // 기존에 등록된 로컬 약 복용 알림 취소 (하위 호환)
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith('med-reminder-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
  // 새 로컬 알림 등록하지 않음 — 서버 크론이 전담
}

/** 특정 시간대 복용 예정 알림 취소 (복용 완료 시 호출) */
export async function cancelMedicationReminder(mealTime: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(`med-reminder-${mealTime}`);
  } catch {}
}

/** 약효 추적 알림 — 복용 직후 로컬로 스케줄 (push_token 없을 때 fallback) */
export async function scheduleEffectTrackingNotifications(medNotifs: MedNotif[]): Promise<void> {
  for (const n of medNotifs) {
    if (!n.enabled || n.minutes === 0) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '😊 몸 상태는 어때요?',
        body: `약 복용 ${minutesToLabel(n.minutes)} 몸 상태를 기록해보세요.`,
        data: { type: 'effect_tracking', minutes: n.minutes },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: n.minutes * 60,
      },
    });
  }
}

const EXERCISE_NOTIF_IDS_KEY = 'exerciseNotifIds';

/** 운동 알림 스케줄 (매일 반복) — 운동 알림만 선택적으로 취소하여 약효추적 알림 보존 */
export async function scheduleExerciseReminders(exerciseNotifs: ExerciseNotif[]): Promise<void> {
  // 이전에 등록된 운동 알림 ID 목록 조회 후 해당 ID들만 취소
  try {
    const savedIds = await AsyncStorage.getItem(EXERCISE_NOTIF_IDS_KEY);
    if (savedIds) {
      const ids: string[] = JSON.parse(savedIds);
      for (const id of ids) {
        try {
          await Notifications.cancelScheduledNotificationAsync(id);
        } catch {}
      }
    }
  } catch {}

  const newIds: string[] = [];

  for (const notif of exerciseNotifs) {
    if (!notif.enabled) continue;

    let hour = notif.hour;
    if (notif.ampm === '오후' && hour !== 12) hour += 12;
    if (notif.ampm === '오전' && hour === 12) hour = 0;

    const identifier = `exercise-${notif.id}`;
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: '🏃 운동할 시간이에요!',
        body: '오늘 운동 기록을 남겨보세요.',
        data: { type: 'exercise_reminder' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute: notif.minute,
      },
    });
    newIds.push(identifier);
  }

  // 새로 등록한 운동 알림 ID 목록 저장
  await AsyncStorage.setItem(EXERCISE_NOTIF_IDS_KEY, JSON.stringify(newIds));
}

/**
 * 약/운동 알림 전체 재스케줄 (설정 변경 시)
 * notificationEnabled가 false이면 모든 예약 알림을 취소하고 종료.
 */
export async function rescheduleAllNotifications(
  medNotifs: MedNotif[],
  exerciseNotifs: ExerciseNotif[],
  notificationEnabled: boolean = true,
): Promise<void> {
  if (!notificationEnabled) {
    // 전체 알림 OFF — 모든 예약 알림 취소
    await Notifications.cancelAllScheduledNotificationsAsync();
    return;
  }
  // 서버 크론이 전담 — 이전에 등록된 exercise 로컬 알림 잔여분 취소
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith('exercise-')) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch {}
}

/** 보호자에게 푸시 알림 전송 (Supabase Edge Function 경유) */
export async function sendCaregiverPush(
  caregiverPushToken: string,
  title: string,
  body: string,
  data?: Record<string, any>,
): Promise<void> {
  try {
    await supabase.functions.invoke('send-push', {
      body: { to: caregiverPushToken, title, body, data: data ?? {} },
    });
  } catch (e) {
    console.error('[notifications] 보호자 푸시 전송 실패:', e);
  }
}
