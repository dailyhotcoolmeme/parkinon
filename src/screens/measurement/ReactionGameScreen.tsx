// 디지털 바이오마커 MVP-A Phase 2 — 반응속도 게임 화면 (§9.3)
// 회색 → 초록으로 바뀌면 빠르게 탭. 7회 반복.
// - 자극 대기: 무작위 2.0~4.0초 균등.
// - 자극 후 3초 무응답 → timeout 처리(rt=3000ms 기록).
// - 자극 전 탭 → false start → 1.5초 안내 후 같은 회차 재시작.
// 완료 후 features 계산 후 recordMeasurement → confirm 화면.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { recordMeasurement } from '../../utils/biomarker';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { formatReactionMs } from '../../utils/measurementFormat';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { StackNavigationProp } from '@react-navigation/stack';

type RouteProps = RouteProp<RootStackParamList, 'ReactionGame'>;
type Nav = StackNavigationProp<RootStackParamList, 'ReactionGame'>;

const TOTAL_TRIALS = 7;
const WAIT_MIN_MS = 2000;
const WAIT_MAX_MS = 4000;
/** 자극 후 무응답 timeout (ms) — 3초 */
const RESPONSE_TIMEOUT_MS = 3000;
/** false start 안내 표시 시간 (ms) */
const FALSE_START_MSG_MS = 1500;

type Phase = 'ready' | 'precount' | 'waiting' | 'go' | 'feedback' | 'saving' | 'done' | 'error';

interface TrialResult {
  /** 회차 인덱스 0..6 */
  index: number;
  /** 측정된 RT(ms). timeout이면 RESPONSE_TIMEOUT_MS. false start는 본 결과 row에 들어가지 않음. */
  rt_ms: number;
  is_timeout: boolean;
}

