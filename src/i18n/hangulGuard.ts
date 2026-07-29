/**
 * 한글 노출 가드 — 해외 언어에서 한글이 화면에 그려지면 잡아낸다.
 *
 * 왜 필요한가:
 *   번역 누락은 fallbackLng='en' 이 받아주므로 최악이라도 영어가 나온다(검증 완료).
 *   진짜 위험은 i18n 을 안 거치고 코드에 박힌 한글이다. 이건 언어와 무관하게
 *   그대로 렌더되므로, 해외 사용자에게 한글이 보이는 사고가 된다.
 *   소스에서 문자열을 훑는 방식은 내부 식별자(예: type Period = '이번 주')와
 *   실제 표시 문자열을 구분하지 못해 오탐이 많다. 그래서 "실제로 <Text> 에 그려진
 *   문자열"만 런타임에 검사한다 — 판단이 필요 없고 놓칠 수도 없다.
 *
 * 동작:
 *   개발 빌드(__DEV__)에서만 Text 를 감싸 자식 문자열을 검사한다.
 *   릴리즈 빌드에서는 아무 것도 하지 않는다(성능·안전).
 */
import React from 'react';
import { Text } from 'react-native';
import { isKoreanLocale } from './detectLocale';

const HANGUL = /[가-힣]/;

/** 이미 보고한 문자열 — 렌더마다 반복 출력되는 걸 막는다. */
const reported = new Set<string>();

function collectText(node: React.ReactNode, out: string[]): void {
  if (node == null || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectText(n, out);
    return;
  }
  if (React.isValidElement(node)) {
    collectText((node.props as { children?: React.ReactNode })?.children, out);
  }
}

export function installHangulGuard(): void {
  // 국내 사용자는 당연히 한글이므로 검사 대상이 아니다.
  if (!__DEV__ || isKoreanLocale()) return;

  const TextAny = Text as unknown as { render?: (...args: unknown[]) => React.ReactElement };
  const original = TextAny.render;
  if (typeof original !== 'function') return; // RN 내부 구조가 바뀌면 조용히 포기

  TextAny.render = function patchedRender(...args: unknown[]) {
    const element = original.apply(this, args);
    try {
      const props = args[0] as { children?: React.ReactNode } | undefined;
      const parts: string[] = [];
      collectText(props?.children, parts);
      const joined = parts.join('');
      if (HANGUL.test(joined) && !reported.has(joined)) {
        reported.add(joined);
        console.error(
          `[한글노출] 해외 언어인데 화면에 한글이 그려졌습니다: ${JSON.stringify(joined.slice(0, 120))}`,
        );
      }
    } catch {
      // 가드 자체가 앱을 죽이면 안 된다.
    }
    return element;
  };
}
