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
import { getKSTToday, getKSTDayRange } from './medUtils';

/** 'HH:MM[:SS]' → 자정 기준 분. 파싱 실패 시 null. */
function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const parts = hhmm.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** KST 현재 시각의 자정 기준 분(0~1439). */
function kstNowMinutes(): number {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/**
 * 슬롯/운동 시각(HH:MM)이 KST 현재 대비 이미 지났는지.
 * 파싱 실패 시 false(=안 지남)로 폴백(틀린 "내일부터" 단정 금지).
 */
export function isTimePastKST(hhmm: string | null | undefined): boolean {
  const target = hhmmToMinutes(hhmm);
  if (target === null) return false;
  return kstNowMinutes() > target;
}

/** ampm/hour/minute → 'HH:MM'. (운동 알림 시각 비교용) */
export function ampmToHHMM(n: { ampm: '오전' | '오후'; hour: number; minute: number }): string {
  const h24 = n.ampm === '오후' ? (n.hour === 12 ? 12 : n.hour + 12) : (n.hour === 12 ? 0 : n.hour);
  return `${String(h24).padStart(2, '0')}:${String(n.minute).padStart(2, '0')}`;
}

/** 'HH:MM[:SS]' → '오전/오후 H:MM' (어르신 친화 표기). 팝업 문구용. */
export function formatTimeKor(hhmm: string | null | undefined): string {
  const total = hhmmToMinutes(hhmm);
  if (total === null) return hhmm ?? '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  const period = h < 12 ? '오전' : '오후';
  let dh = h % 12;
  if (dh === 0) dh = 12;
  return `${period} ${dh}:${String(m).padStart(2, '0')}`;
}

/* ────────────────────────────────────────────────────────────────────────── *
 *  약 복용 / 운동 알림 (즉시형) 문구 빌더
 * ────────────────────────────────────────────────────────────────────────── */

export interface FeedbackPopup {
  title: string;
  message: string;
}

/** 시간 변경(remind 켜진 슬롯/운동) → 즉시형 안내. */
export function timeChangeImmediatePopup(hhmm: string): FeedbackPopup {
  const kor = formatTimeKor(hhmm);
  return isTimePastKST(hhmm)
    ? {
        title: '시간을 바꿨어요',
        message: `바로 적용됐어요. 오늘 ${kor}은 지나서, 내일부터 이 시간에 알려드려요.`,
      }
    : {
        title: '시간을 바꿨어요',
        message: `바로 적용됐어요. 오늘 ${kor}부터 알려드려요.`,
      };
}

/** remind/운동 알림 꺼진 슬롯의 시간만 변경한 경우. */
export function timeChangeWhileOffPopup(): FeedbackPopup {
  return {
    title: '시간을 바꿨어요',
    message: '이 약 복용 알림은 꺼져 있어요.',
  };
}

/** 켜기 → 즉시형 안내. */
export function turnOnImmediatePopup(hhmm: string): FeedbackPopup {
  const kor = formatTimeKor(hhmm);
  return isTimePastKST(hhmm)
    ? { title: '알림을 켰어요', message: '오늘은 지나서 내일부터 와요.' }
    : { title: '알림을 켰어요', message: `오늘 ${kor}부터 와요.` };
}

/** 끄기 → 즉시 중단. */
export function turnOffImmediatePopup(): FeedbackPopup {
  return {
    title: '알림을 껐어요',
    message: '지금부터 이 시간 알림은 오지 않아요.',
  };
}

/** 약 복용 시간 슬롯 삭제 → 즉시 중단(약효추적 합산은 deleteSlotPopup 사용). */
export function deleteImmediatePopup(): FeedbackPopup {
  return {
    title: '복용 시간을 삭제했어요',
    message: '지금부터 알림이 오지 않아요.',
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
): Promise<boolean | null> {
  if (!patientId || !doseSlotId) return null;
  try {
    const { start, end } = getKSTDayRange(getKSTToday());
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
      title: '약효 추적을 바꿨어요',
      message:
        '오늘 이 약은 이미 드셔서, 오늘 약효추적 알림은 기존 설정대로 와요. 바꾼 내용은 다음에 약을 드실 때부터 적용돼요.',
    };
  }
  // false 또는 null(불확실) → "다음 복용부터" 일반 안내(틀린 단정 회피)
  return {
    title: '약효 추적을 바꿨어요',
    message: '바꾼 내용은 다음에 이 약을 드실 때부터 적용돼요. 오늘 복용분부터 반영돼요.',
  };
}

/**
 * 약효추적 끄기 결과 팝업. (오늘 이미 복용했으면 예약된 오늘 알림은 올 수 있음을 추가)
 */
export function trackOffPopup(takenToday: boolean | null): FeedbackPopup {
  if (takenToday === true) {
    return {
      title: '약효 추적을 껐어요',
      message:
        '오늘 이 약은 이미 드셔서, 오늘 약효추적 알림은 기존 설정대로 와요. 바꾼 내용은 다음에 약을 드실 때부터 적용돼요. 이미 예약된 오늘 알림은 올 수 있어요.',
    };
  }
  return {
    title: '약효 추적을 껐어요',
    message: '바꾼 내용은 다음에 이 약을 드실 때부터 적용돼요. 오늘 복용분부터 반영돼요.',
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
      title: '복용 시간을 삭제했어요',
      message:
        '약 복용 알림은 지금부터 오지 않아요. 오늘 이 약은 이미 드셔서, 이미 예약된 오늘 약효추적 알림은 올 수 있어요. 바꾼 내용은 다음에 약을 드실 때부터 적용돼요.',
    };
  }
  return {
    title: '복용 시간을 삭제했어요',
    message: '약 복용 알림은 지금부터 오지 않아요. 약효추적 알림도 다음 복용부터 오지 않아요.',
  };
}
