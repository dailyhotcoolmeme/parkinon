/**
 * 알림 유틸리티
 * - 권한 요청 + Expo Push Token 저장
 * - 약 복용 예정 알림 (매일 반복)
 * - 약효 추적 알림 (복용 후 n분)
 * - 운동 알림 (매일 반복)
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import type { MedNotif, ExerciseNotif } from '../context/SettingsContext';

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

/** 권한 요청 + Expo Push Token 획득 → users 테이블 저장 */
export async function requestPermissionsAndSaveToken(userId: string): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;

  if (existing !== 'granted') {
    const { status: requested } = await Notifications.requestPermissionsAsync();
    status = requested;
  }

  if (status !== 'granted') return null;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenData.data;

    await supabase.from('users').update({ push_token: token }).eq('id', userId);

    return token;
  } catch (e) {
    console.error('[notifications] push token 획득 실패:', e);
    return null;
  }
}

/** 약 복용 예정 알림 스케줄 (매일 반복) */
export async function scheduleMedicationReminders(): Promise<void> {
  for (const [mealTime, time] of Object.entries(MEAL_TIMES)) {
    try {
      await Notifications.cancelScheduledNotificationAsync(`med-reminder-${mealTime}`);
    } catch {}

    await Notifications.scheduleNotificationAsync({
      identifier: `med-reminder-${mealTime}`,
      content: {
        title: '💊 약 드실 시간이에요',
        body: `${time.label} 약을 드실 시간이에요.`,
        data: { type: 'medication_reminder', mealTime },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: time.hour,
        minute: time.minute,
      },
    });
  }
}

/** 특정 시간대 복용 예정 알림 취소 (복용 완료 시 호출) */
export async function cancelMedicationReminder(mealTime: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(`med-reminder-${mealTime}`);
  } catch {}
}

/** 약효 추적 알림 스케줄 (복용 직후 호출) */
export async function scheduleEffectTrackingNotifications(medNotifs: MedNotif[]): Promise<void> {
  try {
    // 기존 약효 추적 알림 모두 취소
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith('effect-')) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }

    for (const notif of medNotifs) {
      if (!notif.enabled) continue;

      const seconds = notif.minutes === 0 ? 3 : notif.minutes * 60;

      await Notifications.scheduleNotificationAsync({
        identifier: `effect-${notif.id}`,
        content: {
          title: '😊 몸 상태는 어때요?',
          body: `${minutesToLabel(notif.minutes)} 몸 상태를 기록해보세요.`,
          data: { type: 'effect_tracking', minutes: notif.minutes },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds,
          repeats: false,
        },
      });
    }
  } catch (e) {
    console.error('[notifications] 약효 추적 알림 스케줄 실패:', e);
  }
}

/** 운동 알림 스케줄 (매일 반복) */
export async function scheduleExerciseReminders(exerciseNotifs: ExerciseNotif[]): Promise<void> {
  // 기존 운동 알림 모두 취소
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith('exercise-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  for (const notif of exerciseNotifs) {
    if (!notif.enabled) continue;

    let hour = notif.hour;
    if (notif.ampm === '오후' && hour !== 12) hour += 12;
    if (notif.ampm === '오전' && hour === 12) hour = 0;

    await Notifications.scheduleNotificationAsync({
      identifier: `exercise-${notif.id}`,
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
  }
}

/** 약/운동 알림 전체 재스케줄 (설정 변경 시) */
export async function rescheduleAllNotifications(
  medNotifs: MedNotif[],
  exerciseNotifs: ExerciseNotif[],
): Promise<void> {
  await scheduleMedicationReminders();
  await scheduleExerciseReminders(exerciseNotifs);
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
