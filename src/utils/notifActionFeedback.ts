/**
 * notifActionFeedback.ts
 * 알림 설정 액션(시간변경/on·off/삭제) 후 "언제 적용되는지" 상황 인지형
 * 결과 안내 팝업의 문구·판정 로직 단일 출처.
 *
 * 스펙: docs/notif_action_feedback_spec.md
 *
 * 확정 동작:
 * - 약 복용 / 운동 / 약 미복용 = 서버 크론이 매분 DB 라이브 읽기 → 즉시 적용.
 *   단 오늘 그 시각이 이미 지났으면 오늘은 안 오고 내일부터.
 * - 약효추적 = 복용 순간 큐에 박제 → 지연. 오늘 이미 복용했으면 오늘분은 기존대로,
 *   바꾼 내용은 다음 복용부터.
 *
 * 순수 TS · OTA 호환.
 */
import { supabase } from '../lib/supabase';
import type { AmPm } from '../context/SettingsContext';
import { getLocalToday, getLocalDayRange } from './medUtils';
import { formatClock } from './notifLabels';
import i18n from '../i18n';
import { isOverseasLocale } from '../i18n/detectLocale';


const FALLBACK_TZ = 'Asia/Seoul';

/** 'HH:MM[:SS]' → 자정 기준 분. 파싱 실패 시 null. */
function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const parts = hhmm.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** tz(IANA) 현재 시각의 자정 기준 분(0~1439). tz 미지정 시 Asia/Seoul(기존 KST 동일). */
function localNowMinutes(tz: string = FALLBACK_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || FALLBACK_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    else if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  if (h === 24) h = 0; // 일부 엔진의 자정 24시 표기 방어
  return h * 60 + m;
}

/**
 * 슬롯/운동 시각(HH:MM)이 사용자 tz 현재 대비 이미 지났는지.
 * tz 미지정 시 Asia/Seoul(기존 KST 판정과 동일). 파싱 실패 시 false(=안 지남)로 폴백.
 */
export function isTimePastKST(hhmm: string | null | undefined, tz: string = FALLBACK_TZ): boolean {
  const target = hhmmToMinutes(hhmm);
  if (target === null) return false;
  return localNowMinutes(tz) > target;
}

/** ampm/hour/minute → 'HH:MM'. (운동 알림 시각 비교용) */
export function ampmToHHMM(n: { ampm: AmPm; hour: number; minute: number }): string {
  const h24 = n.ampm === 'pm' ? (n.hour === 12 ? 12 : n.hour + 12) : (n.hour === 12 ? 0 : n.hour);
  return `${String(h24).padStart(2, '0')}:${String(n.minute).padStart(2, '0')}`;
}

/** 'HH:MM[:SS]' → '오전/오후 H:MM' (어르신 친화 표기). 팝업 문구용. */
export function formatTimeKor(hhmm: string | null | undefined): string {
  const total = hhmmToMinutes(hhmm);
  if (total === null) return hhmm ?? '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return formatClock(new Date(2000, 0, 1, h, m));
}

/* ────────────────────────────────────────────────────────────────────────── *
 *  약 복용 / 운동 알림 (즉시형) 문구 빌더
 * ────────────────────────────────────────────────────────────────────────── */

export interface FeedbackPopup {
  title: string;
  message: string;
}

/** 시간 변경(remind 켜진 슬롯/운동) → 즉시형 안내. */
export function timeChangeImmediatePopup(hhmm: string, tz: string = FALLBACK_TZ): FeedbackPopup {
  const kor = formatTimeKor(hhmm);
  return isTimePastKST(hhmm, tz)
    ? {
        title: i18n.t('notifActionFeedback.timeChangeTitle'),
        message: i18n.t('notifActionFeedback.timeChangePastMsg', { time: kor }),
      }
    : {
        title: i18n.t('notifActionFeedback.timeChangeTitle'),
        message: i18n.t('notifActionFeedback.timeChangeTodayMsg', { time: kor }),
      };
}

/** remind/운동 알림 꺼진 슬롯의 시간만 변경한 경우. */
export function timeChangeWhileOffPopup(): FeedbackPopup {
  return {
    title: i18n.t('notifActionFeedback.timeChangeTitle'),
    message: i18n.t('notifActionFeedback.timeChangeWhileOffMsg'),
  };
}

