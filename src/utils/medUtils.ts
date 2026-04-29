// KST(UTC+9) 기준 오늘 날짜 문자열 반환 (YYYY-MM-DD)
export function getKSTToday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

// KST 기준 날짜의 시작/끝 ISO 문자열 (Supabase 쿼리용)
export function getKSTDayRange(dateStr: string): { start: string; end: string } {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59.999+09:00`,
  };
}

export function minutesToLabel(m: number): string {
  if (m === 0) return '복용 직후';
  if (m < 60) return `${m}분 후`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`;
}

/**
 * trigger_time_label → 표시용 짧은 태그 (예: '+2시간', '+30분', '+즉시')
 */
export function triggerLabelToTag(label: string | null | undefined): string {
  if (!label) return '';
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
 */
export function mealTimeToKorean(mealTime: string | null | undefined): string {
  if (!mealTime) return '';
  const map: Record<string, string> = {
    morning: '아침약',
    lunch: '점심약',
    dinner: '저녁약',
    bedtime: '취침약',
  };
  return map[mealTime] ?? mealTime;
}

/**
 * medication_meal_time → 한국어 시간대 이름 (예: 'dinner' → '저녁')
 */
export function mealTimeToPeriod(mealTime: string | null | undefined): string {
  if (!mealTime) return '';
  const map: Record<string, string> = {
    morning: '아침',
    lunch: '점심',
    dinner: '저녁',
    bedtime: '취침',
  };
  return map[mealTime] ?? mealTime;
}
