// 디지털 바이오마커 — 측정 기록 보기 화면
//
// 탭 구조: 🖐️ 손가락 두드리기 / ⚡ 반응속도 (한 번에 한 탭만 표시)
// 각 탭 구성:
//   - 일별 막대그래프(MiniBarTrend 재사용, 7일 또는 30일 토글)
//   - 그래프 상단 "7일/30일" 보기 토글 (기본 30일, 탭마다 독립)
//   - 그 아래 체크박스 "가장 좋은 기록 적용" (기본 OFF=평균, ON=최고기록)
//     · 탭핑: 최고 = 그 날 max tap_count
//     · 반응속도: 최고 = 그 날 min rt_mean_ms (짧을수록 좋음)
//     · 탭마다 독립 체크박스
//   - 그래프 아래 개별 기록 리스트(토글 범위와 동일: 7일 모드면 최근 7일치, 30일 모드면 최근 30건)
//     · 탭핑:     "YYYY-MM-DD HH:MM · 47회"
//     · 반응속도: "YYYY-MM-DD HH:MM · 0.32초 (320ms)"
//     · 리스트는 내부 스크롤 없이 페이지 전체 ScrollView에 자연 나열
//   - 0건 탭: 그래프 자리 "아직 기록이 없어요" 안내, 리스트 미노출
//
// 기본 선택 탭: 손가락 두드리기
// 디스클레이머 1줄 (스펙 §6.6 블랙리스트 준수).
// 보호자 진입 차단 — 환자 본인만. 보호자가 들어오면 popToTop.
//
// 의학 판정 표현 금지 — "OFF/이상/악화" 금지(§6.6).

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
import { useNavigation, useRoute, StackActions } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { MiniBarTrend } from '../../components/measurement/MiniBarTrend';
import {
  getDailyTrend,
  getMeasurementsWithFeature,
  type DailyTrendPoint,
  type MeasurementWithFeatureRow,
  type MedPhaseFilter,
} from '../../utils/biomarker';
import type { MeasurementMedPhase } from '../../types/database';
import { formatReactionMs, formatDateTimeWithWeekday } from '../../utils/measurementFormat';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import i18n from '../../i18n';
import {
  MeasurementInfoModal,
  type MeasurementInfoType,
} from '../../components/measurement/MeasurementInfoModal';

type Nav = StackNavigationProp<RootStackParamList, 'MeasurementRecords'>;
type MeasurementRecordsRoute = RouteProp<RootStackParamList, 'MeasurementRecords'>;

const DISCLAIMER =
  '측정 결과는 일상 변화 기록을 돕기 위한 참고이며 진단·치료가 아니에요. 주치의와 상의해 조정하세요.';

interface SectionData {
  trend: DailyTrendPoint[];
  list: MeasurementWithFeatureRow[];
  /** 필터링 전 전체 리스트(평균 박스용) — 시점별 평균 계산에 사용 */
  rawList: MeasurementWithFeatureRow[];
}

const EMPTY_SECTION: SectionData = { trend: [], list: [], rawList: [] };

/** 보기 범위 토글 — 7일 또는 30일 */
type RangeDays = 7 | 30;

/** 상단 탭 — 손가락 두드리기 / 반응속도 */
type TabKey = 'tap' | 'reaction';

/** 시점 필터 — 전체 / 30분 후 / 2시간 후 / 자율 측정 */
type PhaseFilter = MedPhaseFilter; // 'all' | '30m' | '2h' | 'self_initiated' | 'other'

/** 시점 필터 옵션(가로 4버튼). 'other'는 비노출 — 일반 사용자는 자율로 인지 */
const PHASE_FILTER_OPTIONS: { key: 'all' | '30m' | '2h' | 'self_initiated'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: '30m', label: '30분 후' },
  { key: '2h', label: '2시간 후' },
  { key: 'self_initiated', label: '자율 측정' },
];

/** 시점 뱃지 색상 정의 */
interface PhaseBadgeStyle {
  bg: string;
  fg: string;
  label: string;
}
const PHASE_BADGE: Record<MeasurementMedPhase, PhaseBadgeStyle> = {
  '30m': { bg: '#E8F5E9', fg: '#1B5E20', label: '30분 후' },
  '2h': { bg: '#E3F2FD', fg: '#0D47A1', label: '2시간 후' },
  'self_initiated': { bg: '#ECEFF1', fg: '#455A64', label: '자율' },
  'other': { bg: '#ECEFF1', fg: '#455A64', label: '자율' },
};

