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
