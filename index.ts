import { registerRootComponent } from 'expo';
import { Text, TextInput } from 'react-native';

import App from './App';

// 시스템 폰트 스케일 전역 차단 (60대 이상 타겟 — 글자 크기 키운 사용자 화면 깨짐 방지)
// @ts-ignore
Text.defaultProps = Text.defaultProps || {};
// @ts-ignore
Text.defaultProps.allowFontScaling = false;
// @ts-ignore
Text.defaultProps.maxFontSizeMultiplier = 1;
// @ts-ignore
TextInput.defaultProps = TextInput.defaultProps || {};
// @ts-ignore
TextInput.defaultProps.allowFontScaling = false;
// @ts-ignore
TextInput.defaultProps.maxFontSizeMultiplier = 1;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