/** 시점별 평균 박스용 통계 */
interface PhaseAverages {
  all: number | null;
  '30m': number | null;
  '2h': number | null;
  'self_initiated': number | null;
}

export function MeasurementRecordsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<MeasurementRecordsRoute>();
  const { user } = useAuth();

  // 보호자 관람용 환자 id/이름 (없으면 본인 데이터 모드)
  const patientId = route.params?.patientId;
  const patientName = route.params?.patientName;
  // 데이터를 읽을 대상 id — 보호자 관람이면 환자 id, 아니면 본인 id
  const targetId = patientId ?? user?.id;
  // 보호자 관람 모드 여부(읽기 전용 — 본인 전용 액션 숨김 판단에 사용)
  const isViewingPatient = !!patientId;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 현재 선택된 탭 (기본: 손가락 두드리기)
  const [activeTab, setActiveTab] = useState<TabKey>('tap');

  // 섹션별 데이터
  const [tapData, setTapData] = useState<SectionData>(EMPTY_SECTION);
  const [reactionData, setReactionData] = useState<SectionData>(EMPTY_SECTION);

  // 섹션별 "가장 좋은 기록 적용" 체크박스 (기본 OFF = 평균)
  const [tapBestMode, setTapBestMode] = useState(false);
  const [reactionBestMode, setReactionBestMode] = useState(false);

  // 섹션별 보기 범위 토글 (기본 30일)
  const [tapRange, setTapRange] = useState<RangeDays>(30);
  const [reactionRange, setReactionRange] = useState<RangeDays>(30);

  // 섹션별 시점 필터 (기본 '전체') — 30분 후/2시간 후/자율 측정
  const [tapPhase, setTapPhase] = useState<PhaseFilter>('all');
  const [reactionPhase, setReactionPhase] = useState<PhaseFilter>('all');

  // 임상 공신력 설명 모달
  const [infoType, setInfoType] = useState<MeasurementInfoType | null>(null);

  // 진입 가드: patientId가 있으면 보호자도 환자 데이터 관람 허용.
  // patientId 없이 보호자가 직접 진입(본인 측정 없음)하는 비정상 케이스만 popToTop으로 차단.
  useEffect(() => {
    if (!patientId && user && user.role === 'caregiver') {
      navigation.dispatch(StackActions.popToTop());
    }
  }, [patientId, user, navigation]);

  // ── 데이터 로딩 ───────────────────────────────────────────────────
  // - trend는 medPhase 필터를 서버에 위임(쿼리 1회).
  // - rawList는 시점 필터 없이 충분히 넉넉한 limit(120)으로 받아 클라이언트에서 필터링(평균 박스 + 리스트).
  //   리스트 표시는 rangeDays(7/30)에 맞춰 클라이언트에서 잘라낸다.
  const loadSection = useCallback(
    async (
      type: 'tap' | 'reaction',
      featureKey: string,
      bestMode: boolean,
      rangeDays: RangeDays,
      phase: PhaseFilter
    ): Promise<SectionData> => {
      if (!targetId) return EMPTY_SECTION;
      const [trend, rawList] = await Promise.all([
        getDailyTrend(targetId, type, featureKey, rangeDays, bestMode ? 'best' : 'mean', phase),
        // 평균 박스 + 리스트 공용 — 시점 필터 없이 최근 120건(7일/30일 모두 커버).
        getMeasurementsWithFeature(targetId, type, featureKey, 120),
      ]);
      // rangeDays 기준 시간 컷오프(7일 모드면 7일 이내만)
      const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
      const inRange = rawList.filter((r) => new Date(r.started_at).getTime() >= cutoff);
      // 시점 필터 적용 후 표시 limit(7일 모드: 7건, 30일 모드: 30건)
      const filtered = phase === 'all'
        ? inRange
        : inRange.filter((r) => (phase === 'self_initiated'
            ? r.med_phase === 'self_initiated' || r.med_phase === 'other'
            : r.med_phase === phase));
      const listLimit = rangeDays === 7 ? 7 : 30;
      return { trend, list: filtered.slice(0, listLimit), rawList: inRange };
    },
    [targetId]
  );

  const loadAll = useCallback(async () => {
    // targetId가 있으면 로드 — 보호자 관람(patientId 지정) 포함. 대상 없으면 중단.
    if (!targetId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [tap, reaction] = await Promise.all([
        loadSection('tap', 'tap_count', tapBestMode, tapRange, tapPhase),
        loadSection('reaction', 'rt_mean_ms', reactionBestMode, reactionRange, reactionPhase),
      ]);
      setTapData(tap);
      setReactionData(reaction);
    } catch (e: any) {
      console.warn('[MeasurementRecords] 데이터 로드 실패:', e);
      setErrorMsg('기록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, [
    targetId,
    loadSection,
    tapBestMode,
    reactionBestMode,
    tapRange,
    reactionRange,
    tapPhase,
    reactionPhase,
  ]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 체크박스 토글 시 해당 섹션 trend만 다시 계산
  // (list는 mode와 무관하므로 재조회 불필요 — 그래프만 모드 변경)
  // 위 loadAll이 의존성으로 mode를 가지므로 자동 재실행됨.

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  // 헤더 타이틀 — 보호자 관람(환자 이름 있음)이면 "{환자이름}님 컨디션 측정 기록"
  const headerTitle =
    isViewingPatient && patientName
      ? `${patientName}님 컨디션 측정 기록`
      : '측정 기록 보기';

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <Header onBack={handleBack} title={headerTitle} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>{i18n.t('loading.loadingRecords')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (errorMsg) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <Header onBack={handleBack} title={headerTitle} />
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.danger} />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadAll} activeOpacity={0.85}>
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 활성 탭에 따른 accent 색상 (탭 헤더 강조용)
  const tapAccent = Colors.primary;
  const reactionAccent = '#F4A300';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Header onBack={handleBack} title={headerTitle} />

      {/* 상단 탭 헤더 — 손가락 두드리기 / 반응속도 */}
      <View
        style={styles.tabBar}
        accessibilityRole="radiogroup"
        accessibilityLabel="측정 종류 선택"
      >
        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'tap' && [
              styles.tabBtnActive,
              { backgroundColor: tapAccent, borderColor: tapAccent },
            ],
          ]}
          onPress={() => setActiveTab('tap')}
          activeOpacity={0.7}
          accessibilityRole="radio"
          accessibilityState={{ selected: activeTab === 'tap' }}
          accessibilityLabel="손가락 두드리기 탭"
        >
          <Text
            style={[
              styles.tabBtnText,
              activeTab === 'tap' && styles.tabBtnTextActive,
            ]}
          >
            🖐️ 손가락 두드리기
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'reaction' && [
              styles.tabBtnActive,
              { backgroundColor: reactionAccent, borderColor: reactionAccent },
            ],
          ]}
          onPress={() => setActiveTab('reaction')}
          activeOpacity={0.7}
          accessibilityRole="radio"
          accessibilityState={{ selected: activeTab === 'reaction' }}
          accessibilityLabel="반응속도 탭"
        >
          <Text
            style={[
              styles.tabBtnText,
              activeTab === 'reaction' && styles.tabBtnTextActive,
            ]}
          >
            ⚡ 반응속도
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* "이 측정은 왜?" — 임상 공신력 설명 모달 진입 */}
        <TouchableOpacity
          style={[
            styles.whyBtn,
            {
              borderColor: activeTab === 'tap' ? tapAccent : reactionAccent,
            },
          ]}
          onPress={() => setInfoType(activeTab)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            activeTab === 'tap'
              ? '손가락 두드리기 측정 설명 보기'
              : '반응속도 측정 설명 보기'
          }
        >
          <Text
            style={[
              styles.whyBtnText,
              {
                color: activeTab === 'tap' ? tapAccent : reactionAccent,
              },
            ]}
          >
            📋 이 측정은 왜?
          </Text>
        </TouchableOpacity>

        {activeTab === 'tap' ? (
          <Section
            unitLabel="회"
            bestMode={tapBestMode}
            onToggleBestMode={() => setTapBestMode(v => !v)}
            rangeDays={tapRange}
            onChangeRange={setTapRange}
            phase={tapPhase}
            onChangePhase={setTapPhase}
            data={tapData}
            formatValue={(v) => `${Math.round(v)}회`}
            accentColor={tapAccent}
          />
        ) : (
          <Section
            unitLabel="ms"
            bestMode={reactionBestMode}
            onToggleBestMode={() => setReactionBestMode(v => !v)}
            rangeDays={reactionRange}
            onChangeRange={setReactionRange}
            phase={reactionPhase}
            onChangePhase={setReactionPhase}
            data={reactionData}
            formatValue={(v) => formatReactionMs(v)}
            // 평균 박스(좁은 폭)에서는 ms 괄호 없이 "0.56초"만 — 1줄 보장
            formatAvgValue={(v) => `${(Math.round(v) / 1000).toFixed(2)}초`}
            accentColor={reactionAccent}
          />
        )}

        <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
      </ScrollView>

      {/* 임상 공신력 설명 모달 */}
      <MeasurementInfoModal
        visible={infoType !== null}
        type={infoType ?? activeTab}
        onClose={() => setInfoType(null)}
      />
    </SafeAreaView>
  );
}

