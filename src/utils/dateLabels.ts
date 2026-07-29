/**
 * 날짜·요일·월 이름 표기 — 단일 출처.
 *
 * 왜 모았나:
 *   화면마다 ['Sunday','Monday',…] / ['January',…] 같은 **영어 고정표**를 각자 들고 있었다.
 *   그 표는 영어뿐이라 프랑스어·일본어 사용자에게 영어가 그대로 나온다.
 *   Intl 에 맡기면 언어를 추가해도 이 파일을 고칠 일이 없다. (규칙 R3)
 *
 * ⚠️ 국내(ko)는 기존 표기를 100% 유지한다. 여기서 바꾸지 않는다.
 * ⚠️ 계산용(연·월·일 조각을 뽑아 다시 조립)에는 쓰지 말 것 — 그쪽은 'en-US' 고정이라야 안정적이다.
 */
import { isOverseasLocale, displayLocaleTag } from '../i18n/detectLocale';

function fmt(date: Date, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(displayLocaleTag(), opts).format(date);
  } catch {
    return '';
  }
}

const KO_WEEKDAY_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const KO_WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

/** '월요일' / 'Monday' / 'lundi' / '月曜日' */
export function weekdayLong(date: Date): string {
  if (!isOverseasLocale()) return KO_WEEKDAY_FULL[date.getDay()];
  return fmt(date, { weekday: 'long' });
}

/** '월' / 'Mon' / 'lun.' / '月' */
export function weekdayShort(date: Date): string {
  if (!isOverseasLocale()) return KO_WEEKDAY_SHORT[date.getDay()];
  return fmt(date, { weekday: 'short' });
}

/** '2026년 7월' / 'July 2026' / 'juillet 2026' / '2026年7月' */
export function monthYearTitle(year: number, monthIndex: number): string {
  if (!isOverseasLocale()) return `${year}년 ${monthIndex + 1}월`;
  return fmt(new Date(year, monthIndex, 1), { month: 'long', year: 'numeric' });
}

/** '7월 29일 수요일' / 'July 29, Wednesday' 대신 로케일 표준 형식 */
export function monthDayWeekday(date: Date): string {
  if (!isOverseasLocale()) {
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${KO_WEEKDAY_FULL[date.getDay()]}`;
  }
  return fmt(date, { month: 'long', day: 'numeric', weekday: 'long' });
}

/** '7/29 (수)' / 'Jul 29 (Tue)' 류 짧은 표기 */
export function monthDayShort(date: Date): string {
  if (!isOverseasLocale()) {
    return `${date.getMonth() + 1}/${date.getDate()} (${KO_WEEKDAY_SHORT[date.getDay()]})`;
  }
  return fmt(date, { month: 'short', day: 'numeric', weekday: 'short' });
}

/** '2026. 7. 29. (수)' 류 전체 날짜 */
export function fullDate(date: Date): string {
  if (!isOverseasLocale()) {
    return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. (${KO_WEEKDAY_SHORT[date.getDay()]})`;
  }
  return fmt(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}
