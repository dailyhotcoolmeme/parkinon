// 디지털 바이오마커 MVP-A Phase 3 — 결과 화면 (§4.4·§9.4·§10.4)
//
// 진입 경로: TapGameScreen / ReactionGameScreen → navigation.replace('MeasurementResult', { measurementId })
// props: measurementId — 그 측정 1건만 표시.
//
// 동작:
//  1) measurement + features 조회
//  2) 30일 윈도우로 baseline 재계산(measurement type별 핵심 feature)
//  3) 14일 학습 가드(isBaselineReady)에 따라 "평소 평균" 표시 / 안내 분기
//  4) MiniBarTrend로 30일 추세 + baseline 평균 점선
//  5) 약 변경 감지 → 비강제 reset 제안 다이얼로그
//  6) 확인 버튼 → popToTop (측정 진입 이전 경로로 복귀)
//
// 의학 판정 표현 금지 — "OFF/이상/악화" 금지(§6.6 블랙리스트). 사실 표현만.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  RouteProp,
  StackActions,
} from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { MiniBarTrend } from '../../components/measurement/MiniBarTrend';
import {
  getMeasurementById,
  getDailyTrend,
  recomputeBaselineFromWindow,
  getBaseline,
  resetAllBaselinesForUser,
  BASELINE_LEARNING_MIN_N,
  type DailyTrendPoint,
  type MeasurementWithFeatures,
} from '../../utils/biomarker';
import type { MeasurementType, MeasurementMedPhase } from '../../types/database';
import {
  computeCurrentMedSignature,
  readLastMedSignature,
  writeLastMedSignature,
  markBaselineResetAt,
} from '../../utils/measurementMedChange';
import { formatReactionMs } from '../../utils/measurementFormat';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type RouteProps = RouteProp<RootStackParamList, 'MeasurementResult'>;
type Nav = StackNavigationProp<RootStackParamList, 'MeasurementResult'>;

const DISCLAIMER =
  '측정 결과는 일상 변화 기록을 돕기 위한 참고이며 진단·치료가 아니에요. 주치의와 상의해 조정하세요.';

