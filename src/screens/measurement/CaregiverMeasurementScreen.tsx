// 디지털 바이오마커 MVP-A Phase 5A — 보호자 측정 결과 조회 화면 (read-only)
//
// 참고: docs/digital_biomarker_mvpA_spec.md §5 (보호자 흐름), §5.2 (보호자 추세), §5.3 (보호자 대리 측정 금지)
//
// 진입 경로:
//   1) 메뉴 → '환자 컨디션 보기' 항목 (MenuScreen, 환자 측정 1회 이상일 때만 노출)
//   2) 측정 완료 푸시(type='measurement_completed') → App.tsx 분기에서 navigate
//
// 구성:
//   - 헤더: "[환자 이름]님의 컨디션 측정"
//   - 탭핑 섹션: 오늘 탭 수(평균) + 평소 평균 + 30일 추세 그래프(MiniBarTrend)
//   - 반응속도 섹션: 오늘 평균 RT(ms) + 평소 평균 + 30일 추세
//   - 14일 학습 가드: baseline.n < 14면 "기록을 모으는 중" 안내 (평소 평균 숨김)
//   - 디스클레이머 1줄
//
// read-only — 측정 시작 버튼 절대 노출 X (§5.3, 보호자 대리 측정 금지).
// 의학 판정 표현 금지(§6.6 블랙리스트). 묘사 표현만.
// 보호자 SELECT RLS는 Phase 1 마이그레이션에서 patient_group 기준으로 허용됨.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { MiniBarTrend } from '../../components/measurement/MiniBarTrend';
import {
  getMeasurements,
  getBaseline,
  getDailyTrend,
  BASELINE_LEARNING_MIN_N,
  type DailyTrendPoint,
} from '../../utils/biomarker';
import { formatReactionMs } from '../../utils/measurementFormat';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import i18n from '../../i18n';

type RouteProps = RouteProp<RootStackParamList, 'CaregiverMeasurement'>;
type Nav = StackNavigationProp<RootStackParamList, 'CaregiverMeasurement'>;

const DISCLAIMER =
  '측정 결과는 일상 변화 기록을 돕기 위한 참고이며 진단·치료가 아니에요. 주치의와 상의해 조정하세요.';

interface SectionStats {
  /** 최근 7일 측정 횟수 */
  count7d: number;
  /** 오늘 측정의 feature 평균값 (today의 measurement 평균). 측정 없으면 null. */
  todayValue: number | null;
  /** baseline mean (학습 완료 시에만 노출 — n>=14일 때 ) */
  baselineMean: number | null;
  /** baseline n */
  baselineN: number;
  /** 30일 시계열 */
  trend: DailyTrendPoint[];
}

const EMPTY_STATS: SectionStats = {
  count7d: 0,
  todayValue: null,
  baselineMean: null,
  baselineN: 0,
  trend: [],
};

