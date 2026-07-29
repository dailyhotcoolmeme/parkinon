import i18n from '../i18n';
import { isOverseasLocale } from '../i18n/detectLocale';
import { LEGACY_SLOT_META, type LegacyMealKey } from '../constants/doseSlots';


// 영어 고정표를 언어 파일 키로 옮겼다(영어만 있으면 새 언어에서 영어가 나온다).
//   mealTimeToPeriod → slot.<key>       ('아침')
//   mealTimeToKorean → slot.<key>Med    ('아침약')

/* ────────────────────────────────────────────────────────────────────────── *
 *  하루 경계(오늘/DayRange) — 타임존 일반화 (Phase 1 · S2)
 *
 *  기존 getKSTToday/getKSTDayRange 는 KST(+9h) 고정이었다. 해외 사용자 지원을
 *  위해 IANA 타임존 인자를 받는 getLocalToday/getLocalDayRange 로 일반화한다.
 *
 *  ⚠️ 국내 회귀 0 보장:
 *   - getLocalToday('Asia/Seoul') === 기존 getKSTToday() (문자열 비트 동일)
 *   - getLocalDayRange(d,'Asia/Seoul') === 기존 { `${d}T00:00:00+09:00`,
 *     `${d}T23:59:59.999+09:00` } (Asia/Seoul 오프셋은 연중 +09:00 고정, DST 없음)
 *  기존 두 함수는 tz='Asia/Seoul' 을 넘기는 하위호환 래퍼로 유지한다.
 * ────────────────────────────────────────────────────────────────────────── */

const FALLBACK_TZ = 'Asia/Seoul';

/** 주어진 순간(date)을 tz 로컬 캘린더로 본 'YYYY-MM-DD'. 로케일 무관(formatToParts). */
function ymdInTimeZone(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  let y = '';
  let m = '';
  let d = '';
  for (const p of parts) {
    if (p.type === 'year') y = p.value;
    else if (p.type === 'month') m = p.value;
    else if (p.type === 'day') d = p.value;
  }
  return `${y}-${m}-${d}`;
}

