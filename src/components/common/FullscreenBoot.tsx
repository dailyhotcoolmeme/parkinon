// FullscreenBoot — 통일 로딩 패턴 4
//
// 콜드 스타트(앱 초기 진입) 풀스크린 로딩.
// 그린(#4CAF50) 풀스크린 + 흰 로고 + 흰 링 스피너(2px, 0.8s linear) + 흰 문구.
//
// 사용: <FullscreenBoot message="파킨온을 준비하고 있어요" />

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LoadingTokens as T } from './loadingTokens';
import { getBrandLogo } from '../../utils/brandLogo';

const LOGO = getBrandLogo();

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

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.container}>
      <Image source={LOGO} style={styles.logo} resizeMode="contain" />
      <Animated.View style={[styles.ring, ringStyle]} />
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
  logo: {
    // parkinon-logo는 배경이 #4CB051(≈#4CAF50)이라 그린 풀스크린에 자연스럽게 녹아
    // 흰 심볼+워드마크만 보인다. 별도 틴트 불필요.
    width: 160,
    height: 160,
  },
  ring: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    borderTopColor: '#FFFFFF',
  },
  message: {
    fontSize: T.titleSize,
    fontWeight: T.titleWeight,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
