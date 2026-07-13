// BrandProgressOverlay — 통일 로딩 패턴 3
//
// 무겁거나 중간 길이의 차단 작업(웹 토큰 발급, 측정 결과 정리 등)에서
// 화면을 덮는 모달. 흰 카드 안에 파킨온 심볼 펄스 + 타이틀 + 불확정
// 프로그레스 바 + (옵션) 스텝 인디케이터 + (옵션) 경과 보조문구 +
// (완료 시) 체크 서클.
//
// 사용:
//   <BrandProgressOverlay visible={loading}
//     title="웹 화면을 준비하고 있어요" subtitle="곧 브라우저가 열려요" />

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Vibration,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { LoadingTokens as T, standardEasing } from './loadingTokens';
import { useTranslation } from 'react-i18next';

// 톱바(TopBar.tsx symbolBadge)와 동일한 심볼(텍스트 없는 흰 아이콘) + 초록 배지.
// 예전엔 getBrandLogo()(텍스트 워드마크 박힌 정사각 로고)를 48x48로 cover 해서
// 작은 배지 안에 글자가 뭉개져 보였다 — 부트 스플래시(FullscreenBoot)는 큰 워드마크가
// 맞지만, 이 좁은 진행 배지엔 톱바처럼 심볼만 쓰는 게 맞다.
const SYMBOL_LOGO = require('../../../assets/parkinon-symbol-en.png');

export interface BrandProgressOverlayProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** 스텝 인디케이터 (예: ['업로드', '분석', '저장']) */
  steps?: string[];
  /** 현재 진행 중인 스텝 인덱스 (0-base) */
  currentStep?: number;
  /** 완료 상태 — 체크 서클 표시 + 짧은 햅틱 */
  done?: boolean;
  /**
   * 최소 표시 시간(ms). visible이 true가 된 뒤 이 시간 동안은
   * visible이 false로 바뀌어도 계속 표시(번쩍임 방지). 기본 0(현행 유지).
   */
  minVisibleMs?: number;
  /**
   * 오버레이(Modal)가 화면에서 "완전히 사라진 뒤" 1회 호출된다.
   * - iOS: RN Modal의 네이티브 onDismiss(닫힘 애니메이션 완료 후) 사용 → 가장 정확.
   * - Android: Modal에 onDismiss가 없어 fade-out 시간(안전 350ms) 후 폴백 호출.
   * 이 콜백이 불린 시점에는 이 Modal이 확실히 내려가 있으므로,
   * 여기서 다른 Modal(AppDialog 등)을 present해도 두 Modal이 적층되지 않는다.
   * (무한 스피너/알림 미표시 = 닫히는 Modal 위에 새 Modal을 올린 hang 방지)
   */
  onHidden?: () => void;
}

const BAR_WIDTH = 200; // w180~220 중앙값
const BAR_HEAD = BAR_WIDTH * 0.4; // 헤드 40% 폭

// 스피너 팝업 뒤 배경 딤(scrim) — 오너 요청: 뒤 화면이 흐릿하게/어둡게 비치도록.
// 진짜 가우시안 블러(expo-blur 등)는 현재 빌드에 미포함된 네이티브 모듈이라
// OTA로 넣으면 런타임 크래시 → 사용 금지. 대신 반투명 검정 딤으로 "흐릿한" 느낌만 준다.
// 카드는 불투명 흰색이라 이 딤 위에서 또렷하게 보임(60대 가독성 유지).
const SCRIM = 'rgba(17,17,17,0.45)';

