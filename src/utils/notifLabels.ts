/**
 * "다음 알림" 카드에 쓰이는 라벨 — 단일 출처.
 *
 * 왜 모았나:
 *   약복용·약효추적·운동 세 화면이 같은 로직을 각자 복사해서 쓰고 있었다.
 *   그러다 운동 화면에서 DB 원본 라벨(한글 '아침')을 그대로 붙여
 *   프랑스어 사용자에게 "Next 아침" 이 나갔다.
 *   문구를 만드는 곳을 한 곳으로 모아야 같은 사고가 다시 안 난다. (규칙 R4)
 *
 * ⚠️ 새 화면에서 "다음 알림" 문구가 필요하면 여기 함수를 쓴다. 새로 만들지 않는다.
 */
import i18n from '../i18n';
import { isOverseasLocale, displayLocaleTag } from '../i18n/detectLocale';
import { nextDoseLabel, translateRawSlotLabel, type LegacyMealKey } from '../constants/doseSlots';

/** Date → 화면 표기용 시각. 국내는 '오전 8:00', 해외는 로케일 형식(Intl). */
export function formatClock(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  if (isOverseasLocale()) {
    try {
      return new Intl.DateTimeFormat(displayLocaleTag(), { hour: 'numeric', minute: '2-digit' }).format(date);
    } catch {
      /* Intl 실패 시 아래 국내 포맷으로 폴백 */
    }
  }
  const hour = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, '0');
  return isOverseasLocale() ? `${hour}:${mm}` : `${h < 12 ? '오전' : '오후'} ${hour}:${mm}`;
}

/** 약효추적 간격(분) → "복용 30분 후" 류. */
export function intervalAfterLabel(intervalMin: number): string {
  if (intervalMin === 0) return i18n.t('nextNotif.intervalRightAfter');
  if (intervalMin < 60) return i18n.t('nextNotif.intervalAfterMin', { m: intervalMin });
  const h = Math.floor(intervalMin / 60);
  const rem = intervalMin % 60;
  return rem === 0
    ? i18n.t('nextNotif.intervalAfterHour', { h })
    : i18n.t('nextNotif.intervalAfterHourMin', { h, m: rem });
}

/** "{시간대} {간격} 약효추적". meal 은 DB 원본일 수 있어 반드시 변환을 거친다. */
export function effectTrackingLabel(rawMeal: string | null | undefined, intervalLabel: string): string {
  const meal = translateRawSlotLabel(rawMeal) ?? (rawMeal ?? '').trim();
  return meal
    ? i18n.t('nextNotif.effectTrack', { meal, interval: intervalLabel })
    : i18n.t('nextNotif.effectTrackNoMeal', { interval: intervalLabel });
}

/**
 * "다음 아침약 복용" 류.
 * 공용 nextDoseLabel 로 위임한다 — 화면마다 자기 버전을 만들지 않는다.
 * (자기 버전을 만든 게 '아침' 사고의 원인이었다.)
 */
export function nextDoseLabelLoc(
  legacyKey: LegacyMealKey | null | undefined,
  label: string | null | undefined,
  time: string | null | undefined,
): string {
  return nextDoseLabel(legacyKey, label, time);
}

/** "내일 …" 접두. */
export function tomorrowLabel(base: string): string {
  return i18n.t('nextNotif.tomorrow', { label: base });
}

export function exerciseReminderLabel(): string {
  return i18n.t('nextNotif.exerciseReminder');
}

export function tomorrowMorningDoseLabel(): string {
  return i18n.t('nextNotif.tomorrowMorningDose');
}

/** 운동 시간(분) → "20분" / "20 min". */
export function durationLabel(min: number): string {
  if (min < 60) return i18n.t('nextNotif.durationMin', { m: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? i18n.t('nextNotif.durationHourMin', { h, m }) : i18n.t('nextNotif.durationHour', { h });
}

/** 짧은 간격 표현 (0→"직후", 30→"30분 후"). 목록·태그용. */
export function intervalShortLabel(min: number): string {
  if (min === 0) return i18n.t('interval.short');
  if (min < 60) return i18n.t('interval.shortMin', { m: min });
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? i18n.t('interval.shortHour', { h }) : i18n.t('interval.shortHourMin', { h, m: rem });
}

/** 경과·잔여 시간 (20→"20분", 90→"1시간 30분"). */
export function elapsedLabel(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  if (m < 60) return i18n.t('interval.elapsedMin', { m });
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? i18n.t('interval.elapsedHour', { h }) : i18n.t('interval.elapsedHourMin', { h, m: rem });
}

/** 내부 시간대 키('아침' 등) → 표시용. 색·아이콘 조회 키는 그대로 두고 표시만 바꾼다. */
export function periodKeyToLabel(periodKey: string): string {
  const map: Record<string, string> = {
    '새벽': 'period.dawn', '아침': 'period.morning', '점심': 'period.midday',
    '오후': 'period.afternoon', '저녁': 'period.evening', '밤': 'period.night',
    '취침': 'slot.bedtime',
  };
  const key = map[periodKey];
  if (!key) return periodKey;
  return isOverseasLocale() ? i18n.t(key) : periodKey;
}
