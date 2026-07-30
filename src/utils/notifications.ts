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
import { getDeviceTimeZone } from './timezone';
import type { MedNotif, ExerciseNotif } from '../context/SettingsContext';
import i18n from '../i18n';
import { resolveInitialLanguage } from '../i18n/detectLocale';

function isKoLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('ko');
}

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
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const MEAL_TIMES: Record<string, { hour: number; minute: number }> = {
  morning: { hour: 8, minute: 0 },
  lunch: { hour: 12, minute: 0 },
  dinner: { hour: 18, minute: 0 },
  bedtime: { hour: 22, minute: 0 },
};

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const rem = m % 60;
  // interval.* 의 ko 값이 기존 하드코딩 문구와 글자까지 동일하다(대조 확인) — 분기 없이 쓴다.
  // 해외는 언어 파일을 그대로 쓴다. 예전엔 en/ko 이분법이라 프랑스어·일본어
  // 사용자에게 "{{when}}" 자리만 영어로 섞여 나왔다. 이제 언어가 늘어도 여긴 그대로.
  if (m === 0) return i18n.t('medManage.rightAfter');
  if (m < 60) return i18n.t('medManage.minLater', { m });
  return rem === 0
    ? i18n.t('medManage.hourLaterOnly', { h })
    : i18n.t('medManage.hourMinLater', { h, m: rem });
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
    console.log('[notifications] permission not set - showing the permission request dialog');
    const { status: requestedStatus } = await Notifications.requestPermissionsAsync();
    finalStatus = requestedStatus;
  }

  if (finalStatus !== 'granted') {
    console.warn('[notifications] notification permission not granted (status:', finalStatus, ') — push token skipping save');
    return null;
  }

  console.log('[notifications] notification permission granted - saving push token');

  // 2. Android 알림 채널 생성 (MAX 중요도 — 시스템 알림 설정에 채널이 표시되어야 차단 해제 가능)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: i18n.t('notifications.defaultChannelName'),
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
      name: i18n.t('notifications.medicationChannelName'),
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
    console.log('[notifications] acquiring Expo Push Token...');
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    console.log('[notifications] projectId:', projectId);

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenData.data;
    if (__DEV__) console.log('[notifications] acquired Expo Push Token:', token.substring(0, 30) + '...');

    // 4. users 테이블에 push_token 저장
    //    supabase-js PostgREST 대신 직접 fetch 사용 (새 아키텍처 hang 버그 우회)
    let token_ = accessToken;
    if (!token_) {
      console.log('[notifications] accessToken not passed - falling back to getSession()');
      const { data: { session } } = await supabase.auth.getSession();
      token_ = session?.access_token;
    }

    if (!token_) {
      console.error('[notifications] ❌ accessToken missing - cannot save push_token to DB');
      return null;
    }

    if (__DEV__) console.log('[notifications] starting DB save - userId:', userId);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token_}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      // push_platform: iOS/Android 구분 동시 저장 (푸시 라우팅 — 알림음 채널/사운드 분기용)
      // timezone: 기기 IANA 타임존을 부팅마다 실행되는 이 PATCH에 함께 upsert(Phase1 S1).
      //   이미 push_token을 쓰는 요청에 한 필드만 얹으므로 추가 쓰기 비용 0.
      //   해외 이동 시 자동 갱신되고, 국내 기기는 항상 'Asia/Seoul'(DEFAULT와 동일) → 회귀 0.
      //   서버/화면 로직은 아직 timezone을 사용하지 않는다(S2/S3).
      // language: 서버 푸시(약 복용/진료/미복용 알림 등) title·body 로케일 분기용.
      //   ⚠️ 앱이 실제로 쓰는 언어를 그대로 저장한다. 예전엔 해외를 전부 'en' 으로
      //   눌러 담았는데, 그러면 프랑스어·일본어 사용자가 앱은 자기 언어인데 푸시만
      //   영어로 받는다. resolveInitialLanguage() 는 i18next 의 lng 와 같은 값이라
      //   앱 화면과 알림의 언어가 어긋날 수 없고, 미지원 언어는 'en' 으로 떨어진다.
      //   국내 기기는 'ko'(DEFAULT와 동일) → 회귀 0.
      body: JSON.stringify({
        push_token: token,
        push_platform: Platform.OS,
        timezone: getDeviceTimeZone(),
        language: resolveInitialLanguage(),
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      if (__DEV__) {
        console.error('[notifications] ❌ push_token PATCH failed:', res.status, txt);
        console.error('[notifications] userId:', userId);
        console.error('[notifications] SUPABASE_URL:', SUPABASE_URL);
      }
      return null;
    }

    console.log('[notifications] ✅ push_token saved to DB');
    return token;
  } catch (e) {
    console.error('[notifications] ❌ failed to acquire/save push token:', e);
    if (e instanceof Error) {
      console.error('[notifications] error detail:', e.message);
      console.error('[notifications] stack:', e.stack);
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
        title: i18n.t('notifications.effectTrackTitle'),
        // 로컬 폴백은 슬롯 시간대/시각을 모르므로 시간대 없는 폴백 문구 사용.
        // (서버 약효추적 본문과 동일 체계: "복용약의 {N분 후}" / "복용약 드신 직후")
        body: n.minutes === 0
          ? i18n.t('notifications.effectTrackBodyImmediate')
          : i18n.t('notifications.effectTrackBody', { when: minutesToLabel(n.minutes) }),
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

/**
 * 운동 예정 알림 — 서버 푸시(send-medication-reminders 섹션4)로 전담 발송.
 * 로컬 알림 등록 제거 (서버 푸시와 중복 발송 방지).
 * 기존 사용자 기기에 등록된 로컬 운동 알림(exercise-*)이 있으면 취소만 수행.
 * 인자는 호출처 호환을 위해 유지하나 더 이상 사용하지 않음.
 */
export async function scheduleExerciseReminders(_exerciseNotifs: ExerciseNotif[]): Promise<void> {
  // 기존에 등록된 로컬 운동 알림 취소 (하위 호환 — exercise-{id} 식별자)
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith('exercise-')) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch {}
  // 구버전이 AsyncStorage에 저장해둔 운동 알림 ID 목록 잔여분도 정리
  try {
    await AsyncStorage.removeItem(EXERCISE_NOTIF_IDS_KEY);
  } catch {}
  // 새 로컬 알림 등록하지 않음 — 서버 푸시가 전담
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
    console.error('[notifications] failed to send caregiver push:', e);
  }
}
