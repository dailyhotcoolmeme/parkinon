/**
 * 알림 유틸리티
 * - 권한 요청 + Expo Push Token 저장
 * - 약 복용 예정 알림 (매일 반복)
 * - 약효 추적 알림 (복용 후 n분)
 * - 운동 알림 (매일 반복)
 * - 미복용 체크 백그라운드 태스크
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import type { MedNotif, ExerciseNotif } from '../context/SettingsContext';

// ─── 미복용 체크 백그라운드 태스크 ─────────────────────────────────────────

const MISSED_MED_CHECK_TASK = 'PARKINON_CHECK_MISSED_MEDS';

const MEAL_TIME_LABELS_BG: Record<string, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
};

// 식사 시간 + 20분 후부터 40분 내 체크 (분, 자정 기준)
const MEAL_CHECK_WINDOWS: Record<string, { from: number; to: number }> = {
  morning: { from: 8 * 60 + 20, to: 9 * 60 },
  lunch:   { from: 12 * 60 + 20, to: 13 * 60 },
  dinner:  { from: 18 * 60 + 20, to: 19 * 60 },
  bedtime: { from: 22 * 60 + 20, to: 23 * 60 },
};

// 모듈 로드 시 태스크 정의 (TaskManager 요구사항)
TaskManager.defineTask(MISSED_MED_CHECK_TASK, async () => {
  try {
    const now = new Date();
    const minutesFromMidnight = now.getHours() * 60 + now.getMinutes();

    // 현재 시간이 어느 체크 윈도우에 있는지 확인
    let targetMealTime: string | null = null;
    for (const [mealTime, win] of Object.entries(MEAL_CHECK_WINDOWS)) {
      if (minutesFromMidnight >= win.from && minutesFromMidnight <= win.to) {
        targetMealTime = mealTime;
        break;
      }
    }
    if (!targetMealTime) return BackgroundFetch.BackgroundFetchResult.NoData;

    const today = now.toISOString().split('T')[0];

    // 중복 발송 방지
    const dedupeKey = `missed_med_sent_${today}_${targetMealTime}`;
    const alreadySent = await AsyncStorage.getItem(dedupeKey);
    if (alreadySent) return BackgroundFetch.BackgroundFetchResult.NoData;

    // 세션 확인
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return BackgroundFetch.BackgroundFetchResult.NoData;

    // 환자 정보 확인
    const { data: userRow } = await supabase
      .from('users')
      .select('role, patient_group_id, notification_enabled')
      .eq('id', session.user.id)
      .single();

    if (!userRow || userRow.role !== 'patient' || !userRow.notification_enabled) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // 오늘 해당 시간대 복용 여부 확인
    const { data: logs } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', session.user.id)
      .eq('meal_time', targetMealTime)
      .gte('taken_at', `${today}T00:00:00.000Z`)
      .lte('taken_at', `${today}T23:59:59.999Z`)
      .limit(1);

    if (logs && logs.length > 0) return BackgroundFetch.BackgroundFetchResult.NoData;

    // 중복 방지 마킹
    await AsyncStorage.setItem(dedupeKey, '1');

    // 환자에게 로컬 알림
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '💊 약을 아직 안 드셨어요',
        body: `${MEAL_TIME_LABELS_BG[targetMealTime]} 약을 아직 드시지 않으셨어요.`,
        data: { type: 'missed_medication', mealTime: targetMealTime },
      },
      trigger: null,
    });

    // 보호자에게 푸시
    if (userRow.patient_group_id) {
      const { data: caregivers } = await supabase
        .from('patient_group_members')
        .select('user_id')
        .eq('group_id', userRow.patient_group_id)
        .eq('role', 'caregiver');

      if (caregivers?.length) {
        const { data: caregiverUsers } = await supabase
          .from('users')
          .select('push_token, caregiver_notif_prefs')
          .in('id', caregivers.map((c: any) => c.user_id))
          .not('push_token', 'is', null);

        for (const cu of caregiverUsers ?? []) {
          if (!cu.push_token) continue;
          const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>;
          if (prefs.med_missed !== false) {
            await supabase.functions.invoke('send-push', {
              body: {
                to: cu.push_token,
                title: '💊 약을 안 드셨어요',
                body: `환자분이 ${MEAL_TIME_LABELS_BG[targetMealTime]} 약을 아직 안 드셨어요.`,
                data: { type: 'caregiver_missed_med', mealTime: targetMealTime },
              },
            });
          }
        }
      }
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.error('[BackgroundFetch] 미복용 체크 오류:', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/** 미복용 체크 백그라운드 태스크 등록 (환자 로그인 시 1회 호출) */
export async function registerMissedMedCheckTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(MISSED_MED_CHECK_TASK);
    if (isRegistered) return;
    await BackgroundFetch.registerTaskAsync(MISSED_MED_CHECK_TASK, {
      minimumInterval: 15 * 60, // Android 최소 15분
      stopOnTerminate: false,   // 앱 종료 후에도 실행
      startOnBoot: true,        // 재부팅 후에도 실행
    });
    console.log('[notifications] 미복용 체크 태스크 등록 완료');
  } catch (e) {
    console.error('[notifications] 미복용 체크 태스크 등록 실패:', e);
  }
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
