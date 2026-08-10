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
 * 기기 국가 코드(BCP-47 region subtag, 예: 'US', 'CA', 'JP')를 반환.
 * getDeviceLanguage()와 같은 Intl 문자열에서 뽑는다 — 추가 API·권한 없음.
 * 감지 실패 시 빈 문자열(언어처럼 폴백 코드가 없음 — 국가는 모르면 그냥 모르는 채로 둔다).
 */
export function getDeviceCountry(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return extractRegion(locale);
  } catch {
    return '';
  }
}

/**
 * BCP-47 로케일 태그에서 지역(region) subtag만 대문자로 추출.
 * 'en-US' → 'US', 'zh-Hant-TW' → 'TW'(4자 스크립트 subtag는 건너뜀), 'ko-KR' → 'KR'.
 * 유효하지 않으면 빈 문자열.
 */
export function extractRegion(locale: unknown): string {
  if (typeof locale !== 'string' || locale.length === 0) return '';
  const parts = locale.split(/[-_]/);
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]?.trim() ?? '';
    if (/^[a-zA-Z]{2}$/.test(p)) return p.toUpperCase();
  }
  return '';
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

/** 지원 언어 → 화면 표기용 Intl 로케일 태그. */
const DISPLAY_TAGS: Record<SupportedLanguage, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  fr: 'fr-FR',
  ja: 'ja-JP',
};

/**
 * 날짜·시간을 화면에 그릴 때 쓸 Intl 로케일 태그.
 * 해외를 전부 'en-US' 로 고정하면 프랑스어 사용자가 앱은 프랑스어인데 날짜만
 * "Monday, July 27" 로 본다. 언어를 추가하면 위 표에 한 줄만 더하면 된다.
 *
 * ⚠️ 계산용으로 쓰지 말 것. Intl.DateTimeFormat 으로 연·월·일 조각을 뽑아
 *    다시 조립하는 코드(medUtils·timezone·notifActionFeedback)는 'en-US' 고정이라야
 *    파싱 결과가 안정적이다.
 */
export function displayLocaleTag(): string {
  const lang = getDeviceLanguage();
  return isSupportedLanguage(lang) ? DISPLAY_TAGS[lang] : DISPLAY_TAGS[FALLBACK_LANGUAGE];
}

/**
 * 약관·개인정보처리방침 등 웹 문서의 언어별 경로.
 *   ko → https://parkinon.com/terms
 *   그 외 → https://parkinon.com/terms/<lang>   (fr·ja·en 페이지가 실제로 있음)
 * 언어를 추가할 때 웹에 /<page>/<lang> 을 올리고 SUPPORTED_LANGUAGES 에만 넣으면
 * 여기 코드는 그대로 따라온다.
 */
export function legalDocUrl(page: 'terms' | 'privacy'): string {
  const lang = resolveInitialLanguage();
  return lang === KOREAN_CODE
    ? `https://parkinon.com/${page}`
    : `https://parkinon.com/${page}/${lang}`;
}
