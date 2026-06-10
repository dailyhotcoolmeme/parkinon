// 디지털 바이오마커 MVP-A Phase 2 — 손가락 두드리기 게임 화면 (§9.2)
// 양손 검지로 화면 좌·우 큰 동그라미를 10초간 교대 탭.
// 측정 종료 시 features 계산 후 recordMeasurement 호출.
// 완료 후 confirm 화면 → 진입 이전 화면 복귀(결과 화면은 Phase 3).
//
// 60대+ UI 원칙: 본문 18sp+, 동그라미 minHeight 200dp, 좌·우 라벨 18sp+.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { StackNavigationProp } from '@react-navigation/stack';

type RouteProps = RouteProp<RootStackParamList, 'TapGame'>;
type Nav = StackNavigationProp<RootStackParamList, 'TapGame'>;

/** 측정 길이 (초) */
const MEASURE_SECONDS = 10;
/** 시작 전 카운트다운 (초): 3, 2, 1 */
const PRECOUNT_SECONDS = 3;
/** 같은 손 연속 더블탭 노이즈 차단 임계 (ms) */
const DOUBLE_TAP_NOISE_MS = 50;
/** 탭 하이라이트 지속 (ms) */
const TAP_FLASH_MS = 150;

type Phase = 'ready' | 'precount' | 'running' | 'saving' | 'done' | 'error';
type Hand = 'left' | 'right';

interface TapRecord {
  hand: Hand;
  t_ms: number; // 측정 시작 기준 ms (성능용)
}