// ─── Header ─────────────────────────────────────────────────────────

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={onBack}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="chevron-back" size={26} color={Colors.text} />
        <Text style={styles.backText}>뒤로</Text>
      </TouchableOpacity>
      <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.topRight} />
    </View>
  );
}

// ─── Section ────────────────────────────────────────────────────────

interface SectionProps {
  unitLabel: string;
  bestMode: boolean;
  onToggleBestMode: () => void;
  rangeDays: RangeDays;
  onChangeRange: (r: RangeDays) => void;
  phase: PhaseFilter;
  onChangePhase: (p: PhaseFilter) => void;
  data: SectionData;
  formatValue: (v: number) => string;
  /** 시점별 평균 박스 전용 — 좁은 박스에 맞춰 단순한 형식(예: 반응속도는 "0.56초")으로 표시.
   *  없으면 formatValue를 그대로 사용. */
  formatAvgValue?: (v: number) => string;
  accentColor: string;
}

/** 시점별 평균 계산 — rawList에서 그룹화. 데이터 없는 시점은 null */
function computePhaseAverages(rawList: MeasurementWithFeatureRow[]): PhaseAverages {
  const buckets: Record<'all' | '30m' | '2h' | 'self_initiated', { sum: number; n: number }> = {
    all: { sum: 0, n: 0 },
    '30m': { sum: 0, n: 0 },
    '2h': { sum: 0, n: 0 },
    'self_initiated': { sum: 0, n: 0 },
  };
  for (const r of rawList) {
    if (r.value === null || !Number.isFinite(r.value)) continue;
    buckets.all.sum += r.value;
    buckets.all.n += 1;
    if (r.med_phase === '30m' || r.med_phase === '2h') {
      buckets[r.med_phase].sum += r.value;
      buckets[r.med_phase].n += 1;
    } else {
      // 'self_initiated' 또는 'other' 모두 "자율"로 합산
      buckets.self_initiated.sum += r.value;
      buckets.self_initiated.n += 1;
    }
  }
  const toAvg = (b: { sum: number; n: number }) => (b.n > 0 ? b.sum / b.n : null);
  return {
    all: toAvg(buckets.all),
    '30m': toAvg(buckets['30m']),
    '2h': toAvg(buckets['2h']),
    'self_initiated': toAvg(buckets.self_initiated),
  };
}

