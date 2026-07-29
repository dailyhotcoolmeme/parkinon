/**
 * 로케일 판정 · 기능 게이트 유틸 (Phase 2 · i18n 뼈대)
 *
 * 기기 언어를 네이티브 모듈 없이 감지한다. 앱이 이미 Intl(ICU)을 사용하므로
 * (S1 타임존 감지도 Intl 기반) expo-localization 같은 네이티브 재빌드 없이
 * OTA로 동작한다. app.json plugins/permissions 변경 불필요.
 *
 * 이 파일은 "한국이면 국내 기능셋, 아니면 해외 기능셋" 판정을 캡슐화한다.
 * 로케일 게이트가 필요한 화면은 하드코딩된 한국 종속 대신 이 유틸을 쓴다.
 * (참고: docs/phase3_overseas_menu_plan.md — D1 로케일 판정)
 */

/** 앱이 리소스로 보유한(=번역 가능한) 언어. 새 언어 추가 시 여기에 코드만 추가. */
export const SUPPORTED_LANGUAGES = ['ko', 'en', 'fr', 'ja'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 폴백 언어. 지원하지 않는 기기 언어는 전부 여기로 수렴한다. */
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

/** 국내판 여부를 가르는 기준 언어(한국어). */
const KOREAN_CODE = 'ko';

/**
 * 기기 언어 코드(BCP-47의 primary subtag만, 예: 'ko', 'en', 'ja')를 반환.
 * Intl 실패·미감지 시 폴백('en').
 *
 * 주의: 여기서 반환하는 값은 "기기가 실제로 무슨 언어인지"이며,
 * SUPPORTED_LANGUAGES 밖의 값(예: 'ja', 'fr')도 그대로 나온다.
 * i18next에 넘길 초기 언어는 resolveInitialLanguage()를 쓴다.
 */
export function getDeviceLanguage(): string {
  try {
    // 예: 'ko-KR' → 'ko', 'en-US' → 'en', 'zh-Hant-TW' → 'zh'
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const primary = extractPrimaryLanguage(locale);
    return primary || FALLBACK_LANGUAGE;
  } catch {
    return FALLBACK_LANGUAGE;
  }
}

/**
 * BCP-47 로케일 태그에서 언어 primary subtag만 소문자로 추출.
 * 'ko-KR' → 'ko', 'EN_us' → 'en', 'zh-Hant-TW' → 'zh'.
 * 유효하지 않으면 빈 문자열.
 */
export function extractPrimaryLanguage(locale: unknown): string {
  if (typeof locale !== 'string' || locale.length === 0) return '';
  // 구분자는 '-'(표준) 또는 '_'(일부 플랫폼) 모두 허용.
  const first = locale.split(/[-_]/)[0]?.trim().toLowerCase() ?? '';
  // 언어 subtag는 알파벳 2~3자.
  return /^[a-z]{2,3}$/.test(first) ? first : '';
}

/**
 * i18next lng에 넘길 초기 언어를 결정.
 * 기기 언어가 지원 목록에 있으면 그 언어, 없으면 폴백('en').
 * (i18next의 fallbackLng와 별개로, 애초에 지원 언어만 lng로 넣어
 *  미지원 언어에서 키가 아니라 폴백 문자열이 뜨게 한다.)
 */
export function resolveInitialLanguage(): SupportedLanguage {
  const device = getDeviceLanguage();
  return isSupportedLanguage(device) ? device : FALLBACK_LANGUAGE;
}

/** 주어진 코드가 앱이 리소스를 보유한 지원 언어인지. */
export function isSupportedLanguage(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * 기기 언어가 한국어인가 = 국내판 여부.
 * 기능 게이트의 단일 기준점. "한국이면 국내 기능, 아니면 해외 기능셋".
 *
 * 사용 예:
 *   if (isKoreanLocale()) { // 약검색·처방전·운동영상 등 한국 특화 노출 }
 *   else { // 해외 기능셋(카카오 숨김, 이메일 문의 등) }
 */
export function isKoreanLocale(): boolean {
  return getDeviceLanguage() === KOREAN_CODE;
}

/**
 * 해외판 여부(= 국내판이 아님). isKoreanLocale()의 반대.
 * 가독성을 위해 게이트 코드에서 골라 쓸 수 있게 제공.
 */
export function isOverseasLocale(): boolean {
  return !isKoreanLocale();
}