export function CaregiverMeasurementScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const { user } = useAuth();

  /** route.params.patientId가 있으면 우선 사용(푸시 진입), 없으면 group lookup */
  const routePatientId = route.params?.patientId ?? null;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string>('환자');

  const [tapStats, setTapStats] = useState<SectionStats>(EMPTY_STATS);
  const [reactionStats, setReactionStats] = useState<SectionStats>(EMPTY_STATS);

  // ── 환자 id/name 확보 ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) route.params.patientId가 있으면 그걸로
        let pid: string | null = routePatientId;

        // 2) 없으면 보호자의 patient_group_id로 같은 그룹의 환자 lookup
        if (!pid) {
          if (!user?.patient_group_id) {
            if (!cancelled) {
              setErrorMsg('연결된 환자가 없어요.');
              setLoading(false);
            }
            return;
          }
          const { data: row, error: rErr } = await supabase
            .from('patient_group_members')
            .select('user_id, users(name)')
            .eq('group_id', user.patient_group_id)
            .eq('role', 'patient')
            .maybeSingle();
          if (rErr) throw rErr;
          pid = (row as any)?.user_id ?? null;
          const nm = (row as any)?.users?.name as string | undefined;
          if (nm && !cancelled) setPatientName(nm);
        }

        if (!pid) {
          if (!cancelled) {
            setErrorMsg('연결된 환자를 찾지 못했어요.');
            setLoading(false);
          }
          return;
        }

        // 푸시 진입 등으로 환자 이름이 아직 없으면 추가 조회
        if (!cancelled && patientName === '환자') {
          const { data: pu } = await supabase
            .from('users')
            .select('name')
            .eq('id', pid)
            .maybeSingle();
          const nm = (pu as any)?.name as string | undefined;
          if (nm && !cancelled) setPatientName(nm);
        }

        if (!cancelled) setPatientId(pid);
      } catch (e: any) {
        console.warn('[CaregiverMeasurement] 환자 확보 실패:', e);
        if (!cancelled) {
          setErrorMsg(e?.message ?? '환자 정보를 불러오지 못했어요.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routePatientId, user?.patient_group_id]); // patientName 의도적 제외(루프 방지)

  // 로딩이 비정상적으로 오래 걸리면(supabase-js PostgREST의 RN 새 아키텍처 hang 등)
  // 무한 스피너에 갇히지 않게 15초 후 에러로 빠져나온다.
  useEffect(() => {
    if (!loading) return;
    const to = setTimeout(() => {
      setErrorMsg((prev) => prev ?? '불러오는 데 시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.');
      setLoading(false);
    }, 15000);
    return () => clearTimeout(to);
  }, [loading]);

  // ── 통계 로딩 ─────────────────────────────────────────────────────
  const loadStats = useCallback(async (uid: string) => {
    // 헬퍼: 한 type의 SectionStats 산출
    const computeFor = async (
      type: 'tap' | 'reaction',
      featureKey: string,
    ): Promise<SectionStats> => {
      // 7일치 측정 + 30일 시계열 + baseline 병렬
      const [recent, trend, baseline] = await Promise.all([
        getMeasurements(uid, { type, sinceDays: 7 }).catch(() => []),
        getDailyTrend(uid, type, featureKey, 30).catch(() => []),
        getBaseline(uid, featureKey).catch(() => null),
      ]);

      // 오늘 값 — 시계열의 마지막 entry (오늘)
      const todayPoint =
        trend.length > 0 ? trend[trend.length - 1].value : null;
      const todayValue =
        todayPoint !== null && Number.isFinite(todayPoint) ? todayPoint : null;

      const baselineN = baseline?.n ?? 0;
      const baselineMean =
        baseline && baseline.n >= BASELINE_LEARNING_MIN_N ? baseline.mean : null;

      return {
        count7d: recent.length,
        todayValue,
        baselineMean,
        baselineN,
        trend,
      };
    };

    const [tap, rt] = await Promise.all([
      computeFor('tap', 'tap_count'),
      computeFor('reaction', 'rt_mean_ms'),
    ]);
    return { tap, rt };
  }, []);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { tap, rt } = await loadStats(patientId);
        if (cancelled) return;
        setTapStats(tap);
        setReactionStats(rt);
        setErrorMsg(null);
        setLoading(false);
      } catch (e: any) {
        console.warn('[CaregiverMeasurement] 통계 로딩 실패:', e);
        if (!cancelled) {
          setErrorMsg(e?.message ?? '측정 결과를 불러오지 못했어요.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, loadStats]);

  // ── 닫기 ─────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  // ── 렌더 ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerBody}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>{i18n.t('loading.loadingMeasurement')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (errorMsg) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.headerBarFallback}>
          <TouchableOpacity onPress={handleClose} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={Colors.text} />
            <Text style={styles.backBtnText}>뒤로</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerBody}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>측정 결과를 불러오지 못했어요</Text>
          <Text style={styles.errorSub}>{errorMsg}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const tapHasAny = tapStats.trend.some((d) => d.value !== null);
  const rtHasAny = reactionStats.trend.some((d) => d.value !== null);
  const anyData = tapHasAny || rtHasAny;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* 헤더 바 */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
          <Text style={styles.backBtnText}>뒤로</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.headerWrap}>
          <Text style={styles.headerTitle}>{patientName}님의 컨디션 측정</Text>
          <Text style={styles.headerSub}>
            최근 측정 기록을 한눈에 확인하실 수 있어요.
          </Text>
        </View>

        {/* 측정 자체가 없는 경우 */}
        {!anyData && (
          <View style={styles.emptyAllCard}>
            <Text style={styles.emptyEmoji}>🖐️</Text>
            <Text style={styles.emptyTitle}>아직 측정 기록이 없어요</Text>
            <Text style={styles.emptySub}>
              {patientName}님이 측정을 하시면 결과가 여기 표시돼요.
            </Text>
          </View>
        )}

        {/* 탭핑 섹션 */}
        {tapHasAny && (
          <MeasurementSection
            emoji="👆"
            title="손가락 두드리기"
            todayLabel="오늘"
            todayValue={tapStats.todayValue}
            todayUnit="번"
            recent7dLabel={`최근 7일 측정 ${tapStats.count7d}회`}
            baselineMean={tapStats.baselineMean}
            baselineN={tapStats.baselineN}
            baselineUnit="번"
            trend={tapStats.trend}
            yLabel="회"
          />
        )}

        {/* 반응속도 섹션 */}
        {rtHasAny && (
          <MeasurementSection
            emoji="⚡"
            title="반응속도"
            todayLabel="오늘 평균"
            todayValue={reactionStats.todayValue}
            todayUnit="ms"
            recent7dLabel={`최근 7일 측정 ${reactionStats.count7d}회`}
            baselineMean={reactionStats.baselineMean}
            baselineN={reactionStats.baselineN}
            baselineUnit="ms"
            trend={reactionStats.trend}
            yLabel="ms"
            isReaction
          />
        )}

        {/* 디스클레이머 */}
        <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// 섹션 컴포넌트 (탭핑/반응속도 공용)
// ────────────────────────────────────────────────────────────────────

interface MeasurementSectionProps {
  emoji: string;
  title: string;
  todayLabel: string;
  todayValue: number | null;
  todayUnit: string;
  recent7dLabel: string;
  baselineMean: number | null;
  baselineN: number;
  baselineUnit: string;
  trend: DailyTrendPoint[];
  yLabel: string;
  /** true면 todayValue/baselineMean을 "0.32초 (320ms)" 형식으로 렌더 */
  isReaction?: boolean;
}

function MeasurementSection(props: MeasurementSectionProps) {
  const {
    emoji,
    title,
    todayLabel,
    todayValue,
    todayUnit,
    recent7dLabel,
    baselineMean,
    baselineN,
    baselineUnit,
    trend,
    yLabel,
    isReaction,
  } = props;

  const learningReady = baselineN >= BASELINE_LEARNING_MIN_N;
  const todayDisplay =
    todayValue !== null && Number.isFinite(todayValue)
      ? Math.round(todayValue)
      : '–';

  // 평소 평균 텍스트 — baseline 단위에 따라 소수 자리 다름
  const avgDisplay =
    baselineMean !== null && Number.isFinite(baselineMean)
      ? baselineUnit === 'ms'
        ? Math.round(baselineMean)
        : baselineMean.toFixed(1)
      : null;

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionEmoji}>{emoji}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>

      {/* 최근 7일 측정 횟수 */}
      <Text style={styles.recent7dText}>{recent7dLabel}</Text>

      {/* 오늘 값 */}
      {isReaction ? (
        <View style={styles.bigNumberRow}>
          <Text style={styles.bigNumberLabel}>{todayLabel}</Text>
          <Text style={styles.bigNumberValueRt}>
            {formatReactionMs(todayValue)}
          </Text>
        </View>
      ) : (
        <View style={styles.bigNumberRow}>
          <Text style={styles.bigNumberLabel}>{todayLabel}</Text>
          <Text style={styles.bigNumberValue}>{todayDisplay}</Text>
          <Text style={styles.bigNumberUnit}>{todayUnit}</Text>
        </View>
      )}

      {/* 평소 평균 비교 / 학습기간 안내 */}
      {learningReady && (isReaction ? baselineMean !== null : avgDisplay !== null) ? (
        <Text style={styles.avgCompareText}>
          {isReaction
            ? `평소 평균 ${formatReactionMs(baselineMean)}`
            : `평소 평균 ${avgDisplay}${baselineUnit}`}
        </Text>
      ) : (
        <Text style={styles.learningText}>
          기록을 모으는 중이에요 ({baselineN} / {BASELINE_LEARNING_MIN_N}일)
        </Text>
      )}

      {/* 30일 추세 그래프 */}
      <View style={styles.trendWrap}>
        <MiniBarTrend
          days={trend}
          baselineMean={learningReady ? baselineMean : null}
          yLabel={yLabel}
        />
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// 스타일 (MeasurementResultScreen과 일관 — 디자인 시스템 재사용)
// ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.background,
  },
  headerBarFallback: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.background,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignSelf: 'flex-start',
    gap: 2,
  },
  backBtnText: {
    fontSize: 18,
    color: Colors.text,
    fontWeight: '600',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },

  headerWrap: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 6,
  },
  headerSub: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 22,
  },

  emptyAllCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 15,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 21,
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
    marginBottom: 10,
  },
  sectionEmoji: { fontSize: 22 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },

  recent7dText: {
    fontSize: 15,
    color: Colors.textSub,
    fontWeight: '600',
    marginBottom: 10,
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
    fontSize: 48,
    fontWeight: '800',
    color: Colors.dark,
    lineHeight: 54,
  },
  /** 반응속도 전용 — "0.32초 (320ms)"가 길어서 폰트 축소 */
  bigNumberValueRt: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.dark,
    lineHeight: 32,
  },
  bigNumberUnit: {
    fontSize: 22,
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

  trendWrap: {
    marginTop: 4,
  },

  disclaimerText: {
    fontSize: 13,
    color: Colors.textHint,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 4,
  },

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
    fontSize: 20,
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
