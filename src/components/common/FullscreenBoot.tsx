// FullscreenBoot — 통일 로딩 패턴 4
//
// 콜드 스타트(앱 초기 진입) 풀스크린 로딩.
// 그린(#4CAF50) 풀스크린 + 흰 심볼이 회전 + 흰 문구.
// (예전엔 파킨온 워드마크 로고 + 별도 링이었으나, 새 브랜드 심볼 회전으로 통일 —
//  국내·해외 공통. TopBar/BrandProgressOverlay 와 동일한 "흰 심볼 회전".)
//
// 사용: <FullscreenBoot message="파킨온을 준비하고 있어요" />

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LoadingTokens as T } from './loadingTokens';

// 텍스트 없는 흰 심볼(투명 배경) — 그린 풀스크린 위에서 흰 심볼만 보인다.
const SYMBOL = require('../../../assets/parkinon-symbol-en.png');

export interface FullscreenBootProps {
  message?: string;
}

export function FullscreenBoot({ message }: FullscreenBootProps) {
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const symbolStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.container}>
      <Animated.Image source={SYMBOL} style={[styles.symbol, symbolStyle]} resizeMode="contain" />
      {!!message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.green,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  symbol: {
    width: 96,
    height: 96,
  },
  message: {
    fontSize: T.titleSize,
    fontWeight: T.titleWeight,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