function Section({
  unitLabel,
  bestMode,
  onToggleBestMode,
  rangeDays,
  onChangeRange,
  phase,
  onChangePhase,
  data,
  formatValue,
  formatAvgValue,
  accentColor,
}: SectionProps) {
  const hasAnyRecord = data.rawList.length > 0;
  const averages = computePhaseAverages(data.rawList);

  return (
    <View style={styles.sectionBlock}>
      <View style={[styles.section, { borderLeftColor: accentColor, borderLeftWidth: 4 }]}>
      {!hasAnyRecord ? (
        // 0건 안내
        <View style={styles.emptyCard}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyTitle}>아직 기록이 없어요</Text>
          <Text style={styles.emptyDesc}>
            컨디션 측정하기에서 첫 측정을 시작해보세요.
          </Text>
        </View>
      ) : (
        <>
          {/* 7일 / 30일 보기 토글 — 섹션 독립, 기본 30일 */}
          <View
            style={styles.rangeToggleRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="보기 기간 선택"
          >
            <TouchableOpacity
              style={[
                styles.rangeBtn,
                rangeDays === 7 && [
                  styles.rangeBtnActive,
                  { backgroundColor: accentColor, borderColor: accentColor },
                ],
              ]}
              onPress={() => onChangeRange(7)}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ selected: rangeDays === 7 }}
              accessibilityLabel="7일 보기"
            >
              <Text
                style={[
                  styles.rangeBtnText,
                  rangeDays === 7 && styles.rangeBtnTextActive,
                ]}
              >
                7일
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.rangeBtn,
                rangeDays === 30 && [
                  styles.rangeBtnActive,
                  { backgroundColor: accentColor, borderColor: accentColor },
                ],
              ]}
              onPress={() => onChangeRange(30)}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ selected: rangeDays === 30 }}
              accessibilityLabel="30일 보기"
            >
              <Text
                style={[
                  styles.rangeBtnText,
                  rangeDays === 30 && styles.rangeBtnTextActive,
                ]}
              >
                30일
              </Text>
            </TouchableOpacity>
          </View>

          {/* 시점 필터 — 가로 4버튼(전체 / 30분 후 / 2시간 후 / 자율 측정).
              60대 가독성: 16~18sp, 48dp+. 그래프·리스트·평균 박스 모두 이 필터에 동기화. */}
          <View
            style={styles.phaseFilterRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="측정 시점 선택"
          >
            {PHASE_FILTER_OPTIONS.map((opt) => {
              const selected = phase === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.phaseBtn,
                    selected && {
                      backgroundColor: accentColor,
                      borderColor: accentColor,
                    },
                  ]}
                  onPress={() => onChangePhase(opt.key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${opt.label} 보기`}
                >
                  <Text
                    style={[
                      styles.phaseBtnText,
                      selected && styles.phaseBtnTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* "가장 좋은 기록 적용" 체크박스 — 행 전체 탭 가능(접근성) */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={onToggleBestMode}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: bestMode }}
            accessibilityLabel="가장 좋은 기록 적용"
          >
            <View
              style={[
                styles.checkbox,
                bestMode && {
                  backgroundColor: accentColor,
                  borderColor: accentColor,
                },
              ]}
            >
              {bestMode && (
                <Ionicons name="checkmark-sharp" size={20} color={Colors.white} />
              )}
            </View>
            <Text style={styles.checkboxLabel}>가장 좋은 기록 적용</Text>
            <Text style={styles.checkboxHint}>
              {bestMode ? '최고 기록' : '평균'}
            </Text>
          </TouchableOpacity>

          {/* 시점별 평균 박스 4개 — wearing-off 패턴 한눈에 비교 */}
          <View style={styles.avgBoxesRow}>
            {(['all', '30m', '2h', 'self_initiated'] as const).map((k) => {
              const labelMap: Record<typeof k, string> = {
                all: '전체 평균',
                '30m': '30분 후',
                '2h': '2시간 후',
                'self_initiated': '자율',
              } as const;
              const v = averages[k];
              const isSelected =
                (k === 'all' && phase === 'all') ||
                (k !== 'all' && phase === k);
              return (
                <View
                  key={k}
                  style={[
                    styles.avgBox,
                    isSelected && {
                      borderColor: accentColor,
                      backgroundColor: '#FFFDF6',
                    },
                  ]}
                >
                  <Text style={styles.avgBoxLabel} numberOfLines={1}>
                    {labelMap[k]}
                  </Text>
                  <Text
                    style={[
                      styles.avgBoxValue,
                      { color: v !== null ? accentColor : Colors.textHint },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {v !== null ? (formatAvgValue ?? formatValue)(v) : '–'}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* 추세 그래프 — 토글에 따라 7일 또는 30일. 각 막대 위에 값 표시(측정 기록 화면 전용) */}
          <MiniBarTrend
            days={data.trend}
            baselineMean={null}
            yLabel={unitLabel}
            height={140}
            showValues
            rangeDays={rangeDays}
          />

          {/* 개별 기록 리스트 — 페이지 전체 ScrollView에 자연 나열(내부 스크롤 없음) */}
          <View style={styles.listWrap}>
            <Text style={styles.listTitle}>
              {rangeDays === 7 ? '최근 기록 (7일)' : '최근 기록 (30일)'}
              {phase !== 'all' &&
                ` · ${PHASE_FILTER_OPTIONS.find((o) => o.key === phase)?.label ?? ''}`}
            </Text>
            {data.list.length === 0 ? (
              <Text style={styles.listEmpty}>해당 시점의 기록이 없어요</Text>
            ) : (
              data.list.map((row, idx) => {
                const badge = PHASE_BADGE[row.med_phase] ?? PHASE_BADGE.self_initiated;
                return (
                  <View
                    key={row.measurement_id}
                    style={[
                      styles.listRow,
                      idx === data.list.length - 1 && styles.listRowLast,
                    ]}
                  >
                    <Text style={styles.listDate} numberOfLines={1}>
                      {formatDateTimeWithWeekday(row.started_at)}
                    </Text>
                    <View
                      style={[styles.phaseBadge, { backgroundColor: badge.bg }]}
                      accessibilityLabel={`측정 시점 ${badge.label}`}
                    >
                      <Text style={[styles.phaseBadgeText, { color: badge.fg }]}>
                        {badge.label}
                      </Text>
                    </View>
                    <Text style={[styles.listValue, { color: accentColor }]} numberOfLines={1}>
                      {row.value !== null ? formatValue(row.value) : '–'}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </>
      )}
      </View>
    </View>
  );
}

// ─── 스타일 ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

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
  backText: { fontSize: 18, color: Colors.text, fontWeight: '600' },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '700', color: Colors.text },
  topRight: { width: 64 },

  // 상단 탭 헤더 — 60대 가독성: 큰 글씨, 56dp+ 터치 영역, 선택 강조
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: Colors.background,
  },
  // 전역 필터칩 표준 = 영상목록 필터(오너 확정). 활성색은 인라인 accent 유지.
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  tabBtnActive: {
    // 활성 탭은 인라인으로 accent 색상 적용
  },
  tabBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
  },
  tabBtnTextActive: {
    color: Colors.white,
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  loadingText: { fontSize: 18, color: Colors.textSub },
  errorText: { fontSize: 18, color: Colors.text, textAlign: 'center', lineHeight: 26 },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 36,
    minHeight: 56,
    justifyContent: 'center',
  },
  retryBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },

  // "이 측정은 왜?" 진입 버튼 — 탭 colors 인라인 적용
  whyBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whyBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },

  // 섹션 전체 블록 — 단일 탭만 표시되므로 하단 여백 최소화
  sectionBlock: {
    marginBottom: 16,
  },
  section: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // 7일/30일 보기 토글 행 — 60대 가독성: 큰 글씨·56dp 터치 영역
  rangeToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  rangeBtn: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  rangeBtnActive: {
    // accent 색상은 인라인으로 적용
  },
  rangeBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
  },
  rangeBtnTextActive: {
    color: Colors.white,
  },

  // 체크박스 행
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 56,
    backgroundColor: Colors.light,
    borderRadius: 12,
    marginBottom: 12,
    gap: 12,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.textHint,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  checkboxHint: {
    fontSize: 16,
    color: Colors.textSub,
    fontWeight: '600',
  },

  // 빈 상태
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    backgroundColor: Colors.light,
    borderRadius: 14,
    gap: 8,
  },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { fontSize: 19, fontWeight: '700', color: Colors.text },
  emptyDesc: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 24,
  },

  // 개별 기록 리스트 — 페이지 전체 ScrollView에 자연 나열
  listWrap: { marginTop: 16 },
  listTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
    minHeight: 52,
  },
  listRowLast: { borderBottomWidth: 0 },
  listDate: { fontSize: 17, color: Colors.text, fontWeight: '600', flex: 1 },
  listSep: { fontSize: 18, color: Colors.textHint },
  listValue: { fontSize: 18, color: Colors.primary, fontWeight: '700', minWidth: 72, textAlign: 'right' },
  listEmpty: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    paddingVertical: 24,
  },

  // 시점 필터 — 가로 4버튼. 글씨 16~18sp, 48dp+ 터치
  phaseFilterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  // 전역 필터칩 표준 = 영상목록 필터(오너 확정).
  phaseBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  phaseBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
  },
  phaseBtnTextActive: {
    color: Colors.white,
  },

  // 시점별 평균 박스 4개
  avgBoxesRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  avgBox: {
    flex: 1,
    minHeight: 64,
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avgBoxLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 4,
  },
  avgBoxValue: {
    fontSize: 17,
    fontWeight: '800',
  },

  // 시점 뱃지 (리스트 항목)
  phaseBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  phaseBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },

  disclaimer: {
    fontSize: 13,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    paddingHorizontal: 8,
  },
});
