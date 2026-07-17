import { registerRootComponent } from 'expo';
import * as React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifee = require('@notifee/react-native').default;

import App from './App';

// ── 알람 포그라운드 서비스(소리 반복) ──────────────────────────────────────────
// "알람처럼"/"30초" 로컬 알람은 asForegroundService+loopSound 로 울린다. 이 러너가 서비스를
// 살아있게 유지 → 그동안 채널 소리가 반복 재생된다.
//   - sound30: 30초 후 stopForegroundService() 로 자동 종료.
//   - alarm  : 사용자가 AlarmScreen 버튼(→ stopActiveAlarm)으로 끌 때까지 유지.
//              (SHORT_SERVICE 시스템 상한 ~3분 도달 시 시스템이 자동 종료.)
notifee.registerForegroundService((notification: any) => {
  return new Promise((resolve) => {
    const mode = notification?.data?.alarmMode;
    if (mode === 'sound30') {
      setTimeout(() => {
        notifee.stopForegroundService().catch(() => {});
        resolve(undefined);
      }, 30000);
    }
    // 'alarm' → resolve 하지 않음(끌 때까지). stopForegroundService 호출 시 러너가 정리됨.
  });
});

// 백그라운드 이벤트 핸들러 — 등록만으로 백그라운드 알림 이벤트 크래시/경고 방지.
// 실제 전체화면 라우팅은 앱이 열릴 때 App.tsx 의 getInitialNotification 에서 처리한다.
notifee.onBackgroundEvent(async () => {});

// ── 시스템 폰트 스케일 전역 차단 (60대 이상 타겟 — iOS 글자 크기 키운 사용자 화면 깨짐 방지) ──
//
// ⚠️ React 19(RN 0.81, New Architecture)에서는 함수형 컴포넌트의 defaultProps 가 무시된다.
//    RN Text/TextInput 은 forwardRef 도 아닌 plain 함수 컴포넌트라 `.render` 오버라이드도 불가.
//    → 과거 `Text.defaultProps.allowFontScaling = false` 방식은 완전히 죽은 코드였고,
//      iOS Dynamic Type(설정 > 손쉬운 사용 > 텍스트 크기)이 앱 폰트를 그대로 배율로 키워
//      헤더가 늘어나거나 아이콘/버튼이 슬롯을 넘치는 레이아웃 붕괴가 발생했다.
//
// 해결: react-native 모듈의 Text/TextInput getter 를, allowFontScaling=false 를 기본으로
//       주입하는 래퍼로 교체한다. Metro 는 `import { Text }` 를 use-site 에서
//       `_reactNative.Text` 로 지연 접근하므로, 렌더 전에 모듈 객체를 패치하면 전 화면에 적용된다.
//       (개별 컴포넌트가 명시적으로 allowFontScaling 을 주면 그 값이 우선한다.)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isOverseasLocale } = require('./src/i18n/detectLocale');

// ── 해외(영어) 전역 글자크기 축소 ──────────────────────────────────────────────
// 영어는 한국어보다 문구가 길어 고정 박스에서 오버플로우/줄바꿈이 잦다. 텍스트를 자르지 않고
// (numberOfLines 같은 말줄임 금지 — 오너 규칙) **글자 크기만** 한 단계 낮춰 전문을 살린다.
//   - 과거엔 localeFontScale.ts 가 StyleSheet.create 만 패치 → 인라인 style={{fontSize}} 은 누락됐음.
//   - 이제 Text 래퍼에서 style 을 flatten 해 fontSize 를 스케일 → 인라인·StyleSheet 모두 1회 커버.
//     (StyleSheetExports.create 는 객체를 그대로 반환 → flatten 이 fontSize 를 그대로 해석. 검증됨.)
//   - localeFontScale 의 StyleSheet.create 패치는 이중 축소를 막으려 무력화한다(아래·해당 파일).
//   - 한국(주시장)은 OVERSEAS=false → flatten 자체를 건너뛰어 오버헤드 0.
const EN_FONT_SCALE = 0.82;
const MIN_FONT_SIZE = 11;
let OVERSEAS = false;
try {
  OVERSEAS = isOverseasLocale();
} catch {
  OVERSEAS = false;
}

function scaleFontInStyle(style: any): any {
  if (style == null) return style;
  const flat = RN.StyleSheet.flatten(style);
  if (!flat || typeof flat.fontSize !== 'number') return style;
  return {
    ...flat,
    fontSize: Math.max(Math.round(flat.fontSize * EN_FONT_SCALE), MIN_FONT_SIZE),
  };
}

function forceNoFontScaling(name: 'Text' | 'TextInput') {
  const Original = RN[name];
  if (!Original) return;
  const Wrapped = (props: any) => {
    const style = OVERSEAS ? scaleFontInStyle(props.style) : props.style;
    return React.createElement(Original, {
      allowFontScaling: false,
      maxFontSizeMultiplier: 1,
      ...props,
      style,
    });
  };
  Wrapped.displayName = name;
  // TextInput.State 등 정적 멤버 보존
  Object.assign(Wrapped, Original);
  try {
    Object.defineProperty(RN, name, {
      configurable: true,
      enumerable: true,
      get: () => Wrapped,
    });
  } catch {
    // getter 재정의 실패 시 조용히 무시 (레이아웃에만 영향)
  }
}

forceNoFontScaling('Text');
forceNoFontScaling('TextInput');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
