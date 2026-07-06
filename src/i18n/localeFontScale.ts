/**
 * 영어 폰트 축소 패치 (Phase 2 · i18n)
 *
 * 한국어 대비 영어 UI 문구가 길어 고정 폭/높이 박스에서 줄바꿈·오버플로우가
 * 자주 발생한다(오너 리포트: 2026-07-06, 애플 로그인 후 온보딩 다수 화면).
 * 화면마다 레이아웃을 손보는 대신, StyleSheet.create를 한 곳에서 패치해
 * 해외 로케일에서 모든 fontSize를 일괄로 한 단계 낮춘다.
 *
 * `StyleSheet.create(...)`로 선언된 스타일에만 적용됨. JSX 인라인
 * `style={{ fontSize: n }}`은 이 패치를 타지 않는다(코드베이스 내 소수 사례).
 */
import { StyleSheet } from 'react-native';
import { isOverseasLocale } from './detectLocale';

const EN_FONT_SCALE = 0.88;
const MIN_FONT_SIZE = 11;
const PATCH_FLAG = '__parkinonEnFontScalePatched';

function scaleFontSize(size: number): number {
  return Math.max(Math.round(size * EN_FONT_SCALE), MIN_FONT_SIZE);
}

function scaleStyleValue(style: unknown): unknown {
  if (
    style != null &&
    typeof style === 'object' &&
    typeof (style as { fontSize?: unknown }).fontSize === 'number'
  ) {
    return {
      ...style,
      fontSize: scaleFontSize((style as { fontSize: number }).fontSize),
    };
  }
  return style;
}

type NamedStyles<T> = { [P in keyof T]: T[P] };

if (isOverseasLocale() && !(StyleSheet as unknown as Record<string, boolean>)[PATCH_FLAG]) {
  const originalCreate = StyleSheet.create;

  StyleSheet.create = function scaledCreate<T extends NamedStyles<T>>(styles: T): T {
    const scaled = {} as T;
    for (const key of Object.keys(styles) as Array<keyof T>) {
      scaled[key] = scaleStyleValue(styles[key]) as T[typeof key];
    }
    return originalCreate(scaled);
  } as typeof StyleSheet.create;

  (StyleSheet as unknown as Record<string, boolean>)[PATCH_FLAG] = true;
}
