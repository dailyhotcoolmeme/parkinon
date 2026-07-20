/**
 * localAlarm — "알람처럼(전체화면·끌 때까지)" / "30초" 로컬 알람 예약(Android 전용).
 *
 * 아키텍처(오너 확정 2026-07-20): '알람처럼'은 **로컬이 정각에 소리+전체화면을 즉시 함께** 낸다
 *   (AlarmManager exact = 정확·지연 없음). 서버는 같은 슬롯을 **무음 백업**으로 보내(소리 겹침 방지),
 *   로컬이 극단 절전 등으로 실패해도 무음 알림이 화면에 보여 놓침을 막는다.
 *   → 서버 소리에 의존하면 크론 분단위+푸시 지연으로 화면보다 소리가 늦거나(공백 시) 누락됨.
 *
 * 동작:
 *   - alarm  : 소리 채널(프리셋/녹음/기본음)로 1회 울림 + fullScreenAction(잠금화면 위 전체화면)
 *   - basic  : 로컬 예약 없음(서버 푸시가 소리)
 *
 * iOS 는 잠금화면 위 전체화면이 원천 불가 → 로컬 알람 예약 안 함(서버 푸시로 커버). Android 전용.
 *
 * 전체화면 화면=AlarmScreen. 알람 data 로 kind/doseSlotId/medLogId/mealTime/minutes 를 실어,
 *   앱이 열릴 때(App.tsx getInitialNotification) AlarmScreen 으로 라우팅해 kind 별 흐름 처리.
 */
import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import notifee, {
  AndroidImportance,
  AndroidCategory,
  AndroidVisibility,
  TriggerType,
  RepeatFrequency,
  AlarmType,
} from '@notifee/react-native';
import i18n from '../i18n';

const ANDROID_PACKAGE = 'com.ourmine.parkinon';

/**
 * Android 14(API 34)+ "전체 화면 알림" 권한 설정 화면을 연다.
 *   이 권한이 없으면 fullScreenAction 이 전체화면 대신 헤드업 알림으로 폴백한다(잠금화면 위로 안 뜸).
 *   사이드로드/일부 OEM(삼성 등)은 기본 거부라 사용자가 직접 켜야 한다.
 */
export async function openFullScreenAlarmSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
      { data: `package:${ANDROID_PACKAGE}` },
    );
  } catch {
    // 폴백: 앱 상세 설정(구형/미지원 기기)
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.APPLICATION_DETAILS_SETTINGS',
        { data: `package:${ANDROID_PACKAGE}` },
      );
    } catch {
      /* noop */
    }
  }
}
import { presetFileIdOf, type AlarmMode } from '../constants/presetAlarmSounds';
import { resolveLocalAlarmSoundChannel } from './alarmSound';
import type { DoseSlot } from '../hooks/useDoseSlots';

const ID_REMIND_PREFIX = 'pkalarm_remind_';
const ID_TRACK_PREFIX = 'pkalarm_track_';
const DEFAULT_ALARM_CHANNEL = 'parkinon_alarm_default';

// ⚠️ 임시 비활성(2026-07-18). Android 14 전체화면 권한 미허용(사이드로드 APK)이라 로컬 알람이
//    전체화면 없이 스투ck 알림만 만들고 서버 알림과 이중으로 울렸다. 재빌드 때 전체화면 권한
//    요청 + 탭 라우팅/이중알림 정리 후 true 로 재활성. false 인 동안엔 예약 안 하고 기존 것 정리만.
const LOCAL_ALARM_ENABLED = true;

function remindAlarmId(slotId: string): string {
  return `${ID_REMIND_PREFIX}${slotId}`;
}
function trackAlarmId(slotId: string, minutes: number): string {
  return `${ID_TRACK_PREFIX}${slotId}_${minutes}`;
}

/** 이 앱이 만든 로컬 알람 trigger 인지(정리·재예약 대상 식별). */
function isLocalAlarmId(id: string): boolean {
  return id.startsWith(ID_REMIND_PREFIX) || id.startsWith(ID_TRACK_PREFIX);
}

