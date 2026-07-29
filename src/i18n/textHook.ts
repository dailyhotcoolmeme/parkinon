/**
 * <Text> 렌더 후킹 — 검수 가드들이 공통으로 쓰는 단 하나의 지점.
 *
 * 왜 새로 만들었나(중요):
 *   원래 가드들은 `Text.render` 를 감쌌다. RN 0.7x 에서 Text 가 forwardRef 객체라
 *   `.render` 가 있었기 때문이다. **RN 0.81 부터 Text 는 평범한 함수 컴포넌트라
 *   `.render` 가 없다** — 그래서 가드가 조용히 아무 일도 하지 않고 있었다.
 *   (2026-07-30 발견. 가드가 켜져 있다는 근거가 사실은 비어 있었다.)
 *
 *   대신 JSX 생성 지점을 후킹한다. Metro/Babel 은 JSX 를
 *   `(0, _reactJsxDevRuntime.jsxDEV)(type, props, ...)` 로 컴파일하고, 이 호출은
 *   모듈 네임스페이스의 속성을 **호출 시점에** 찾는다. 그래서 런타임 객체의
 *   jsxDEV/jsx/jsxs 를 바꿔 끼우면 앱 전체의 JSX 가 걸린다.
 *
 * 개발 빌드 전용. 릴리즈에서는 아무 것도 하지 않는다.
 */
import React from 'react';
import { Text } from 'react-native';
import type { LayoutChangeEvent, NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
/* eslint-disable @typescript-eslint/no-var-requires */
const devRuntime = require('react/jsx-dev-runtime') as Record<string, unknown>;
const prodRuntime = require('react/jsx-runtime') as Record<string, unknown>;

export type OverflowInfo = {
  text: string;
  lineWidth: number;
  boxWidth: number;
  numberOfLines: number;
};

type TextListener = (text: string) => void;
type OverflowListener = (info: OverflowInfo) => void;

const textListeners: TextListener[] = [];
const overflowListeners: OverflowListener[] = [];
let installed = false;

export function onTextRendered(fn: TextListener): void {
  textListeners.push(fn);
  install();
}

export function onTextOverflow(fn: OverflowListener): void {
  overflowListeners.push(fn);
  install();
}

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

/** 넘침 판정을 위해 두 콜백을 끼워 넣은 새 props 를 만든다(원래 콜백은 보존). */
function instrument(props: Record<string, unknown>): Record<string, unknown> {
  if (props.adjustsFontSizeToFit) return props; // 자동 축소 자리는 넘칠 수 없다
  const state: { boxW?: number; lines?: TextLayoutEventData['lines'] } = {};

  const check = () => {
    if (state.boxW == null || !state.lines?.length) return;
    const lineWidth = Math.max(...state.lines.map((l) => l.width));
    if (lineWidth <= state.boxW + 1) return; // 1px 미만은 렌더러 반올림
    const text = state.lines.map((l) => l.text).join('');
    const info: OverflowInfo = {
      text,
      lineWidth: Math.round(lineWidth),
      boxWidth: Math.round(state.boxW),
      numberOfLines: (props.numberOfLines as number | undefined) ?? 0,
    };
    for (const fn of overflowListeners) fn(info);
  };

  const userOnLayout = props.onLayout as ((e: LayoutChangeEvent) => void) | undefined;
  const userOnTextLayout = props.onTextLayout as
    | ((e: NativeSyntheticEvent<TextLayoutEventData>) => void)
    | undefined;

  return {
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
}

function install(): void {
  if (installed || !__DEV__) return;
  installed = true;

  const patch = (mod: Record<string, unknown>, name: string): void => {
    const original = mod?.[name];
    if (typeof original !== 'function') return;
    const orig = original as (...a: unknown[]) => unknown;
    mod[name] = function hooked(...args: unknown[]) {
      try {
        if (args[0] === Text) {
          const props = (args[1] ?? {}) as Record<string, unknown>;
          if (textListeners.length) {
            const parts: string[] = [];
            collectText(props.children as React.ReactNode, parts);
            const joined = parts.join('').trim();
            if (joined) for (const fn of textListeners) fn(joined);
          }
          if (overflowListeners.length) args[1] = instrument(props);
        }
      } catch {
        // 후킹이 앱을 죽이면 안 된다.
      }
      return orig.apply(this, args);
    };
  };

  // Metro 는 정적 require 만 인라인한다 — 변수 spec 을 쓰면 번들 타임에 실패한다.
  for (const mod of [devRuntime, prodRuntime]) {
    if (!mod) continue;
    patch(mod, 'jsxDEV');
    patch(mod, 'jsx');
    patch(mod, 'jsxs');
  }
  // 구형 경로(React.createElement)도 함께 막아둔다.
  patch(React as unknown as Record<string, unknown>, 'createElement');
}
