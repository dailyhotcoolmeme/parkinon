/**
 * i18next 초기화 (Phase 2 · i18n 뼈대)
 *
 * 순수 JS(react-i18next + i18next)만 사용 → OTA 가능. 네이티브 모듈 없음.
 * 기기 언어는 detectLocale의 Intl 기반 감지로 결정한다(expo-localization 미사용).
 *
 * ⚠️ 국내 회귀 0: 이번 단계는 뼈대만 넣는다. 기존 하드코딩 한국어 문자열을
 * t()로 바꾸지 않으므로 앱 화면 동작은 그대로다. 초기 언어도 기기가 한국어면
 * ko라 국내 사용자에겐 아무 변화가 없다.
 *
 * 다국어 확장(예: ja 추가):
 *   1) src/i18n/locales/ja.json 파일 추가
 *   2) 아래 resources에 ja: { translation: ja } 한 줄 추가
 *   3) detectLocale.ts의 SUPPORTED_LANGUAGES에 'ja' 추가
 * → 그 외 변경 없이 자동 적용.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ko from './locales/ko.json';
import en from './locales/en.json';
import { resolveInitialLanguage, FALLBACK_LANGUAGE } from './detectLocale';

// 언어별 리소스. 새 언어는 여기에 한 줄씩만 추가하면 된다.
const resources = {
  ko: { translation: ko },
  en: { translation: en },
} as const;

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources,
      // 기기 언어가 지원 목록에 있으면 그 언어, 없으면 폴백(en).
      lng: resolveInitialLanguage(),
      fallbackLng: FALLBACK_LANGUAGE,
      // React Native/Hermes는 Intl.PluralRules를 지원하므로 v4 JSON 그대로 사용 가능.
      // 구형 런타임 이슈가 나오면 compatibilityJSON: 'v3'으로 낮출 수 있다.
      interpolation: {
        // React가 이미 XSS 이스케이프하므로 이중 이스케이프 방지.
        escapeValue: false,
      },
      returnNull: false,
    });
}

export default i18n;