export function MeasurementResultScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const { user } = useAuth();
  const dialog = useDialog();
  const bottomPad = useBottomSheetPadding(28);

  const measurementId = route.params?.measurementId;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [data, setData] = useState<MeasurementWithFeatures | null>(null);
  /** 핵심 feature_key (tap → tap_count, reaction → rt_mean_ms) */
  const [primaryFeatureKey, setPrimaryFeatureKey] = useState<string | null>(null);
  /** 30일 시계열 */
  const [trend, setTrend] = useState<DailyTrendPoint[]>([]);
  /** baseline 결과 (mean / sd / n) */
  const [baselineMean, setBaselineMean] = useState<number | null>(null);
  const [baselineN, setBaselineN] = useState<number>(0);

  // 약 변경 다이얼로그는 마운트 후 한 번만
  const [medChangeChecked, setMedChangeChecked] = useState(false);

  // 반응속도 권유 모달 (탭핑 → 약효추적 진입 시만)
  const [showReactionInvite, setShowReactionInvite] = useState(false);

  // ── 데이터 로딩 ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!measurementId) {
        setErrorMsg('측정 정보를 찾지 못했어요.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const m = await getMeasurementById(measurementId);
        if (cancelled) return;
        if (!m) {
          setErrorMsg('측정 정보를 찾지 못했어요.');
          setLoading(false);
          return;
        }
        setData(m);

        const featureKey =
          m.measurement.type === 'tap' ? 'tap_count' : 'rt_mean_ms';
        setPrimaryFeatureKey(featureKey);

        const userId = m.measurement.user_id;

        // baseline 재계산→재조회(체인) 과 30일 시계열(독립) 을 병렬로.
        //  - recomputeBaselineFromWindow 는 try/catch 로 독립 실행(실패해도 화면 표시)
        //  - getBaseline 은 recompute 결과를 읽으므로 같은 체인 안에서 순차 유지
        //  - getDailyTrend 는 baseline 과 무관 → 병렬
        const baselineChain = (async () => {
          try {
            await recomputeBaselineFromWindow(userId, featureKey, 30);
          } catch (e) {
            console.warn('[MeasurementResult] baseline 재계산 실패:', e);
          }
          return getBaseline(userId, featureKey).catch(() => null);
        })();
        const trendPromise = getDailyTrend(
          userId,
          m.measurement.type as MeasurementType,
          featureKey,
          30
        );

        const [b, trendData] = await Promise.all([baselineChain, trendPromise]);
        if (cancelled) return;
        setBaselineMean(
          b && b.n >= BASELINE_LEARNING_MIN_N ? b.mean : null
        );
        setBaselineN(b?.n ?? 0);
        setTrend(trendData);

        setLoading(false);
      } catch (e: any) {
        console.warn('[MeasurementResult] 로딩 실패:', e);
        if (!cancelled) {
          setErrorMsg(e?.message ?? '결과를 불러오지 못했어요.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [measurementId]);

  // ── 약 변경 비강제 reset 제안 ─────────────────────────────────────
  useEffect(() => {
    if (medChangeChecked) return;
    if (loading) return;
    if (!data) return;
    if (!user?.id) return;
    // 학습 완료(n>=14)에서만 다이얼로그 노출 — 미완료면 자동 sliding window가 새 데이터로 채워감
    if (baselineN < BASELINE_LEARNING_MIN_N) {
      setMedChangeChecked(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // 두 조회는 서로 독립(둘 다 읽기) → 병렬. lastSig 는 currentSig 가 빈값이면
        // 사용하지 않지만 부수효과 없는 읽기라 미리 가져와도 동작 동일.
        const [currentSig, lastSig] = await Promise.all([
          computeCurrentMedSignature(user.id),
          readLastMedSignature(),
        ]);
        if (cancelled) return;

        // 약 0개면 시그니처 빈값 — 다이얼로그 노출 스킵, 시그니처도 빈값 저장(반복 방지)
        if (!currentSig) {
          await writeLastMedSignature('');
          setMedChangeChecked(true);
          return;
        }

        // 첫 진입(저장된 값 없음): 현재 시그니처만 저장 — 다이얼로그 노출 X
        if (lastSig === null) {
          await writeLastMedSignature(currentSig);
          setMedChangeChecked(true);
          return;
        }

        // 변동 없음 → 다이얼로그 X
        if (lastSig === currentSig) {
          setMedChangeChecked(true);
          return;
        }

        // 변동 감지 → 비강제 제안
        const choice = await dialog.show({
          emoji: '💊',
          title: '약이 바뀌었어요',
          message:
            '드시는 약이 달라졌어요.\n측정 기준을 새로 잡아드릴까요?\n\n새로 시작하면 그동안 쌓인 평소 평균이 지워지고, 14일 동안 다시 모아요.',
          buttons: [
            { id: 'keep', text: '그대로 둘게요', style: 'cancel' },
            { id: 'reset', text: '새 기준으로 시작', style: 'primary' },
          ],
          cancelable: true,
        });

        if (cancelled) return;

        if (choice === 'reset') {
          try {
            await resetAllBaselinesForUser(user.id);
            await markBaselineResetAt();
            await writeLastMedSignature(currentSig);
            // 결과 화면 baseline 표시도 즉시 비활성으로 갱신
            setBaselineMean(null);
            setBaselineN(0);
            await dialog.alert({
              emoji: '✨',
              title: '새 기준으로 시작해요',
              message:
                '오늘부터 14일 동안 다시 기록을 모아요.\n그동안의 평소 평균은 비교에 사용되지 않아요.',
            });
          } catch (e: any) {
            console.warn('[MeasurementResult] baseline reset 실패:', e);
            await dialog.alert({
              emoji: '⚠️',
              title: '잠시 후 다시 시도해주세요',
              message: e?.message ?? '기준을 새로 잡지 못했어요.',
            });
          }
        } else {
          // "그대로 둘게요" 또는 배경탭(null) — 시그니처만 갱신(반복 노출 방지)
          await writeLastMedSignature(currentSig);
        }
      } catch (e) {
        console.warn('[MeasurementResult] 약 변경 감지 오류:', e);
      } finally {
        if (!cancelled) setMedChangeChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [medChangeChecked, loading, data, user?.id, baselineN, dialog]);

  // ── 확인 버튼 ─────────────────────────────────────────────────────
  // 손가락 두드리기 + 약효추적 진입(30m/2h) 시에는 반응속도 권유 모달부터 표시.
  // 그 외(반응속도 결과 / 자율 측정 / 게스트·보호자)는 곧바로 메인 복귀.
  const handleConfirm = useCallback(() => {
    const m = data?.measurement;
    const isTapResult = m?.type === 'tap';
    const isMedTracking = m?.med_phase === '30m' || m?.med_phase === '2h';
    if (isTapResult && isMedTracking) {
      setShowReactionInvite(true);
      return;
    }
    navigation.dispatch(StackActions.popToTop());
  }, [navigation, data]);

  const handleReactionStartNow = useCallback(() => {
    const m = data?.measurement;
    if (!m) return;
    setShowReactionInvite(false);
    // medPhase·medIntakeId 그대로 이어서 전달
    navigation.replace('ReactionGame', {
      medPhase: m.med_phase as MeasurementMedPhase,
      medIntakeId: m.med_intake_id ?? null,
    });
  }, [navigation, data]);

  const handleReactionLater = useCallback(() => {
    setShowReactionInvite(false);
    // 진입 전 화면으로 복귀
    navigation.dispatch(StackActions.popToTop());
  }, [navigation]);

  // ── 렌더 ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerBody}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>오늘 결과를 정리하고 있어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (errorMsg || !data || !primaryFeatureKey) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerBody}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>결과를 불러오지 못했어요</Text>
          <Text style={styles.errorSub}>
            {errorMsg ?? '잠시 후 다시 시도해주세요.'}
          </Text>
        </View>
        <View style={[styles.bottomBtnArea, { paddingBottom: bottomPad }]}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleConfirm}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle" size={24} color={Colors.white} />
            <Text style={styles.primaryBtnText}>확인</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const type = data.measurement.type;
  const isTap = type === 'tap';
  const todayValue = data.features[primaryFeatureKey];
  const learningReady = baselineN >= BASELINE_LEARNING_MIN_N;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.headerWrap}>
          <Text style={styles.headerTitle}>오늘 측정 결과</Text>
          <Text style={styles.headerSub}>수고하셨어요. 오늘 측정 결과예요.</Text>
        </View>

        {/* 손가락 두드리기 섹션 */}
        {isTap && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionEmoji}>👆</Text>
              <Text style={styles.sectionTitle}>손가락 두드리기</Text>
            </View>

            <View style={styles.bigNumberRow}>
              <Text style={styles.bigNumberLabel}>오늘</Text>
              <Text style={styles.bigNumberValue}>
                {todayValue !== null && Number.isFinite(todayValue)
                  ? Math.round(todayValue)
                  : '–'}
              </Text>
              <Text style={styles.bigNumberUnit}>번</Text>
            </View>

            {learningReady ? (
              <Text style={styles.avgCompareText}>
                평소 평균 {(baselineMean ?? 0).toFixed(1)}번
              </Text>
            ) : (
              <Text style={styles.learningText}>
                기록을 모으는 중이에요 ({baselineN} / {BASELINE_LEARNING_MIN_N}일)
              </Text>
            )}

            {/* 추세 그래프 — 14일 이상이면 평균선 표시, 미만이면 안내 카드 */}
            {trend.length > 0 && trend.some((d) => d.value !== null) ? (
              <View style={styles.trendWrap}>
                <MiniBarTrend
                  days={trend}
                  baselineMean={learningReady ? baselineMean : null}
                  yLabel="회"
                />
              </View>
            ) : (
              <View style={styles.emptyTrendCard}>
                <Text style={styles.emptyTrendText}>
                  추세 그래프는 기록이 쌓이면 보여드려요.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* 반응속도 섹션 */}
        {!isTap && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionEmoji}>⚡</Text>
              <Text style={styles.sectionTitle}>반응속도</Text>
            </View>

            <View style={styles.bigNumberRow}>
              <Text style={styles.bigNumberLabel}>오늘 평균</Text>
              <Text style={styles.bigNumberValueRt}>
                {formatReactionMs(todayValue)}
              </Text>
            </View>

            {learningReady ? (
              <Text style={styles.avgCompareText}>
                평소 평균 {formatReactionMs(baselineMean)}
              </Text>
            ) : (
              <Text style={styles.learningText}>
                기록을 모으는 중이에요 ({baselineN} / {BASELINE_LEARNING_MIN_N}일)
              </Text>
            )}

            {/* 보조 줄: false_starts / timeouts */}
            <ReactionAuxLine features={data.features} />

            {trend.length > 0 && trend.some((d) => d.value !== null) ? (
              <View style={styles.trendWrap}>
                <MiniBarTrend
                  days={trend}
                  baselineMean={learningReady ? baselineMean : null}
                  yLabel="ms"
                />
              </View>
            ) : (
              <View style={styles.emptyTrendCard}>
                <Text style={styles.emptyTrendText}>
                  추세 그래프는 기록이 쌓이면 보여드려요.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* 디스클레이머 1줄(소형, 회색) */}
        <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
      </ScrollView>

      {/* 하단 확인 버튼 */}
      <View style={[styles.bottomBtnArea, { paddingBottom: bottomPad }]}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleConfirm}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={24} color={Colors.white} />
          <Text style={styles.primaryBtnText}>확인</Text>
        </TouchableOpacity>
      </View>

      {/* 반응속도 권유 모달 — 약효추적 진입(30m/2h) 시에만 표시 */}
      <ReactionInviteModal
        visible={showReactionInvite}
        onStartNow={handleReactionStartNow}
        onLater={handleReactionLater}
      />
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// 반응속도 권유 모달 (약효추적 진입 시 손가락 두드리기 결과 화면 다음 단계)
// ────────────────────────────────────────────────────────────────────

function ReactionInviteModal({
  visible,
  onStartNow,
  onLater,
}: {
  visible: boolean;
  onStartNow: () => void;
  onLater: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onLater}
    >
      <View style={inviteStyles.overlay}>
        <View style={inviteStyles.card}>
          <Text style={inviteStyles.icon}>⚡</Text>
          <Text style={inviteStyles.title}>반응속도도 해볼까요?</Text>
          <Text style={inviteStyles.body}>
            1분 정도 걸려요. 천천히 하셔도 돼요.
          </Text>

          <TouchableOpacity
            style={inviteStyles.primaryBtn}
            onPress={onStartNow}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="지금 반응속도 시작"
          >
            <Ionicons name="flash" size={22} color={Colors.white} />
            <Text style={inviteStyles.primaryBtnText}>지금 시작</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={inviteStyles.secondaryBtn}
            onPress={onLater}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="다음에 측정"
          >
            <Text style={inviteStyles.secondaryBtnText}>다음에</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const inviteStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  icon: { fontSize: 44, marginBottom: 10 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 14,
    textAlign: 'center',
    lineHeight: 30,
  },
  body: {
    fontSize: 17,
    color: Colors.textSub,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    width: '100%',
    borderRadius: 14,
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  primaryBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.white,
  },
  secondaryBtn: {
    minHeight: 52,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  secondaryBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textSub,
  },
});

// ────────────────────────────────────────────────────────────────────
// 반응속도 보조 줄: false_starts / timeouts (값 0이면 표시 X)
// ────────────────────────────────────────────────────────────────────

function ReactionAuxLine({
  features,
}: {
  features: Record<string, number | null>;
}) {
  const fs = features['false_starts'];
  const to = features['timeouts'];
  const hasFs = fs !== null && fs !== undefined && Number.isFinite(fs) && fs > 0;
  const hasTo = to !== null && to !== undefined && Number.isFinite(to) && to > 0;
  if (!hasFs && !hasTo) return null;

  return (
    <Text style={styles.auxLineText}>
      자극 전 누름 {Math.round(fs ?? 0)}회, 응답 없음 {Math.round(to ?? 0)}회
    </Text>
  );
}

// ────────────────────────────────────────────────────────────────────
// 스타일
// ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 24 },

  headerWrap: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 6,
  },
  headerSub: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 22,
  },

  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionEmoji: { fontSize: 22 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },

  bigNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 6,
  },
  bigNumberLabel: {
    fontSize: 18,
    color: Colors.text,
    fontWeight: '700',
  },
  bigNumberValue: {
    fontSize: 56,
    fontWeight: '800',
    color: Colors.dark,
    lineHeight: 62,
  },
  /** 반응속도 전용 — "0.32초 (320ms)"가 길어서 폰트 축소 */
  bigNumberValueRt: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.dark,
    lineHeight: 36,
  },
  bigNumberUnit: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.dark,
  },

  avgCompareText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  learningText: {
    fontSize: 16,
    color: Colors.textSub,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  auxLineText: {
    fontSize: 14,
    color: Colors.textHint,
    marginBottom: 12,
  },

  trendWrap: {
    marginTop: 4,
  },

  emptyTrendCard: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 4,
  },
  emptyTrendText: {
    fontSize: 15,
    color: Colors.textSub,
    textAlign: 'center',
  },

  disclaimerText: {
    fontSize: 13,
    color: Colors.textHint,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 4,
  },

  bottomBtnArea: {
    padding: 20,
    backgroundColor: Colors.background,
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

  /* 로딩/에러 */
  centerBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.textSub,
    marginTop: 16,
  },
  errorEmoji: { fontSize: 56, marginBottom: 12 },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSub: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 22,
  },
});
