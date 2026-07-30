/**
 * 날짜·요일·월 이름 표기 — 단일 출처.
 *
 * 왜 모았나:
 *   화면마다 ['Sunday','Monday',…] / ['January',…] 같은 **영어 고정표**를 각자 들고 있었다.
 *   그 표는 영어뿐이라 프랑스어·일본어 사용자에게 영어가 그대로 나온다.
 *   Intl 에 맡기면 언어를 추가해도 이 파일을 고칠 일이 없다. (규칙 R3)
 *
 * ⚠️ 국내(ko)는 기존 표기를 100% 유지한다. 다만 그 한국어 문구는 코드가 아니라
 *    번역 파일(dateFmt.*)에 둔다 — 코드에 한글을 남기지 않는다(2026-07-30 오너 확정).
 *    표기 결과는 기존과 글자 그대로 같다.
 * ⚠️ 계산용(연·월·일 조각을 뽑아 다시 조립)에는 쓰지 말 것 — 그쪽은 'en-US' 고정이라야 안정적이다.
 */
import i18n from '../i18n';
import { isOverseasLocale, displayLocaleTag } from '../i18n/detectLocale';

function fmt(date: Date, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(displayLocaleTag(), opts).format(date);
  } catch {
    return '';
  }
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** '월요일' / 'Monday' / 'lundi' / '月曜日' */
export function weekdayLong(date: Date): string {
  if (!isOverseasLocale()) return i18n.t(`dateFmt.weekdayLong_${DAY_KEYS[date.getDay()]}`);
  return fmt(date, { weekday: 'long' });
}

/** '월' / 'Mon' / 'lun.' / '月' */
export function weekdayShort(date: Date): string {
  if (!isOverseasLocale()) return i18n.t(`dateFmt.weekdayShort_${DAY_KEYS[date.getDay()]}`);
  return fmt(date, { weekday: 'short' });
}

/** '2026년 7월' / 'July 2026' / 'juillet 2026' / '2026年7月' */
export function monthYearTitle(year: number, monthIndex: number): string {
  if (!isOverseasLocale()) {
    return i18n.t('dateFmt.monthYear', { year, month: monthIndex + 1 });
  }
  return fmt(new Date(year, monthIndex, 1), { month: 'long', year: 'numeric' });
}

/** '7월 29일 수요일' / 'July 29, Wednesday' 대신 로케일 표준 형식 */
export function monthDayWeekday(date: Date): string {
  if (!isOverseasLocale()) {
    return i18n.t('dateFmt.monthDayWeekday', {
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: weekdayLong(date),
    });
  }
  return fmt(date, { month: 'long', day: 'numeric', weekday: 'long' });
}

/** '7/29 (수)' / 'Jul 29 (Tue)' 류 짧은 표기 */
export function monthDayShort(date: Date): string {
  if (!isOverseasLocale()) {
    return i18n.t('dateFmt.monthDayShort', {
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: weekdayShort(date),
    });
  }
  return fmt(date, { month: 'short', day: 'numeric', weekday: 'short' });
}

/** '2026. 7. 29. (수)' 류 전체 날짜 */
export function fullDate(date: Date): string {
  if (!isOverseasLocale()) {
    return i18n.t('dateFmt.fullDate', {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: weekdayShort(date),
    });
  }
  return fmt(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}