/** 주어진 순간(date)에 tz 가 UTC 대비 갖는 오프셋(분). 예: Asia/Seoul → 540. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  let hour = map.hour;
  if (hour === 24) hour = 0; // 일부 엔진이 자정을 24로 표기하는 것 방어
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** dateStr(YYYY-MM-DD) 그 날 tz 오프셋을 '±HH:MM' 문자열로. (정오 UTC로 프로브해 DST 경계 안전) */
function tzOffsetSuffix(dateStr: string, tz: string): string {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const min = tzOffsetMinutes(probe, tz);
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * tz(IANA) 기준 오늘 날짜 문자열 (YYYY-MM-DD). tz 미지정 시 Asia/Seoul.
 * Asia/Seoul 이면 기존 getKSTToday() 와 문자열 동일(회귀 0).
 */
export function getLocalToday(tz: string = FALLBACK_TZ): string {
  return ymdInTimeZone(new Date(), tz || FALLBACK_TZ);
}

/**
 * tz(IANA) 기준 dateStr 하루의 시작/끝 ISO 문자열 (Supabase timestamptz 쿼리용).
 * dateStr 의 tz 로컬 자정~자정직전을 그 tz 오프셋을 붙여 절대시각으로 표현한다.
 * Asia/Seoul 이면 start=`${d}T00:00:00+09:00`, end=`${d}T23:59:59.999+09:00` (기존과 비트 동일).
 */
export function getLocalDayRange(
  dateStr: string,
  tz: string = FALLBACK_TZ,
): { start: string; end: string } {
  const off = tzOffsetSuffix(dateStr, tz || FALLBACK_TZ);
  return {
    start: `${dateStr}T00:00:00${off}`,
    end: `${dateStr}T23:59:59.999${off}`,
  };
}

// ── 하위호환 래퍼 (호출부 안 깨지게 유지) ────────────────────────────────────
// KST(UTC+9) 기준 오늘 날짜 문자열 반환 (YYYY-MM-DD)
export function getKSTToday(): string {
  return getLocalToday('Asia/Seoul');
}

// KST 기준 날짜의 시작/끝 ISO 문자열 (Supabase 쿼리용)
export function getKSTDayRange(dateStr: string): { start: string; end: string } {
  return getLocalDayRange(dateStr, 'Asia/Seoul');
}

export function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (isOverseasLocale()) {
    if (m === 0) return i18n.t('interval.rightAfter');
    if (m < 60) return i18n.t('interval.minLater', { m });
    return rem === 0 ? i18n.t('interval.hourLater', { h }) : i18n.t('interval.hourMinLater', { h, m: rem });
  }
  if (m === 0) return '복용 직후';
  if (m < 60) return `${m}분 후`;
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`;
}

/**
 * trigger_time_label → 표시용 짧은 태그 (예: '+2시간', '+30분', '+즉시')
 */
export function triggerLabelToTag(label: string | null | undefined): string {
  if (!label) return '';
  if (isOverseasLocale()) {
    if (label === 'after_medication') return i18n.t('interval.tagNow');
    const minMatchEn = label.match(/^(\d+)min_after$/);
    if (minMatchEn) {
      const min = parseInt(minMatchEn[1], 10);
      if (min < 60) return i18n.t('interval.tagMin', { m: min });
      const h = Math.floor(min / 60);
      const rem = min % 60;
      return rem === 0 ? i18n.t('interval.tagHour', { h }) : i18n.t('interval.tagHourMin', { h, m: rem });
    }
    const hourMatchEn = label.match(/^(\d+)hour_after$/);
    if (hourMatchEn) return i18n.t('interval.tagHour', { h: hourMatchEn[1] });
    return '';
  }
  if (label === 'after_medication') return '+즉시';
  const minMatch = label.match(/^(\d+)min_after$/);
  if (minMatch) {
    const min = parseInt(minMatch[1], 10);
    if (min < 60) return `+${min}분`;
    const h = Math.floor(min / 60);
    const rem = min % 60;
    return rem === 0 ? `+${h}시간` : `+${h}시간 ${rem}분`;
  }
  const hourMatch = label.match(/^(\d+)hour_after$/);
  if (hourMatch) {
    return `+${hourMatch[1]}시간`;
  }
  return '';
}

/**
 * trigger_time_label → 표시용 전체 텍스트 (예: '복용 2시간 후', '복용 30분 후')
 */
export function triggerLabelToText(label: string | null | undefined): string {
  if (!label) return '';
  if (isOverseasLocale()) {
    if (label === 'after_medication') return i18n.t('interval.rightAfter');
    const minMatchEn = label.match(/^(\d+)min_after$/);
    if (minMatchEn) {
      const min = parseInt(minMatchEn[1], 10);
      if (min === 0) return i18n.t('interval.rightAfter');
      if (min < 60) return i18n.t('interval.minLater', { m: min });
      const h = Math.floor(min / 60);
      const rem = min % 60;
      return rem === 0 ? i18n.t('interval.hourLater', { h }) : i18n.t('interval.hourMinLater', { h, m: rem });
    }
    const hourMatchEn = label.match(/^(\d+)hour_after$/);
    if (hourMatchEn) {
      return i18n.t('interval.hourLater', { h: hourMatchEn[1] });
    }
    return label;
  }
  if (label === 'after_medication') return '복용 직후';
  const minMatch = label.match(/^(\d+)min_after$/);
  if (minMatch) {
    const min = parseInt(minMatch[1], 10);
    if (min === 0) return '복용 직후';
    if (min < 60) return `복용 ${min}분 후`;
    const h = Math.floor(min / 60);
    const rem = min % 60;
    return rem === 0 ? `복용 ${h}시간 후` : `복용 ${h}시간 ${rem}분 후`;
  }
  const hourMatch = label.match(/^(\d+)hour_after$/);
  if (hourMatch) {
    return `복용 ${hourMatch[1]}시간 후`;
  }
  return label;
}

/**
 * trigger_time_label → 분 수 (정렬용)
 */
export function triggerLabelToMinutes(label: string | null | undefined): number {
  if (!label || label === 'after_medication') return 0;
  const minMatch = label.match(/^(\d+)min_after$/);
  if (minMatch) return parseInt(minMatch[1], 10);
  const hourMatch = label.match(/^(\d+)hour_after$/);
  if (hourMatch) return parseInt(hourMatch[1], 10) * 60;
  return Infinity;
}

/**
 * medication_meal_time → 한국어 약 이름 (예: 'dinner' → '저녁약')
 * 슬롯 상수는 constants/doseSlots.ts(LEGACY_SLOT_META) 단일 출처 사용.
 * 시그니처·반환값은 기존과 100% 동일(매칭 실패 시 입력값 그대로).
 */
export function mealTimeToKorean(mealTime: string | null | undefined): string {
  if (!mealTime) return '';
  const meta = LEGACY_SLOT_META[mealTime as LegacyMealKey];
  if (!meta) return mealTime;
  if (isOverseasLocale()) return i18n.t(`slot.${meta.key}Med`);
  return meta.korMed;
}

/**
 * medication_meal_time → 한국어 시간대 이름 (예: 'dinner' → '저녁')
 * 슬롯 상수는 constants/doseSlots.ts(LEGACY_SLOT_META) 단일 출처 사용.
 */
export function mealTimeToPeriod(mealTime: string | null | undefined): string {
  if (!mealTime) return '';
  const meta = LEGACY_SLOT_META[mealTime as LegacyMealKey];
  if (!meta) return mealTime;
  if (isOverseasLocale()) return i18n.t(`slot.${meta.key}`);
  return meta.label;
}

/**
 * medication_meal_time → 한국어 시간대 라벨(로케일 무관, 항상 한글 고정).
 * mealTimeToPeriod과 달리 표시용이 아니라 PERIOD_COLOR/PERIOD_ICON 같은
 * 내부 조회 키로 쓰인다 — 이 값을 화면에 직접 표시하면 안 된다(그럴 땐 mealTimeToPeriod
 * 또는 표시 전용 변환 함수를 쓸 것). 해외 로케일에서 mealTimeToPeriod의 영어 반환값을
 * 색상 조회 키로 잘못 쓰면 PERIOD_COLOR/PERIOD_ICON이 전부 매칭 실패해 기본색으로
 * 뭉개지는 버그가 있었다(오너 발견, 2026-07-05: 해외판 섹션 헤더 색이 전부 동일).
 */
export function mealTimeToPeriodKo(mealTime: string | null | undefined): string {
  if (!mealTime) return '';
  const meta = LEGACY_SLOT_META[mealTime as LegacyMealKey];
  if (!meta) return mealTime;
  return meta.label;
}

/**
 * 용량 표시 — 단일 출처.
 * dosage_unit(언어 무관 키: tablet/capsule/mg)이 있으면 그걸로, 없으면
 * 옛 합성 문자열('1정'/'5mg')을 파싱해 현재 언어 단위로 바꾼다.
 * (raw 를 그대로 그리면 해외 화면에 '정'이 샌다 — 진료기록 상세에서 실제 발생.)
 */
export function formatDosage(dosage?: string | null, unit?: string | null): string {
  const trimmed = (dosage ?? '').trim();
  if (!trimmed) return '';
  const numMatch = trimmed.match(/[0-9]+(?:\.[0-9]+)?/);
  const num = numMatch ? numMatch[0] : '';
  const u = (unit ?? '').trim() ||
    (/정$/.test(trimmed) ? 'tablet' : /캡슐$/.test(trimmed) ? 'capsule' : /mg/i.test(trimmed) ? 'mg' : '');
  if (!num) return trimmed;
  if (u === 'mg') return `${num}mg`;
  if (u === 'tablet') return `${num}${isOverseasLocale() ? ' ' + i18n.t('medManage.unitTablet') : '정'}`;
  if (u === 'capsule') return `${num}${isOverseasLocale() ? ' ' + i18n.t('medManage.unitCapsule') : '캡슐'}`;
  return trimmed;
}

/** raw dosage 문자열('1정'/'1캡슐'/'5mg')에서 언어 무관 단위 키 추출. 모르면 null. */
export function dosageUnitFromRaw(dosage?: string | null): 'tablet' | 'capsule' | 'mg' | null {
  const trimmed = (dosage ?? '').trim();
  if (!trimmed) return null;
  if (/정$/.test(trimmed)) return 'tablet';
  if (/캡슐$/.test(trimmed)) return 'capsule';
  if (/mg$/i.test(trimmed)) return 'mg';
  return null;
}
