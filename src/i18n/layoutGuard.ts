/**
 * 레이아웃 넘침 가드 — 글자가 상자를 넘치면 잡아낸다.
 *
 * 왜 필요한가:
 *   번역이 길어져 버튼 밖으로 삐져나가는 사고("Vidéos enregistrées" 실측)는
 *   내 눈으로 축소 스크린샷을 봐서는 못 잡는다. 판정을 사람 눈에서 렌더러로 옮긴다.
 *   - onTextLayout: 각 줄이 실제로 차지한 폭 (렌더 결과, 추정 아님)
 *   - onLayout:     그 텍스트에 주어진 상자 폭
 *   줄 폭 > 상자 폭 이면 넘친 것이다.
 *
 * 동작:
 *   개발 빌드(__DEV__)에서만 Text.render 를 감싸 두 콜백을 주입한다.
 *   릴리즈 빌드에서는 아무 것도 하지 않는다.
 *
 * 로그 형식(수집 스크립트가 파싱):
 *   [넘침] "문구" 줄폭=W 상자=B (numberOfLines=N)
 *
 * 한계(정직하게):
 *   - adjustsFontSizeToFit 이 걸린 자리(탭바)는 자동 축소되므로 검사에서 뺀다.
 *   - flex 컨테이너가 줄바꿈을 허용하는 자리는 "2줄"이 정상일 수 있다 —
 *     넘침 판정은 numberOfLines 제한이 있거나, 줄 폭이 상자보다 실제로 클 때만.
 */
import React from 'react';
import { Text } from 'react-native';
import type { LayoutChangeEvent, NativeSyntheticEvent, TextLayoutEventData } from 'react-native';

const reported = new Set<string>();

export function installLayoutGuard(): void {
  if (!__DEV__) return;

  const TextAny = Text as unknown as { render?: (...args: unknown[]) => React.ReactElement };
  const original = TextAny.render;
  if (typeof original !== 'function') return;

  TextAny.render = function patchedRender(...args: unknown[]) {
    const props = (args[0] ?? {}) as Record<string, unknown>;

    // 자동 축소 자리는 넘칠 수 없다 — 제외.
    if (props.adjustsFontSizeToFit) return original.apply(this, args);

    // 텍스트별 측정값 보관(클로저) — 두 콜백이 서로 다른 시점에 온다.
    const state: { boxW?: number; lines?: TextLayoutEventData['lines'] } = {};

    const check = () => {
      if (state.boxW == null || !state.lines?.length) return;
      const maxLineW = Math.max(...state.lines.map((l) => l.width));
      // 1px 미만 오차는 렌더러 반올림 — 실제 잘림은 1px 이상 차이난다.
      if (maxLineW <= state.boxW + 1) return;

      const text = state.lines.map((l) => l.text).join('');
      const key = `${text}|${Math.round(maxLineW)}|${Math.round(state.boxW)}`;
      if (reported.has(key)) return;
      reported.add(key);
      const nol = (props.numberOfLines as number | undefined) ?? 0;
      console.error(
        `[넘침] ${JSON.stringify(text.slice(0, 80))} 줄폭=${Math.round(maxLineW)} 상자=${Math.round(state.boxW)} (numberOfLines=${nol})`,
      );
    };

    const userOnLayout = props.onLayout as ((e: LayoutChangeEvent) => void) | undefined;
    const userOnTextLayout = props.onTextLayout as
      | ((e: NativeSyntheticEvent<TextLayoutEventData>) => void)
      | undefined;

    const nextProps = {
      ...props,
      onLayout: (e: LayoutChangeEvent) => {
        state.boxW = e.nativeEvent.layout.width;
        check();
        userOnLayout?.(e);
      },
      onTextLayout: (e: NativeSyntheticEvent<TextLayoutEventData>) => {
        state.lines = e.nativeEvent.lines;
        check();
        userOnTextLayout?.(e);
      },
    };
    return original.apply(this, [nextProps, ...args.slice(1)]);
  };
}