export function ReactionGameScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const medPhase = route.params?.medPhase ?? 'self_initiated';
  const medIntakeId = route.params?.medIntakeId ?? null;

  const [phase, setPhase] = useState<Phase>('ready');
  /** 시작 카운트다운 표시(3-2-1) */
  const [preCount, setPreCount] = useState<number>(3);
  /** 현재 회차(1..TOTAL_TRIALS, UI 표시용) */
  const [currentTrialUi, setCurrentTrialUi] = useState<number>(1);
  /** 가장 최근 RT(ms) — feedback 단계에서 표시 */
  const [lastRtUi, setLastRtUi] = useState<number | null>(null);
  /** false start 안내 표시 여부 */
  const [showFalseStartMsg, setShowFalseStartMsg] = useState<boolean>(false);
  /** 에러 메시지 */
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── 결과 ─────────────────────────────────────────────────────────
  const trialsRef = useRef<TrialResult[]>([]);
  const falseStartsRef = useRef<number>(0);
  const timeoutsRef = useRef<number>(0);
  const startedAtIsoRef = useRef<string>('');

  // 현재 회차 진행 데이터
  const currentTrialIndexRef = useRef<number>(0);
  const stimulusOnsetMsRef = useRef<number>(0);

  // 타이머 핸들
  const precountTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const falseStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 자극 동그라미 색 애니메이션 (0=회색, 1=초록)
  const circleColor = useRef(new Animated.Value(0)).current;

  // ── 마운트: 타이머 정리만, 자동 시작 X (사용자가 "준비되면 시작" 버튼 탭) ──
  useEffect(() => {
    return () => {
      clearAllTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** "준비되면 시작" 버튼 → 3-2-1 카운트다운 진입 */
  const handleReadyStart = useCallback(() => {
    startedAtIsoRef.current = new Date().toISOString();
    setPhase('precount');
    setPreCount(3);

    precountTimerRef.current = setInterval(() => {
      setPreCount((s) => {
        if (s <= 1) {
          if (precountTimerRef.current) {
            clearInterval(precountTimerRef.current);
            precountTimerRef.current = null;
          }
          // 첫 회차 시작
          beginTrial(0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAllTimers = useCallback(() => {
    if (precountTimerRef.current) {
      clearInterval(precountTimerRef.current);
      precountTimerRef.current = null;
    }
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    if (falseStartTimerRef.current) {
      clearTimeout(falseStartTimerRef.current);
      falseStartTimerRef.current = null;
    }
  }, []);

  /** 회차 시작 — 자극 전 대기 */
  const beginTrial = useCallback(
    (idx: number) => {
      currentTrialIndexRef.current = idx;
      setCurrentTrialUi(idx + 1);
      setLastRtUi(null);
      setShowFalseStartMsg(false);
      setPhase('waiting');

      // 동그라미 회색
      circleColor.setValue(0);

      const waitMs =
        WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS);

      waitTimerRef.current = setTimeout(() => {
        // 자극 발생
        stimulusOnsetMsRef.current = nowMs();
        setPhase('go');
        Animated.timing(circleColor, {
          toValue: 1,
          duration: 80,
          useNativeDriver: false,
        }).start();

        // 무응답 3초 timeout
        timeoutTimerRef.current = setTimeout(() => {
          handleTimeout();
        }, RESPONSE_TIMEOUT_MS);
      }, waitMs);
    },
    [circleColor]
  );

  /** 사용자가 동그라미를 탭 */
  const handleTap = useCallback(() => {
    // precount, feedback, saving, done, error 상태에선 탭 무시
    if (phase === 'precount' || phase === 'feedback' || phase === 'saving' || phase === 'done' || phase === 'error') {
      return;
    }

    if (phase === 'waiting') {
      // false start
      falseStartsRef.current += 1;
      // 진행 중 타이머 정리
      if (waitTimerRef.current) {
        clearTimeout(waitTimerRef.current);
        waitTimerRef.current = null;
      }
      setShowFalseStartMsg(true);
      setPhase('feedback');

      falseStartTimerRef.current = setTimeout(() => {
        // 같은 회차 재시작
        setShowFalseStartMsg(false);
        beginTrial(currentTrialIndexRef.current);
      }, FALSE_START_MSG_MS);
      return;
    }

    if (phase === 'go') {
      // 정상 응답
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      const rt = nowMs() - stimulusOnsetMsRef.current;
      const rtClamped = Math.max(0, Math.round(rt));
      trialsRef.current.push({
        index: currentTrialIndexRef.current,
        rt_ms: rtClamped,
        is_timeout: false,
      });
      setLastRtUi(rtClamped);
      goNextOrFinish();
      return;
    }
  }, [phase, beginTrial]);

  /** 자극 후 3초 무응답 */
  const handleTimeout = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    timeoutsRef.current += 1;
    trialsRef.current.push({
      index: currentTrialIndexRef.current,
      rt_ms: RESPONSE_TIMEOUT_MS,
      is_timeout: true,
    });
    setLastRtUi(null);
    goNextOrFinish();
  }, []);

  const goNextOrFinish = useCallback(() => {
    setPhase('feedback');
    feedbackTimerRef.current = setTimeout(() => {
      const nextIdx = currentTrialIndexRef.current + 1;
      if (nextIdx >= TOTAL_TRIALS) {
        void finishMeasurement();
      } else {
        beginTrial(nextIdx);
      }
    }, 800);
  }, [beginTrial]);

  const finishMeasurement = useCallback(async () => {
    clearAllTimers();
    setPhase('saving');

    const trials = trialsRef.current.slice();
    const endedAtIso = new Date().toISOString();

    const features = computeReactionFeatures(
      trials,
      falseStartsRef.current,
      timeoutsRef.current
    );

    try {
      const measurementId = await recordMeasurement({
        type: 'reaction',
        medPhase,
        medIntakeId: medIntakeId ?? undefined,
        startedAt: startedAtIsoRef.current,
        endedAt: endedAtIso,
        features: [
          { feature_key: 'rt_mean_ms', value_numeric: features.rt_mean_ms },
          { feature_key: 'rt_sd_ms', value_numeric: features.rt_sd_ms },
          { feature_key: 'false_starts', value_numeric: features.false_starts },
          { feature_key: 'timeouts', value_numeric: features.timeouts },
          {
            feature_key: 'raw_rts',
            value_jsonb: trials.map((t) => ({
              index: t.index,
              rt_ms: t.rt_ms,
              is_timeout: t.is_timeout,
            })),
          },
        ],
      });
      // Phase 3 — confirm 표시 없이 결과 화면으로 replace 진입
      navigation.replace('MeasurementResult', { measurementId });
      return;
    } catch (e: any) {
      console.warn('[ReactionGameScreen] 저장 실패:', e);
      setErrorMsg(e?.message ?? '측정 기록 저장에 실패했어요.');
      setPhase('error');
    }
  }, [clearAllTimers, medPhase, medIntakeId]);

  const handleBack = useCallback(() => {
    clearAllTimers();
    if (navigation.canGoBack()) navigation.goBack();
  }, [clearAllTimers, navigation]);

  const handleDoneConfirm = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // ── 동그라미 색 보간 ───────────────────────────────────────────
  const bg = circleColor.interpolate({
    inputRange: [0, 1],
    outputRange: ['#CCCCCC', Colors.primary],
  });

  const winSize = (() => {
    const { width, height } = Dimensions.get('window');
    const w = Math.floor(width * 0.62);
    const h = Math.floor(height * 0.35);
    return Math.max(220, Math.min(w, h));
  })();

  // ── 화면 분기 ───────────────────────────────────────────────────

  if (phase === 'ready') {
    return <ReadyScreen onStart={handleReadyStart} onBack={handleBack} />;
  }
  if (phase === 'done') {
    return <DoneConfirm onConfirm={handleDoneConfirm} />;
  }
  if (phase === 'saving') {
    return <SavingScreen />;
  }
  if (phase === 'error') {
    return (
      <ErrorScreen
        message={errorMsg ?? '문제가 생겼어요. 잠시 후 다시 시도해주세요.'}
        onConfirm={handleDoneConfirm}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleBack}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>반응속도</Text>
        <View style={styles.topRight} />
      </View>

      <View style={styles.body}>
        {/* 임상 공신력 한 줄 — 카운트다운/측정 중에도 작게 표시(중앙·회색) */}
        <Text style={styles.credibilityLine}>
          약효 변동을 가장 민감하게 잡는 지표 중 하나로 알려진 측정이에요.
        </Text>

        <Text style={styles.guide}>
          {phase === 'precount'
            ? '잠시 후 시작해요. 준비해주세요.'
            : '동그라미가 초록색이 되면\n바로 누르세요'}
        </Text>

        {phase === 'precount' ? (
          <View style={styles.timerWrap}>
            <Text style={styles.precountNumber}>{preCount}</Text>
            <Text style={styles.timerSub}>초 뒤 시작</Text>
          </View>
        ) : (
          <View style={styles.progressWrap}>
            <Text style={styles.progressText}>
              {currentTrialUi} / {TOTAL_TRIALS} 번째
            </Text>
          </View>
        )}

        {/* 자극 동그라미 */}
        <View style={styles.circleArea}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleTap}
            disabled={phase === 'precount'}
          >
            <Animated.View
              style={[
                styles.circle,
                {
                  width: winSize,
                  height: winSize,
                  borderRadius: winSize / 2,
                  backgroundColor: bg,
                },
              ]}
            />
          </TouchableOpacity>
        </View>

        {/* 상태 텍스트 */}
        <View style={styles.stateWrap}>
          {showFalseStartMsg ? (
            <Text style={styles.falseStartText}>
              조금만 기다려주세요.{'\n'}색이 바뀌고 나서 눌러주세요.
            </Text>
          ) : phase === 'waiting' ? (
            <Text style={styles.stateText}>대기 중…</Text>
          ) : phase === 'go' ? (
            <Text style={styles.stateTextGo}>지금 누르세요!</Text>
          ) : phase === 'feedback' ? (
            lastRtUi != null ? (
              <Text style={styles.stateText}>{formatReactionMs(lastRtUi)}</Text>
            ) : (
              <Text style={styles.stateText}>다음 회차 준비 중…</Text>
            )
          ) : (
            <Text style={styles.stateText}> </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// 보조 컴포넌트
// ────────────────────────────────────────────────────────────────────

function ReadyScreen({
  onStart,
  onBack,
}: {
  onStart: () => void;
  onBack: () => void;
}) {
  const bottomPad = useBottomSheetPadding(32);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>반응속도</Text>
        <View style={styles.topRight} />
      </View>

      <View style={styles.centerBody}>
        <Text style={styles.doneEmoji}>⚡</Text>
        <Text style={styles.doneTitle}>준비되셨나요?</Text>
        <Text style={styles.readyBody}>
          동그라미가 초록색으로 바뀌면{'\n'}빠르게 누르시면 돼요.{'\n'}7번 반복해요.{'\n'}천천히 하셔도 돼요.
        </Text>
      </View>

      <View style={[styles.bottomBtnArea, { paddingBottom: bottomPad }]}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onStart}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="준비되면 시작"
        >
          <Ionicons name="play-circle" size={24} color={Colors.white} />
          <Text style={styles.primaryBtnText}>준비되면 시작</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function DoneConfirm({ onConfirm }: { onConfirm: () => void }) {
  const bottomPad = useBottomSheetPadding(32);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.centerBody}>
        <Text style={styles.doneEmoji}>🌿</Text>
        <Text style={styles.doneTitle}>수고하셨어요</Text>
        <Text style={styles.doneSub}>측정이 끝났어요.</Text>
      </View>
      <View style={[styles.bottomBtnArea, { paddingBottom: bottomPad }]}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onConfirm}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle-sharp" size={24} color={Colors.white} />
          <Text style={styles.primaryBtnText}>확인</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SavingScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <BrandProgressOverlay visible title="결과를 정리하고 있어요" />
    </SafeAreaView>
  );
}

function ErrorScreen({
  message,
  onConfirm,
}: {
  message: string;
  onConfirm: () => void;
}) {
  const bottomPad = useBottomSheetPadding(32);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.centerBody}>
        <Text style={styles.doneEmoji}>⚠️</Text>
        <Text style={styles.doneTitle}>저장하지 못했어요</Text>
        <Text style={styles.doneSub}>{message}</Text>
      </View>
      <View style={[styles.bottomBtnArea, { paddingBottom: bottomPad }]}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onConfirm}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle-sharp" size={24} color={Colors.white} />
          <Text style={styles.primaryBtnText}>확인</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// features 계산
// ────────────────────────────────────────────────────────────────────

interface ReactionFeatures {
  rt_mean_ms: number;
  rt_sd_ms: number;
  false_starts: number;
  timeouts: number;
}

/**
 * - rt_mean_ms: 정상 응답(=is_timeout false) RT 평균. 정상 응답 0건이면 0.
 * - rt_sd_ms: 정상 응답 표준편차(샘플, n>=2일 때만, 그 외 0).
 * - false_starts: 자극 전 탭 횟수.
 * - timeouts: 자극 후 3초 무응답 횟수.
 */
export function computeReactionFeatures(
  trials: TrialResult[],
  falseStarts: number,
  timeouts: number
): ReactionFeatures {
  const successRts = trials.filter((t) => !t.is_timeout).map((t) => t.rt_ms);
  let rt_mean_ms = 0;
  let rt_sd_ms = 0;
  if (successRts.length > 0) {
    const sum = successRts.reduce((a, b) => a + b, 0);
    rt_mean_ms = sum / successRts.length;
    if (successRts.length >= 2) {
      const m = rt_mean_ms;
      const variance =
        successRts.reduce((acc, x) => acc + (x - m) * (x - m), 0) /
        (successRts.length - 1);
      rt_sd_ms = Math.sqrt(variance);
    }
  }
  return {
    rt_mean_ms: round1(rt_mean_ms),
    rt_sd_ms: round1(rt_sd_ms),
    false_starts: falseStarts,
    timeouts,
  };
}

// ────────────────────────────────────────────────────────────────────
// 유틸
// ────────────────────────────────────────────────────────────────────

function nowMs(): number {
  if (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).performance?.now === 'function'
  ) {
    return (globalThis as any).performance.now();
  }
  return Date.now();
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ────────────────────────────────────────────────────────────────────
// 스타일
// ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 60,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
    gap: 2,
  },
  backText: {
    fontSize: 18,
    color: Colors.text,
    fontWeight: '600',
  },
  topTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  topRight: { width: 64 },

  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  guide: {
    fontSize: 18,
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 26,
    marginTop: 4,
    fontWeight: '600',
  },

  credibilityLine: {
    fontSize: 13,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
    marginTop: 4,
    marginBottom: 2,
  },

  timerWrap: {
    alignItems: 'center',
    marginVertical: 8,
  },
  precountNumber: {
    fontSize: 72,
    fontWeight: '800',
    color: Colors.dark,
    lineHeight: 80,
  },
  timerSub: {
    fontSize: 16,
    color: Colors.textSub,
    marginTop: 2,
  },
  progressWrap: { marginVertical: 8 },
  progressText: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.dark,
  },

  circleArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  circle: {
    minHeight: 220,
    minWidth: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },

  stateWrap: {
    alignItems: 'center',
    minHeight: 64,
    marginBottom: 8,
  },
  stateText: {
    fontSize: 20,
    color: Colors.textSub,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 28,
  },
  stateTextGo: {
    fontSize: 24,
    color: Colors.primary,
    fontWeight: '800',
    textAlign: 'center',
  },
  falseStartText: {
    fontSize: 20,
    color: Colors.accent,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 28,
  },

  /* 완료/저장/에러 공통 */
  centerBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  doneEmoji: { fontSize: 64, marginBottom: 16 },
  doneTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  doneSub: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
  },
  readyBody: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 28,
    marginTop: 4,
  },
  bottomBtnArea: {
    padding: 20,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    minHeight: 60,
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
});