export function TapGameScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const medPhase = route.params?.medPhase ?? 'self_initiated';
  const medIntakeId = route.params?.medIntakeId ?? null;

  const [phase, setPhase] = useState<Phase>('ready');
  /** 카운트다운 / 남은 시간 표시용 정수 초 */
  const [displaySeconds, setDisplaySeconds] = useState<number>(PRECOUNT_SECONDS);
  /** 총 탭 카운트 (UI 표시용) */
  const [tapCountUi, setTapCountUi] = useState<number>(0);
  /** 에러 메시지 */
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── 측정 데이터(ref로 보관, 렌더 회피) ─────────────────────────────
  const tapsRef = useRef<TapRecord[]>([]);
  const startedAtMsRef = useRef<number>(0); // 측정 실제 시작 시각 (performance.now)
  const startedAtIsoRef = useRef<string>('');
  const lastTapByHandRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });

  // ── 타이머 핸들 ─────────────────────────────────────────────────────
  const precountTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runTickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 탭 시 동그라미 빛남 ─────────────────────────────────────────────
  const leftFlash = useRef(new Animated.Value(0)).current;
  const rightFlash = useRef(new Animated.Value(0)).current;

  // ── 마운트 시 정리만, 자동 시작 X (사용자가 "준비되면 시작" 버튼 탭) ──
  useEffect(() => {
    return () => {
      if (precountTimerRef.current) clearInterval(precountTimerRef.current);
      if (runTickTimerRef.current) clearInterval(runTickTimerRef.current);
      if (runEndTimerRef.current) clearTimeout(runEndTimerRef.current);
    };
  }, []);

  /** "준비되면 시작" 버튼 → 3-2-1 카운트다운 진입 */
  const handleReadyStart = useCallback(() => {
    setPhase('precount');
    setDisplaySeconds(PRECOUNT_SECONDS);
    precountTimerRef.current = setInterval(() => {
      setDisplaySeconds((s) => {
        if (s <= 1) {
          if (precountTimerRef.current) {
            clearInterval(precountTimerRef.current);
            precountTimerRef.current = null;
          }
          startMeasurement();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startMeasurement = useCallback(() => {
    tapsRef.current = [];
    lastTapByHandRef.current = { left: 0, right: 0 };
    setTapCountUi(0);

    startedAtMsRef.current = nowMs();
    startedAtIsoRef.current = new Date().toISOString();
    setPhase('running');
    setDisplaySeconds(MEASURE_SECONDS);

    // 1초마다 남은 시간 갱신
    runTickTimerRef.current = setInterval(() => {
      setDisplaySeconds((s) => Math.max(0, s - 1));
    }, 1000);

    // 종료 타이머
    runEndTimerRef.current = setTimeout(() => {
      finishMeasurement();
    }, MEASURE_SECONDS * 1000);
  }, []);

  const finishMeasurement = useCallback(async () => {
    if (runTickTimerRef.current) {
      clearInterval(runTickTimerRef.current);
      runTickTimerRef.current = null;
    }
    if (runEndTimerRef.current) {
      clearTimeout(runEndTimerRef.current);
      runEndTimerRef.current = null;
    }

    setPhase('saving');
    setDisplaySeconds(0);

    const taps = tapsRef.current.slice();
    const endedAtIso = new Date().toISOString();

    const features = computeTapFeatures(taps);

    try {
      const measurementId = await recordMeasurement({
        type: 'tap',
        medPhase,
        medIntakeId: medIntakeId ?? undefined,
        startedAt: startedAtIsoRef.current,
        endedAt: endedAtIso,
        features: [
          { feature_key: 'tap_count', value_numeric: features.tap_count },
          { feature_key: 'iti_mean_ms', value_numeric: features.iti_mean_ms },
          { feature_key: 'iti_cv', value_numeric: features.iti_cv },
          { feature_key: 'asymmetry', value_numeric: features.asymmetry },
          // raw_taps는 디버깅·재분석용. value_numeric은 baseline 갱신 대상이 아니어야 하므로 jsonb만.
          {
            feature_key: 'raw_taps',
            value_jsonb: taps.map((t) => ({ hand: t.hand, t_ms: Math.round(t.t_ms) })),
          },
        ],
      });
      // Phase 3 — confirm 표시 없이 곧바로 결과 화면으로 replace 진입
      navigation.replace('MeasurementResult', { measurementId });
      return;
    } catch (e: any) {
      console.warn('[TapGameScreen] 저장 실패:', e);
      setErrorMsg(e?.message ?? '측정 기록 저장에 실패했어요.');
      setPhase('error');
    }
  }, [medPhase, medIntakeId]);

  const handleTap = useCallback(
    (hand: Hand) => {
      if (phase !== 'running') return;

      const t = nowMs() - startedAtMsRef.current;

      // 손떨림 노이즈: 같은 손 연속 더블탭 50ms 이내는 1회로(추가 카운트 X)
      const last = lastTapByHandRef.current[hand];
      if (last > 0 && t - last < DOUBLE_TAP_NOISE_MS) {
        return;
      }
      lastTapByHandRef.current[hand] = t;

      tapsRef.current.push({ hand, t_ms: t });
      setTapCountUi((c) => c + 1);

      // 동그라미 짧게 빛남
      const anim = hand === 'left' ? leftFlash : rightFlash;
      anim.setValue(1);
      Animated.timing(anim, {
        toValue: 0,
        duration: TAP_FLASH_MS,
        useNativeDriver: false,
      }).start();
    },
    [phase, leftFlash, rightFlash]
  );

  const handleBack = useCallback(() => {
    // 측정 중에도 뒤로가기 가능(데이터 저장 안 함). 단순화: 별도 confirm 다이얼로그 없이 진행.
    if (runTickTimerRef.current) clearInterval(runTickTimerRef.current);
    if (runEndTimerRef.current) clearTimeout(runEndTimerRef.current);
    if (precountTimerRef.current) clearInterval(precountTimerRef.current);
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const handleDoneConfirm = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // ── 동그라미 색 보간 ────────────────────────────────────────────────
  const leftBg = leftFlash.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.light, Colors.primary],
  });
  const rightBg = rightFlash.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.light, Colors.primary],
  });

  // 동그라미 사이즈 — 화면 절반에 가깝게(높이 minHeight 200dp는 별도)
  const winSize = useMemo(() => {
    const { width, height } = Dimensions.get('window');
    // 화면 폭의 약 42% — 두 개가 양옆에 배치되고 패딩 고려
    const wByWidth = Math.floor(width * 0.42);
    const wByHeight = Math.floor(height * 0.32);
    return Math.max(200, Math.min(wByWidth, wByHeight));
  }, []);

  // 좌·우 카운트 계산(UI용) — taps ref에서 즉시 산정
  const leftCount = tapsRef.current.filter((t) => t.hand === 'left').length;
  const rightCount = tapsRef.current.filter((t) => t.hand === 'right').length;

  // ────────────────────────────────────────────────────────────────────
  // 렌더
  // ────────────────────────────────────────────────────────────────────

  if (phase === 'ready') {
    return <ReadyScreen onStart={handleReadyStart} onBack={handleBack} />;
  }

  if (phase === 'done') {
    return <DoneConfirm onConfirm={handleDoneConfirm} />;
  }

  if (phase === 'saving') {
    return (
      <SavingScreen />
    );
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
        <Text style={styles.topTitle}>손가락 두드리기</Text>
        <View style={styles.topRight} />
      </View>

      <View style={styles.body}>
        {/* 임상 공신력 한 줄 — 카운트다운/측정 중에도 작게 표시(중앙·회색) */}
        <Text style={styles.credibilityLine}>
          파킨슨병 표준 평가 척도(UPDRS)를 디지털로 재현한 측정이에요.
        </Text>

        {/* 안내 */}
        <Text style={styles.guide}>
          {phase === 'precount'
            ? '잠시 후 시작해요. 준비해주세요.'
            : '양손 검지로 왼쪽·오른쪽을\n번갈아 빠르게 누르세요'}
        </Text>

        {/* 카운트다운 / 남은 시간 */}
        <View style={styles.timerWrap}>
          {phase === 'precount' ? (
            <>
              <Text style={styles.precountNumber}>{displaySeconds}</Text>
              <Text style={styles.timerSub}>초 뒤 시작</Text>
            </>
          ) : (
            <>
              <Text style={styles.runningNumber}>● {displaySeconds}</Text>
              <Text style={styles.timerSub}>초 남았어요</Text>
            </>
          )}
        </View>

        {/* 좌·우 동그라미 */}
        <View style={styles.circlesRow}>
          {/* 왼쪽 */}
          <View style={styles.circleCol}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => handleTap('left')}
              disabled={phase !== 'running'}
            >
              <Animated.View
                style={[
                  styles.circle,
                  {
                    width: winSize,
                    height: winSize,
                    borderRadius: winSize / 2,
                    backgroundColor: leftBg,
                  },
                ]}
              >
                <Text style={styles.circleLabel}>왼쪽</Text>
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* 오른쪽 */}
          <View style={styles.circleCol}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => handleTap('right')}
              disabled={phase !== 'running'}
            >
              <Animated.View
                style={[
                  styles.circle,
                  {
                    width: winSize,
                    height: winSize,
                    borderRadius: winSize / 2,
                    backgroundColor: rightBg,
                  },
                ]}
              >
                <Text style={styles.circleLabel}>오른쪽</Text>
              </Animated.View>
            </TouchableOpacity>
          </View>
        </View>

        {/* 카운트 */}
        <View style={styles.counterWrap}>
          <Text style={styles.counterMain}>지금까지 {tapCountUi}번</Text>
          <Text style={styles.counterSub}>
            왼쪽 {leftCount} · 오른쪽 {rightCount}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// 보조 컴포넌트: 완료 confirm / 저장 중 / 에러
// ────────────────────────────────────────────────────────────────────

function ReadyScreen({
  onStart,
  onBack,
}: {
  onStart: () => void;
  onBack: () => void;
}) {
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
        <Text style={styles.topTitle}>손가락 두드리기</Text>
        <View style={styles.topRight} />
      </View>

      <View style={styles.centerBody}>
        <Text style={styles.doneEmoji}>🖐️</Text>
        <Text style={styles.doneTitle}>준비되셨나요?</Text>
        <Text style={styles.readyBody}>
          양손 검지로 왼쪽·오른쪽을{'\n'}번갈아 두드릴 거예요.{'\n'}10초 동안 측정해요.
        </Text>
      </View>

      <View style={styles.bottomBtnArea}>
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
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.centerBody}>
        <Text style={styles.doneEmoji}>🌿</Text>
        <Text style={styles.doneTitle}>수고하셨어요</Text>
        <Text style={styles.doneSub}>측정이 끝났어요.</Text>
      </View>
      <View style={styles.bottomBtnArea}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onConfirm}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={24} color={Colors.white} />
          <Text style={styles.primaryBtnText}>확인</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SavingScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.centerBody}>
        <Text style={styles.doneEmoji}>⏳</Text>
        <Text style={styles.doneTitle}>저장하고 있어요</Text>
        <Text style={styles.doneSub}>잠시만 기다려주세요.</Text>
      </View>
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
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.centerBody}>
        <Text style={styles.doneEmoji}>⚠️</Text>
        <Text style={styles.doneTitle}>저장하지 못했어요</Text>
        <Text style={styles.doneSub}>{message}</Text>
      </View>
      <View style={styles.bottomBtnArea}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onConfirm}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={24} color={Colors.white} />
          <Text style={styles.primaryBtnText}>확인</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// features 계산