/** 오늘/내일 중 h:m 의 가장 가까운 미래 timestamp(ms). */
function nextDailyTimestamp(h: number, m: number): number {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

interface AlarmNotifOpts {
  id: string;
  channelId: string;
  alarmMode: Exclude<AlarmMode, 'basic'>;
  kind: 'remind' | 'track';
  title: string;
  body: string;
  fileId: string | null;
  data: Record<string, string>;
}

/** notifee 전체화면 로컬 알람 알림 객체. 채널 소리로 1회 울리고 전체화면 표시. */
function buildAlarmNotification(o: AlarmNotifOpts) {
  return {
    id: o.id,
    title: o.title,
    body: o.body,
    android: {
      channelId: o.channelId, // 소리 채널(프리셋/녹음/기본음) — 정각에 1회 울림
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.ALARM,
      visibility: AndroidVisibility.PUBLIC,
      // 소리는 채널이 1회 재생(반복 아님 — 예전 '안 꺼짐' 방지). 스와이프로 지워짐(스투ck 방지).
      ongoing: false,
      autoCancel: true,
      // 잠금화면 위 전체화면. 탭/자동발동으로 AlarmScreen 라우팅.
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default', launchActivity: 'default' },
    },
    data: { ...o.data, _pkAlarm: '1', alarmMode: o.alarmMode, kind: o.kind, fileId: o.fileId ?? '' },
  };
}

/** 정시 복용 '알람처럼' 슬롯의 전체화면 로컬 알람 예약(alarm 외·비활성·iOS 면 취소만). */
async function scheduleRemindAlarmForSlot(slot: DoseSlot): Promise<void> {
  if (Platform.OS !== 'android' || !slot.id) return;
  const id = remindAlarmId(slot.id);
  // 로컬 전체화면은 '알람처럼'에만. basic/30초는 서버 알림이 담당 → 로컬 예약 제거.
  if (!slot.remindEnabled || slot.remindAlarmMode !== 'alarm') {
    await notifee.cancelTriggerNotification(id).catch(() => {});
    return;
  }
  const parts = slot.time.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? '0');
  if (Number.isNaN(h) || Number.isNaN(m)) return;

  // 로컬이 정각에 소리+전체화면을 즉시 함께 낸다(사용자가 고른 소리 채널). 서버는 무음 백업.
  const channelId = await resolveLocalAlarmSoundChannel(slot.remindSoundId);
  const fileId = presetFileIdOf(slot.remindSoundId);
  const label = slot.label ?? '';
  const notif = buildAlarmNotification({
    id,
    channelId,
    alarmMode: 'alarm',
    kind: 'remind',
    title: i18n.t('localAlarm.remindTitle'),
    body: i18n.t('localAlarm.remindBody', { label }),
    fileId,
    data: { doseSlotId: slot.id, mealTime: label },
  });
  await notifee.createTriggerNotification(notif, {
    type: TriggerType.TIMESTAMP,
    timestamp: nextDailyTimestamp(h, m),
    repeatFrequency: RepeatFrequency.DAILY,
    alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
  }).catch(() => {});
}

/**
 * 모든 정시 복용 알람 재예약(앱 실행·부팅·슬롯 변경 시 호출).
 *   기존 remind 로컬 알람 전부 취소 후, 대상 슬롯만 다시 예약 → 시간·소리·방식 변경 즉시 반영.
 *   (track 알람은 복용 시점 이벤트라 여기서 건드리지 않음.)
 *
 *   ⚠️ 직렬화: MedicationScreen·MedicationManageScreen 두 곳에서 동시·반복 호출되면 cancel/create 가
 *   경쟁(race)해 방금 만든 알람을 다른 호출이 지워버려, 예약이 유실되고 알람이 안 울린다(실측: 15:50
 *   알람이 오늘 안 뜨고 내일로 밀림). 프라미스 체인으로 한 번에 하나씩만 실행되게 한다.
 */
let rescheduleChain: Promise<void> = Promise.resolve();

