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
 *   개발 빌드(__DEV__)에서만 <Text> 렌더를 후킹해 자식 문자열을 검사한다.
 *   후킹은 textHook.ts 가 담당한다 — RN 0.81 에서 Text.render 가 사라져
 *   기존 방식이 조용히 무력화돼 있었다(2026-07-30 발견).
 */
import { isKoreanLocale } from './detectLocale';
import { onTextRendered } from './textHook';
import { qaEvent } from './qaProbe';

const HANGUL = /[가-힣]/;

/** 이미 보고한 문자열 — 렌더마다 반복 출력되는 걸 막는다. */
const reported = new Set<string>();

export function installHangulGuard(): void {
  // 국내 사용자는 당연히 한글이므로 검사 대상이 아니다.
  if (!__DEV__ || isKoreanLocale()) return;

  onTextRendered((text) => {
    if (!HANGUL.test(text) || reported.has(text)) return;
    reported.add(text);
    console.error(
      `[한글노출] 해외 언어인데 화면에 한글이 그려졌습니다: ${JSON.stringify(text.slice(0, 120))}`,
    );
    qaEvent({ type: 'hangul', text: text.slice(0, 200) });
  });
}
