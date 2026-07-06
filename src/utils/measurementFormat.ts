// 디지털 바이오마커 — 표시용 포맷 헬퍼
//
// 반응속도(ms) → 사람이 읽기 쉬운 "0.32초 (320ms)" 형식.
// 그래프 막대의 수치 계산은 ms 그대로 사용하고, 라벨/텍스트에서만 이 함수 사용.
import i18n from '../i18n';

function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

/**
 * ms → "0.32초 (320ms)" 형식 문자열.
 * - seconds는 소수 2자리 고정.
 * - 음수/비유한값/null은 "–" 반환.
 * - msValue는 round해서 표시(원본이 소수면 정수로).
 */
export function formatReactionMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '–';
  }
  const ms = Math.round(value as number);
  const seconds = (ms / 1000).toFixed(2);
  return isEnLocale() ? `${seconds}s (${ms}ms)` : `${seconds}초 (${ms}ms)`;
}

// 요일 한 글자 — Date.getDay() 인덱스 기준 (0=일 ~ 6=토)
const WEEKDAYS_KO: readonly string[] = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS_EN: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * ISO 시각 → "YYYY-MM-DD(요일) HH:MM" (로컬 시각, 24시간제).
 * 예) "2026-05-25(월) 20:32"
 * 잘못된 입력은 빈 문자열 반환.
 */
export function formatDateTimeWithWeekday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const w = (isEnLocale() ? WEEKDAYS_EN : WEEKDAYS_KO)[d.getDay()] ?? '';
  return `${y}-${mo}-${da}(${w}) ${h}:${mi}`;
}