async function doRescheduleRemindAlarms(slots: DoseSlot[]): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // 기존 로컬 알람(예약+표시중)을 모두 정리 — 스투ck 알림/배지 제거 포함.
    await cancelAllLocalAlarms();
    if (!LOCAL_ALARM_ENABLED) return; // 비활성 동안엔 정리만 하고 예약 안 함
    for (const slot of slots) {
      await scheduleRemindAlarmForSlot(slot);
    }
  } catch {
    /* 예약 실패해도 서버 푸시가 안전망 → 조용히 무시 */
  }
}

export function rescheduleRemindAlarms(slots: DoseSlot[]): Promise<void> {
  rescheduleChain = rescheduleChain.then(() => doRescheduleRemindAlarms(slots)).catch(() => {});
  return rescheduleChain;
}

/**
 * 이 앱이 만든 로컬 알람을 모두 취소 — 예약(trigger) + 이미 표시 중인 알림(ongoing 배지 포함).
 *   앱 시작 시·재예약 시 호출해 스투ck 알림/배지를 정리한다.
 */
export async function cancelAllLocalAlarms(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const triggers = await notifee.getTriggerNotificationIds();
    await Promise.all(
      triggers.filter(isLocalAlarmId).map((id) => notifee.cancelNotification(id).catch(() => {})),
    );
  } catch {
    /* noop */
  }
  try {
    const displayed = await notifee.getDisplayedNotifications();
    await Promise.all(
      displayed
        .filter((n) => n.notification?.data?._pkAlarm === '1' || (n.id ? isLocalAlarmId(n.id) : false))
        .map((n) => (n.id ? notifee.cancelNotification(n.id).catch(() => {}) : Promise.resolve())),
    );
  } catch {
    /* noop */
  }
}

/**
 * 약효추적 '알람처럼'/'30초' 예약 — 복용 완료 순간 호출.
 *   now + 간격(분) 마다 일회성 알람. 0분(복용직후)은 앱 내에서 바로 유도하므로 제외.
 *   medLogId 를 실어 기록이 그 복용에 1:1 매칭되게(약효 패턴 반영).
 */
export async function scheduleTrackAlarms(opts: {
  slotId: string;
  medLogId: string | null;
  mealTime: string | null;
  intervals: number[];
  soundId: string | null;
  alarmMode: AlarmMode;
}): Promise<void> {
  // 로컬 전체화면은 '알람처럼'에만. basic/30초 트랙은 서버 푸시가 담당.
  if (Platform.OS !== 'android' || opts.alarmMode !== 'alarm') return;
  if (!LOCAL_ALARM_ENABLED) return; // 임시 비활성
  // 로컬이 정각에 소리+전체화면을 즉시 함께 낸다(사용자가 고른 소리 채널). 서버는 무음 백업.
  const channelId = await resolveLocalAlarmSoundChannel(opts.soundId);
  const fileId = presetFileIdOf(opts.soundId);
  const now = Date.now();
  for (const min of opts.intervals) {
    if (!min || min <= 0) continue; // 복용직후(0)는 앱 내 즉시 유도
    const notif = buildAlarmNotification({
      id: trackAlarmId(opts.slotId, min),
      channelId,
      alarmMode: 'alarm',
      kind: 'track',
      title: i18n.t('localAlarm.trackTitle'),
      body: i18n.t('localAlarm.trackBody'),
      fileId,
      data: {
        doseSlotId: opts.slotId,
        medLogId: opts.medLogId ?? '',
        mealTime: opts.mealTime ?? '',
        minutes: String(min),
      },
    });
    await notifee.createTriggerNotification(notif, {
      type: TriggerType.TIMESTAMP,
      timestamp: now + min * 60000,
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }).catch(() => {});
  }
}

/** 알람 종료(사용자가 AlarmScreen 버튼 누름) — 소리 반복 중지 + 알림 제거. */
export async function stopActiveAlarm(notifId?: string | null): Promise<void> {
  try {
    await notifee.stopForegroundService();
  } catch {
    /* FGS 없을 수 있음 */
  }
  if (notifId) {
    await notifee.cancelNotification(notifId).catch(() => {});
  }
}

export { isLocalAlarmId };
