// ButtonSpinner — 통일 로딩 패턴 1 (인라인 버튼 스피너)
//
// 버튼 라벨은 유지하고 버튼은 disabled 처리한 채, 라벨 옆에 작은 링 스피너를
// 둔다. 18px / 2px 링 / 트랙 rgba(255,255,255,0.3) / 0.8s linear.
//
// 사용:
//   <PrimaryButton disabled={busy} ...>
//     {busy && <ButtonSpinner />}
//     <Text>저장</Text>
//   </PrimaryButton>

import React, { useEffect } from 'react';
import { StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

export function ButtonSpinner({
  /** 링·트랙 색 (기본: 흰 버튼 기준) */
  color = '#FFFFFF',
  size = 18,
  style,
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
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
    <Animated.View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: 'rgba(255,255,255,0.3)',
          borderTopColor: color,
        },
        ringStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 2,
  },
});