// ────────────────────────────────────────────────────────────────────

interface TapFeatures {
  tap_count: number;
  iti_mean_ms: number;
  iti_cv: number;
  asymmetry: number;
}

/**
 * 입력 taps는 시간 순서 가정.
 * - tap_count: 총 탭 수
 * - iti_mean_ms: 인접 탭 간격(전체) 평균
 * - iti_cv: iti 변동계수 = sd / mean (mean이 0이면 0)
 * - asymmetry: |좌 탭 수 - 우 탭 수|
 */
export function computeTapFeatures(taps: TapRecord[]): TapFeatures {
  const tap_count = taps.length;
  let leftN = 0;
  let rightN = 0;
  for (const t of taps) {
    if (t.hand === 'left') leftN += 1;
    else rightN += 1;
  }

  // ITI(s)
  const itis: number[] = [];
  for (let i = 1; i < taps.length; i++) {
    const dt = taps[i].t_ms - taps[i - 1].t_ms;
    if (Number.isFinite(dt) && dt >= 0) itis.push(dt);
  }

  let iti_mean_ms = 0;
  let iti_cv = 0;
  if (itis.length > 0) {
    const sum = itis.reduce((a, b) => a + b, 0);
    iti_mean_ms = sum / itis.length;
    if (itis.length >= 2 && iti_mean_ms > 0) {
      const m = iti_mean_ms;
      const variance =
        itis.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (itis.length - 1);
      const sd = Math.sqrt(variance);
      iti_cv = sd / m;
    }
  }

  return {
    tap_count,
    iti_mean_ms: round1(iti_mean_ms),
    iti_cv: round4(iti_cv),
    asymmetry: Math.abs(leftN - rightN),
  };
}

// ────────────────────────────────────────────────────────────────────
// 유틸
// ────────────────────────────────────────────────────────────────────

function nowMs(): number {
  // performance.now 우선, 없으면 Date.now (RN은 global.performance 존재)
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
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
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
    paddingHorizontal: 12,
    paddingVertical: 12,
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
    marginVertical: 4,
  },
  precountNumber: {
    fontSize: 72,
    fontWeight: '800',
    color: Colors.dark,
    lineHeight: 80,
  },
  runningNumber: {
    fontSize: 56,
    fontWeight: '800',
    color: Colors.dark,
    lineHeight: 64,
  },
  timerSub: {
    fontSize: 16,
    color: Colors.textSub,
    marginTop: 2,
  },

  circlesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginVertical: 6,
  },
  circleCol: {
    alignItems: 'center',
  },
  circle: {
    minHeight: 200,
    minWidth: 200,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  circleLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.dark,
  },

  counterWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  counterMain: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.accent,
  },
  counterSub: {
    fontSize: 18,
    color: Colors.textSub,
    marginTop: 4,
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
    paddingBottom: 32,
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