/** 켜기 → 즉시형 안내. */
export function turnOnImmediatePopup(hhmm: string, tz: string = FALLBACK_TZ): FeedbackPopup {
  const kor = formatTimeKor(hhmm);
  return isTimePastKST(hhmm, tz)
    ? { title: i18n.t('notifActionFeedback.turnOnTitle'), message: i18n.t('notifActionFeedback.turnOnPastMsg') }
    : { title: i18n.t('notifActionFeedback.turnOnTitle'), message: i18n.t('notifActionFeedback.turnOnTodayMsg', { time: kor }) };
}

/** 끄기 → 즉시 중단. */
export function turnOffImmediatePopup(): FeedbackPopup {
  return {
    title: i18n.t('notifActionFeedback.turnOffTitle'),
    message: i18n.t('notifActionFeedback.turnOffMsg'),
  };
}

/** 약 복용 시간 슬롯 삭제 → 즉시 중단(약효추적 합산은 deleteSlotPopup 사용). */
export function deleteImmediatePopup(): FeedbackPopup {
  return {
    title: i18n.t('notifActionFeedback.deleteSlotTitle'),
    message: i18n.t('notifActionFeedback.deleteImmediateMsg'),
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 *  약효추적 알림 (지연형) — "오늘 복용했는지" 조회 + 문구
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 오늘(KST) 이 슬롯의 약을 이미 복용했는지 med_logs 조회.
 * 기존 supabase 클라이언트(RLS 통과). 조회 실패 시 null(불확실 → 일반 폴백 문구).
 */
export async function hasTakenTodayKST(
  patientId: string | null | undefined,
  doseSlotId: string | null | undefined,
  tz: string = FALLBACK_TZ,
): Promise<boolean | null> {
  if (!patientId || !doseSlotId) return null;
  try {
    const { start, end } = getLocalDayRange(getLocalToday(tz), tz);
    const { data, error } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patientId)
      .eq('dose_slot_id', doseSlotId)
      .gte('taken_at', start)
      .lte('taken_at', end)
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error('[notifActionFeedback] hasTakenTodayKST 조회 실패:', e);
    return null;
  }
}

/**
 * 약효추적 설정 변경(간격변경/켜기) 결과 팝업.
 * @param takenToday hasTakenTodayKST 결과(true/false/null)
 */
export function trackChangePopup(takenToday: boolean | null): FeedbackPopup {
  if (takenToday === true) {
    return {
      title: i18n.t('notifActionFeedback.trackChangeTitle'),
      message: i18n.t('notifActionFeedback.trackChangeTakenMsg'),
    };
  }
  // false 또는 null(불확실) → "다음 복용부터" 일반 안내(틀린 단정 회피)
  return {
    title: i18n.t('notifActionFeedback.trackChangeTitle'),
    message: i18n.t('notifActionFeedback.trackChangeNextMsg'),
  };
}

/**
 * 약효추적 끄기 결과 팝업. (오늘 이미 복용했으면 예약된 오늘 알림은 올 수 있음을 추가)
 */
export function trackOffPopup(takenToday: boolean | null): FeedbackPopup {
  if (takenToday === true) {
    return {
      title: i18n.t('notifActionFeedback.trackOffTitle'),
      message: i18n.t('notifActionFeedback.trackOffTakenMsg'),
    };
  }
  return {
    title: i18n.t('notifActionFeedback.trackOffTitle'),
    message: i18n.t('notifActionFeedback.trackChangeNextMsg'),
  };
}

/**
 * 슬롯 삭제 통합 팝업 — 약 복용(즉시 중단) + 약효추적(오늘 예약분은 올 수 있음)을
 * 한 번에 안내. 삭제 팝업이 두 번 겹쳐 뜨지 않도록 단일 호출.
 * @param takenToday 오늘 이 슬롯 약을 이미 복용했는지(약효추적 안내 분기용)
 */
export function deleteSlotCombinedPopup(takenToday: boolean | null): FeedbackPopup {
  if (takenToday === true) {
    return {
      title: i18n.t('notifActionFeedback.deleteSlotTitle'),
      message: i18n.t('notifActionFeedback.deleteSlotTakenMsg'),
    };
  }
  return {
    title: i18n.t('notifActionFeedback.deleteSlotTitle'),
    message: i18n.t('notifActionFeedback.deleteSlotMsg'),
  };
}
