// SkeletonCard / Shimmer — 통일 로딩 패턴 2
//
// 목록·카드형 데이터 페치 동안 회색 골격 카드를 보여준다.
// base #EFEFEF, 하이라이트 #F7F7F7, shimmer 좌→우 1.4s linear 무한.
// 카드 간 80ms stagger, 표시 delay 200ms(그보다 짧으면 생략).
//
// 사용:
//   <SkeletonList count={4} />            // 기본 목록형
//   <SkeletonCard index={0} />           // 단일 카드
//   <Shimmer style={{ width: 120, height: 16 }} />  // 인라인 블록

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

const BASE = '#EFEFEF';
const HIGHLIGHT = '#F7F7F7';
const SHIMMER_DURATION = 1400;
const STAGGER = 80;
const SHOW_DELAY = 200;

// ── 단일 shimmer 블록 ─────────────────────────────
export function Shimmer({
  style,
  delay = 0,
}: {
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const t = useSharedValue(0);
  const width = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: SHIMMER_DURATION, easing: Easing.linear }),
        -1,
        false,
      ),
    );
  }, [delay]);

  // 하이라이트 띠를 좌(-w) → 우(+w)로 통과시킨다 (픽셀 단위, 측정 기반)
  const highlightStyle = useAnimatedStyle(() => {
    const w = width.value || 0;
    return {
      transform: [{ translateX: (t.value * 2 - 1) * w }],
    };
  });

  return (
    <View
      style={[styles.block, style]}
      onLayout={(e) => {
        width.value = e.nativeEvent.layout.width;
      }}
    >
      <Animated.View style={[styles.highlight, highlightStyle]} />
    </View>
  );
}

// ── 골격 카드 ─────────────────────────────────────
export function SkeletonCard({
  index = 0,
  style,
}: {
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const delay = index * STAGGER;
  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <Shimmer style={styles.avatar} delay={delay} />
        <View style={styles.rowText}>
          <Shimmer style={styles.lineLg} delay={delay} />
          <Shimmer style={styles.lineSm} delay={delay} />
        </View>
      </View>
      <Shimmer style={styles.lineFull} delay={delay} />
    </View>
  );
}

// ── 목록형 (delay 200ms 게이트 내장) ───────────────
export function SkeletonList({
  count = 4,
  visible = true,
  style,
}: {
  count?: number;
  /** 부모 로딩 상태 — false면 즉시 숨김 */
  visible?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // 표시 delay 200ms — 그보다 빨리 끝나면 깜빡임 방지로 아예 안 보여줌
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!visible) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), SHOW_DELAY);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible || !show) return null;

  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: BASE,
    borderRadius: 8,
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '60%',
    backgroundColor: HIGHLIGHT,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 8,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  lineLg: {
    width: '70%',
    height: 16,
    borderRadius: 8,
  },
  lineSm: {
    width: '45%',
    height: 12,
    borderRadius: 6,
  },
  lineFull: {
    width: '100%',
    height: 14,
    borderRadius: 7,
  },
});
