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
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import type { MedNotif, ExerciseNotif } from '../context/SettingsContext';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// ─── 미복용 체크 백그라운드 태스크 ─────────────────────────────────────────

const MISSED_MED_CHECK_TASK = 'PARKINON_CHECK_MISSED_MEDS';

const MEAL_TIME_LABELS_BG: Record<string, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
};

// 식사 시간 + 10분 후 재알림 체크 윈도우 (분, 자정 기준)
const MEAL_REMIND_WINDOWS: Record<string, { from: number; to: number }> = {
  morning: { from: 8 * 60 + 10, to: 8 * 60 + 19 },
  lunch:   { from: 12 * 60 + 10, to: 12 * 60 + 19 },
  dinner:  { from: 18 * 60 + 10, to: 18 * 60 + 19 },
  bedtime: { from: 22 * 60 + 10, to: 22 * 60 + 19 },
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

    const today = now.toISOString().split('T')[0];

    // ── +10분 재알림 체크포인트 ──────────────────────────────────────
    let remindMealTime: string | null = null;
    for (const [mealTime, win] of Object.entries(MEAL_REMIND_WINDOWS)) {
      if (minutesFromMidnight >= win.from && minutesFromMidnight <= win.to) {
        remindMealTime = mealTime;
        break;
      }
    }

    if (remindMealTime) {
      const remindDedupeKey = `med_remind_sent_${today}_${remindMealTime}`;
      const alreadyReminded = await AsyncStorage.getItem(remindDedupeKey);

      if (!alreadyReminded) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: userRow } = await supabase
            .from('users')
            .select('role, notification_enabled')
            .eq('id', session.user.id)
            .single();

          if (userRow?.role === 'patient' && userRow.notification_enabled) {
            const { data: logs } = await supabase
              .from('med_logs')
              .select('id')
              .eq('patient_id', session.user.id)
              .eq('meal_time', remindMealTime)
              .gte('taken_at', `${today}T00:00:00.000Z`)
              .lte('taken_at', `${today}T23:59:59.999Z`)
              .limit(1);

            if (!logs || logs.length === 0) {
              await AsyncStorage.setItem(remindDedupeKey, '1');
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: '💊 아직 복용 전이에요',
                  body: `${MEAL_TIME_LABELS_BG[remindMealTime]} 약, 잊지 마세요!`,
                  data: { type: 'medication_reminder', mealTime: remindMealTime },
                },
                trigger: null,
              });
              return BackgroundFetch.BackgroundFetchResult.NewData;
            }
          }
        }
      }
    }

    // ── +20분 최종 체크포인트 (환자 + 보호자 알림) ──────────────────
    let targetMealTime: string | null = null;
    for (const [mealTime, win] of Object.entries(MEAL_CHECK_WINDOWS)) {
      if (minutesFromMidnight >= win.from && minutesFromMidnight <= win.to) {
        targetMealTime = mealTime;
        break;
      }
    }
    if (!targetMealTime) return BackgroundFetch.BackgroundFetchResult.NoData;

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

  if (existingStatus !== 'granted') {
    // 아직 요청 안 했으면 시스템 권한 다이얼로그 표시
    const { status: requestedStatus } = await Notifications.requestPermissionsAsync();
    finalStatus = requestedStatus;
  }

  if (finalStatus !== 'granted') {
    // 거부됐으면 시스템 설정으로 안내
    Alert.alert(
      '알림 허용이 필요해요',
      '약 복용 알림을 받으려면 알림 권한이 필요해요.\n설정에서 파킨온 알림을 허용해주세요.',
      [
        { text: '나중에', style: 'cancel' },
        {
          text: '설정 열기',
          onPress: () => Linking.openSettings(),
        },
      ],
    );
    return null;
  }

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
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenData.data;

    // 4. users 테이블에 push_token 저장
    //    supabase-js PostgREST 대신 직접 fetch 사용 (새 아키텍처 hang 버그 우회)
    let token_ = accessToken;
    if (!token_) {
      const { data: { session } } = await supabase.auth.getSession();
      token_ = session?.access_token;
    }
    if (token_) {
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
        console.error('[notifications] push_token 저장 실패:', res.status, txt);
      }
    } else {
      console.warn('[notifications] accessToken 없음 — push_token DB 저장 스킵');
    }

    console.log('[notifications] 권한 획득 + push token 저장 완료:', token.substring(0, 30) + '...');
    return token;
  } catch (e) {
    console.error('[notifications] push token 획득 실패:', e);
    return null;
  }
}

const NOTIF_BLOCKED_ALERT_THROTTLE_KEY = 'notif_blocked_alert_last_shown';
const NOTIF_BLOCKED_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24시간에 1번만 알림

/**
 * 앱 재진입 시 알림 권한 상태 확인 — 이미 거부된 경우 시스템 설정 안내
 * (온보딩 완료 후 매 앱 포어그라운드 진입 시 호출)
 * - 24시간에 1번만 Alert 표시 (매번 뜨면 UX 저하)
 * - Android: status !== 'granted' 로 판단 (denied / undetermined 구분 없이 처리)
 */
export async function checkAndPromptNotificationPermission(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  // granted이면 정상 — 아무것도 안 함
  if (status === 'granted') return;

  // 차단된 경우 → 최근 24시간 이내 이미 안내했으면 스킵
  try {
    const lastShownRaw = await AsyncStorage.getItem(NOTIF_BLOCKED_ALERT_THROTTLE_KEY);
    if (lastShownRaw) {
      const lastShown = parseInt(lastShownRaw, 10);
      if (Date.now() - lastShown < NOTIF_BLOCKED_ALERT_INTERVAL_MS) return;
    }
    await AsyncStorage.setItem(NOTIF_BLOCKED_ALERT_THROTTLE_KEY, String(Date.now()));
  } catch {}

  Alert.alert(
    '알림이 차단되어 있어요',
    '약 복용 알림을 받으려면 설정에서 파킨온 알림을 허용해주세요.',
    [
      { text: '나중에', style: 'cancel' },
      {
        text: '설정 열기',
        onPress: () => Linking.openSettings(),
      },
    ],
  );
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
