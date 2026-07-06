/**
 * 타임존 유틸 (Phase 1 · S1)
 *
 * 기기의 IANA 타임존을 네이티브 모듈 없이 감지한다.
 * 앱이 이미 toLocaleDateString('ko-KR', …) 등을 사용하므로 런타임 ICU/Intl이
 * 활성화되어 있어 expo-localization(네이티브 재빌드) 없이 OTA로 동작한다.
 *
 * 이 단계는 감지·저장만 담당한다. 서버 알림/화면 하루경계 로직은 아직
 * timezone을 사용하지 않으므로 국내·해외 모두 현재 동작 그대로다(회귀 0).
 */

const FALLBACK_TZ = 'Asia/Seoul';

/**
 * 기기 IANA 타임존을 반환. 감지 불가/오류 시 'Asia/Seoul'로 폴백.
 * 명백히 유효한 IANA 문자열만 반환한다(예: 'Asia/Seoul', 'America/New_York').
 */
export function getDeviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidIanaTimeZone(tz) ? tz : FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

/**
 * IANA 타임존 문자열의 최소 유효성 검사.
 * - 빈값/비문자열 거부.
 * - 'UTC'는 허용, 그 외에는 'Area/Location' 형태(슬래시 포함)만 허용해
 *   기기가 내주는 이상값(예: 오프셋 문자열)이 저장되는 것을 막는다.
 * - 가능하면 Intl로 실제 인식되는 존인지까지 확인한다.
 */
export function isValidIanaTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  if (tz !== 'UTC' && !tz.includes('/')) return false;
  try {
    // 유효하지 않은 존이면 RangeError를 던진다.
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