export function BrandProgressOverlay({
  visible,
  title,
  subtitle,
  steps,
  currentStep = 0,
  done = false,
  minVisibleMs = 0,
  onHidden,
}: BrandProgressOverlayProps) {
  const { t } = useTranslation();
  const { width: screenW } = useWindowDimensions();

  // 최소 표시 시간 보장용 — 실제 화면 표시 여부
  const [effectiveVisible, setEffectiveVisible] = useState(visible);
  const showAtRef = React.useRef<number>(0);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // onHidden 1회 호출 보장(같은 닫힘 사이클에서 iOS native + 폴백 중복 방지)
  const onHiddenRef = React.useRef(onHidden);
  onHiddenRef.current = onHidden;
  const hiddenFiredRef = React.useRef(false);
  const prevEffectiveRef = React.useRef(effectiveVisible);

  // effectiveVisible true→false 전이 감지. 안드로이드는 Modal onDismiss가 없으므로
  // fade-out(animationType="fade") 시간을 충분히 넘긴 폴백 타이머로 onHidden을 보장한다.
  // iOS는 아래 Modal의 onDismiss(네이티브, 닫힘 애니 완료 후)가 더 정확하게 처리한다.
  useEffect(() => {
    const prev = prevEffectiveRef.current;
    prevEffectiveRef.current = effectiveVisible;
    if (effectiveVisible) {
      // 다시 떠 있는 상태 → 다음 닫힘을 위해 플래그 리셋
      hiddenFiredRef.current = false;
      return;
    }
    if (prev && !effectiveVisible) {
      // 이제 Modal이 아니라 View라 onDismiss가 없으므로 양 플랫폼 모두 폴백 타이머로 onHidden 1회 보장.
      const t = setTimeout(() => {
        if (!hiddenFiredRef.current) {
          hiddenFiredRef.current = true;
          onHiddenRef.current?.();
        }
      }, 200);
      return () => clearTimeout(t);
    }
  }, [effectiveVisible]);

  useEffect(() => {
    if (visible) {
      // 켜질 땐 즉시 표시 + 표시 시각 기록, 대기 중이던 끄기 타이머 취소
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      showAtRef.current = Date.now();
      setEffectiveVisible(true);
    } else {
      const elapsed = Date.now() - showAtRef.current;
      const remaining = minVisibleMs - elapsed;
      if (remaining > 0) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setEffectiveVisible(false);
          hideTimerRef.current = null;
        }, remaining);
      } else {
        setEffectiveVisible(false);
      }
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [visible, minVisibleMs]);

  // 진입 fade + rise
  const enter = useSharedValue(0);
  // 심볼 펄스
  const pulse = useSharedValue(0);
  // 불확정 바 헤드 위치 (0↔1 왕복)
  const barPos = useSharedValue(0);
  // 완료 체크 서클
  const check = useSharedValue(0);

  // 경과 10초 보조문구
  const [elapsedHint, setElapsedHint] = useState(false);

  useEffect(() => {
    if (effectiveVisible) {
      enter.value = withTiming(1, { duration: T.enterDuration, easing: standardEasing });
      // 심볼 회전(연속·등속). 커지는 펄스 대신 다른 로딩 아이콘과 동일하게 회전만.
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, { duration: 2500, easing: Easing.linear }),
        -1,
        false,
      );
      // ⚠️ reverse 모드(withRepeat(..., -1, true))는 Reanimated 4/새아키텍처에서 끝(1)에 도달 후
      //    되돌아오지 않고 멈추는 경우가 있다("녹색 바 왔다갔다 하다 멈춤" 오너 보고, iOS).
      //    → 0→1→0 을 withSequence 로 명시해 확실히 왕복시킨다.
      barPos.value = 0;
      barPos.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: standardEasing }),
          withTiming(0, { duration: 1200, easing: standardEasing }),
        ),
        -1,
        false,
      );
      const timer = setTimeout(() => setElapsedHint(true), 10000);
      return () => {
        clearTimeout(timer);
      };
    } else {
      enter.value = 0;
      check.value = 0;
      setElapsedHint(false);
      cancelAnimation(pulse);
      cancelAnimation(barPos);
    }
  }, [effectiveVisible]);

  useEffect(() => {
    if (done) {
      check.value = withSpring(1, { damping: 12, stiffness: 180, mass: 0.6 });
      // 짧은 햅틱 (네이티브 모듈 없이 RN 내장 Vibration)
      Vibration.vibrate(15);
    } else {
      check.value = 0;
    }
  }, [done]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * T.enterRise }],
  }));

  const symbolStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${pulse.value * 360}deg` }],
  }));

  const barW = Math.min(BAR_WIDTH, screenW - T.cardPadding * 2 - 48);

  const barHeadStyle = useAnimatedStyle(() => ({
    // 헤드가 트랙 폭 안에서만 좌↔우 왕복하도록 클램프된 barW 기준
    transform: [{ translateX: barPos.value * (barW - BAR_HEAD) }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: 0.6 + check.value * 0.4 }],
  }));

  // ⚠️ 더 이상 <Modal> 이 아니다 — 로딩 오버레이가 Modal이면 iOS에서 dialog(AppDialog=Modal)와
  //    적층 충돌해 "안 보이는 오버레이가 남아 스크롤이 막히는" 멈춤을 유발했다(오너 보고·잦음,
  //    MedicationScreen 주석에도 문서화됨). 전체화면 절대배치 View로 바꾸면 dialog(Modal)는 이 위에
  //    정상 표시되고, 스피너와 다이얼로그가 꼬여 잔류하는 일이 원천적으로 없다.
  if (!effectiveVisible) return null;
  return (
    <View style={styles.fullscreen} pointerEvents="auto">
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, cardStyle]}>
          {/* 심볼 펄스 / 완료 시 체크 서클 */}
          <View style={styles.symbolSlot}>
            {done ? (
              <Animated.View style={[styles.checkCircle, checkStyle]}>
                <Ionicons name="checkmark" size={28} color="#FFFFFF" />
              </Animated.View>
            ) : (
              // 배지(green)는 정적, 내부 심볼 이미지만 회전 (TopBar 브랜드 배지와 동일)
              <View style={styles.symbolBadge}>
                <Animated.Image source={SYMBOL_LOGO} style={[styles.symbol, symbolStyle]} resizeMode="contain" />
              </View>
            )}
          </View>

          {/* 타이틀 */}
          <Text style={styles.title}>{title}</Text>

          {/* 스텝 인디케이터 (옵션) */}
          {!!steps && steps.length > 0 && (
            <View style={styles.stepsRow}>
              {steps.map((label, i) => {
                const active = i <= currentStep;
                return (
                  <View key={i} style={styles.stepItem}>
                    <View
                      style={[
                        styles.stepDot,
                        active && styles.stepDotActive,
                      ]}
                    />
                    <Text
                      style={[styles.stepLabel, active && styles.stepLabelActive]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* 불확정 프로그레스 바 — 완료 시 숨김 */}
          {!done && (
            <View style={[styles.barTrack, { width: barW }]}>
              <Animated.View
                style={[styles.barHead, { width: BAR_HEAD }, barHeadStyle]}
              >
                {/* green→green-dark 두 톤 근사 (네이티브 그라데이션 모듈 미사용) */}
                <View style={styles.barHeadGreen} />
                <View style={styles.barHeadDark} />
              </Animated.View>
            </View>
          )}

          {/* 보조 문구 */}
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          {/* 경과 10초↑ 보조 문구 */}
          {elapsedHint && !done && (
            <Text style={styles.elapsedHint}>
              {t('brandProgress.elapsedHint')}{T.ellipsis}
            </Text>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 전체화면 절대배치 오버레이(구 Modal). 화면 위를 덮고 터치를 막되, 위에 뜨는 dialog(Modal)는
  // 정상 표시되게 한다(Modal은 항상 일반 View보다 위 레이어).
  fullscreen: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCRIM,
    paddingHorizontal: 32,
  },
  card: {
    minWidth: 240,
    maxWidth: 360,
    paddingHorizontal: T.cardPadding,
    paddingVertical: T.cardPadding,
    borderRadius: T.cardRadius,
    backgroundColor: T.cardBg,
    alignItems: 'center',
    gap: T.gap,
    shadowColor: T.shadowColor,
    shadowOffset: T.shadowOffset,
    shadowOpacity: T.shadowOpacity,
    shadowRadius: T.shadowRadius,
    elevation: T.elevation,
  },
  symbolSlot: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbolBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: T.green,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  symbol: {
    width: 30,
    height: 30,
  },
  checkCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: T.titleSize,
    fontWeight: T.titleWeight,
    color: T.titleColor,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: T.subSize,
    fontWeight: T.subWeight,
    color: T.subColor,
    textAlign: 'center',
  },
  elapsedHint: {
    fontSize: T.subSize,
    fontWeight: T.subWeight,
    color: T.subColor,
    textAlign: 'center',
  },
  // 불확정 바
  barTrack: {
    height: 4,
    borderRadius: T.pill,
    backgroundColor: T.greenTint,
    overflow: 'hidden',
  },
  barHead: {
    height: 4,
    borderRadius: T.pill,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  barHeadGreen: {
    flex: 1,
    backgroundColor: T.green,
  },
  barHeadDark: {
    flex: 1,
    backgroundColor: T.greenDark,
  },
  // 스텝
  stepsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.greenTint,
  },
  stepDotActive: {
    backgroundColor: T.green,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: T.subColor,
  },
  stepLabelActive: {
    color: T.greenDark,
    fontWeight: '600',
  },
});
