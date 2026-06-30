import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { SkeletonList } from '../../components/common/SkeletonCard';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { useRecordDetailData } from '../../hooks/useRecordDetailData';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

type RouteProps = RouteProp<MenuStackParamList, 'RecordDetail'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Period = '이번 주' | '이번 달' | '최근 3개월';

const PERIODS: Period[] = ['이번 주', '이번 달', '최근 3개월'];

const prevLabels: Record<Period, string> = {
  '이번 주': '지난주',
  '이번 달': '지난달',
  '최근 3개월': '지난 3개월',
};

const TIME_COLORS_PALETTE = ['#F44336', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0'];

const itemMeta: Record<string, { icon: IoniconName; label: string }> = {
  medication: { icon: 'medkit-outline', label: '약 복용' },
  bodyState: { icon: 'happy-outline', label: '몸 상태' },
  mood: { icon: 'happy', label: '기분 상태' },
  sleep: { icon: 'moon-outline', label: '수면' },
  constipation: { icon: 'water-outline', label: '변비' },
  exercise: { icon: 'fitness-outline', label: '운동' },
};

import { triggerLabelToDisplay } from '../../hooks/useRecordDetailData';

const VISIBLE_COUNT = 4;
const BAR_MAX_HEIGHT = 100;
const CHART_HEIGHT = 170;

function ArrowBadge({ curr, prev, size = 20 }: { curr: number | string; prev: number | string; size?: number }) {
  const d = parseFloat(String(curr)) - parseFloat(String(prev));
  if (isNaN(d)) return null;
  if (d > 0) return <Text style={{ color: '#4CAF50', fontSize: size, fontWeight: '700' }}>↑</Text>;
  if (d < 0) return <Text style={{ color: '#F44336', fontSize: size, fontWeight: '700' }}>↓</Text>;
  return <Text style={{ color: Colors.textHint, fontSize: size }}>→</Text>;
}

interface BarChartProps {
  values: number[];
  labels: string[];
  color: string;
  max: number;
  unit: string;
}

function BarChart({ values, labels, color, max, unit }: BarChartProps) {
  const [offset, setOffset] = useState(Math.max(0, values.length - VISIBLE_COUNT));

  const visible = values.slice(offset, offset + VISIBLE_COUNT);
  const visibleLabels = labels.slice(offset, offset + VISIBLE_COUNT);
  const canPrev = offset > 0;
  const canNext = offset < values.length - VISIBLE_COUNT;

  return (
    <View>
      <View style={chartStyles.chartArea}>
        {visible.map((v, i) => {
          const barH = Math.max((v / max) * BAR_MAX_HEIGHT, 6);
          const isLast = i === visible.length - 1;
          const barColor = isLast ? color : color + 'AA';
          return (
            <View key={i} style={chartStyles.barCol}>
              <Text style={chartStyles.barValue}>
                {typeof v === 'number' && v % 1 !== 0 ? v.toFixed(1) : v}
                {unit}
              </Text>
              <View style={[chartStyles.bar, { height: barH, backgroundColor: barColor }]} />
              <Text style={chartStyles.barLabel}>{visibleLabels[i]}</Text>
            </View>
          );
        })}
      </View>
      <View style={chartStyles.navRow}>
        <TouchableOpacity
          style={[chartStyles.navBtn, !canPrev && chartStyles.navBtnDisabled]}
          onPress={() => canPrev && setOffset(Math.max(0, offset - 1))}
          activeOpacity={canPrev ? 0.7 : 1}
        >
          <Text style={[chartStyles.navBtnText, !canPrev && chartStyles.navBtnTextDisabled]}>
            ← 이전
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[chartStyles.navBtn, !canNext && chartStyles.navBtnDisabled]}
          onPress={() =>
            canNext && setOffset(Math.min(values.length - VISIBLE_COUNT, offset + 1))
          }
          activeOpacity={canNext ? 0.7 : 1}
        >
          <Text style={[chartStyles.navBtnText, !canNext && chartStyles.navBtnTextDisabled]}>
            다음 →
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    gap: 6,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  barValue: {
    fontSize: 16,
    color: Colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  bar: {
    width: '80%',
    borderRadius: 6,
  },
  barLabel: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 20,
  },
  navRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  navBtn: {
    flex: 1,
    height: 64,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    backgroundColor: '#f5f5f5',
    borderColor: Colors.border,
  },
  navBtnText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },
  navBtnTextDisabled: {
    color: Colors.textHint,
  },
});

export function RecordDetailScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<any>();
  const { type, period: initialPeriod } = route.params;

  const [period, setPeriod] = useState<Period>((initialPeriod as Period) || '이번 주');
  const { unreadCount } = useNotificationBadge();

  const meta = itemMeta[type];
  const prevLabel = prevLabels[period];
  const isTimeItem = type === 'bodyState' || type === 'mood';
  const isMedItem = type === 'medication';

  // 실제 Supabase 데이터
  const { summarySlot, trendSeries, timeSeriesMap, mealTimeSeriesMap, loading, error } = useRecordDetailData(
    type as any,
    period,
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <TopBar
        title={meta.label}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      {/* 기간 탭 */}
      <View style={styles.tabRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.tabBtn, period === p && styles.tabBtnActive]}
            onPress={() => setPeriod(p)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabBtnText, period === p && styles.tabBtnTextActive]}>
              {p}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 로딩 / 에러 */}
      {loading && (
        <SkeletonList count={3} visible={loading} style={styles.skeletonWrap} />
      )}
      {!loading && !!error && (
        <View style={styles.stateBox}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textHint} />
          <Text style={styles.stateText}>{error}</Text>
        </View>
      )}

      {!loading && !error && !summarySlot && (
        <View style={styles.stateBox}>
          <Ionicons name="bar-chart-outline" size={40} color={Colors.textHint} />
          <Text style={styles.stateText}>
            이 기간에 기록된 데이터가 없어요.{'\n'}기록을 먼저 입력해보세요.
          </Text>
        </View>
      )}

      {!loading && !error && !!summarySlot && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

          {/* 일반 항목 현황 카드 */}
          {!isTimeItem && summarySlot && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name={meta.icon} size={24} color={Colors.primary} />
                <Text style={styles.cardSubTitle}>{period} 현황</Text>
              </View>
              <View style={styles.cardValueRow}>
                <Text style={styles.cardBigValue}>
                  {summarySlot.current > 0
                    ? `${type === 'sleep' ? summarySlot.current.toFixed(1) : summarySlot.current}${summarySlot.unit}`
                    : '-'}
                </Text>
                {summarySlot.current > 0 && (
                  <ArrowBadge curr={summarySlot.current} prev={summarySlot.prev} size={28} />
                )}
              </View>
              <Text style={styles.cardPrev}>
                {prevLabel}{' '}
                {summarySlot.prev > 0
                  ? `${type === 'sleep' ? summarySlot.prev.toFixed(1) : summarySlot.prev}${summarySlot.unit}`
                  : '기록 없음'}
              </Text>
            </View>
          )}

          {/* 약복용 식사 시간대별 현황 */}
          {isMedItem && summarySlot?.mealTimeSlots && Object.keys(summarySlot.mealTimeSlots).length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="time-outline" size={24} color={Colors.primary} />
                <Text style={styles.cardSubTitle}>시간대별 복용 현황</Text>
              </View>
              {Object.entries(summarySlot.mealTimeSlots).map(([meal, vals], i) => {
                const color = TIME_COLORS_PALETTE[i % TIME_COLORS_PALETTE.length];
                return (
                  <View key={meal} style={[styles.timeSlot, { borderLeftColor: color }]}>
                    <Text style={styles.timeSlotLabel}>{summarySlot.mealSlotLabels?.[meal] ?? meal}</Text>
                    <View style={styles.timeSlotRow}>
                      <Text style={[styles.timeSlotValue, { color }]}>
                        {vals.current > 0 ? `${vals.current}회` : '-'}
                      </Text>
                      {vals.current > 0 && (
                        <ArrowBadge curr={vals.current} prev={vals.prev} size={22} />
                      )}
                      <Text style={styles.timeSlotPrev}>
                        {prevLabel} {vals.prev > 0 ? `${vals.prev}회` : '기록 없음'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* 시간대별 현황 카드 */}
          {isTimeItem && summarySlot?.timeSlots && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name={meta.icon} size={24} color={Colors.primary} />
                <Text style={styles.cardSubTitle}>{period} 시간대별 현황</Text>
              </View>
              <Text style={styles.cardNote}>
                ※ 약효 추적 알림을 통해 입력한 기록만 반영돼요
              </Text>
              {Object.entries(summarySlot.timeSlots).map(([triggerLabel, vals], i) => {
                const color = TIME_COLORS_PALETTE[i % TIME_COLORS_PALETTE.length];
                const displayLabel = triggerLabelToDisplay(triggerLabel);
                return (
                  <View
                    key={triggerLabel}
                    style={[styles.timeSlot, { borderLeftColor: color }]}
                  >
                    <Text style={styles.timeSlotLabel}>{displayLabel}</Text>
                    <View style={styles.timeSlotRow}>
                      <Text style={[styles.timeSlotValue, { color }]}>
                        {vals.current > 0 ? vals.current.toFixed(1) + '점' : '-'}
                      </Text>
                      {vals.current > 0 && (
                        <ArrowBadge curr={vals.current} prev={vals.prev} size={22} />
                      )}
                      <Text style={styles.timeSlotPrev}>
                        {prevLabel} {vals.prev > 0 ? vals.prev.toFixed(1) + '점' : '기록 없음'}
                      </Text>
                    </View>
                  </View>
                );
              })}
              {Object.keys(summarySlot.timeSlots).length === 0 && (
                <Text style={styles.cardNote}>이 기간에 알림을 통한 기록이 없어요</Text>
              )}
            </View>
          )}

          {/* 시간대별 트렌드 (bodyState/mood) */}
          {isTimeItem && timeSeriesMap && Object.entries(timeSeriesMap).map(([triggerLabel, series], i) => {
            const color = series.color;
            const displayLabel = triggerLabelToDisplay(triggerLabel);
            return (
              <View key={triggerLabel} style={styles.card}>
                <View style={styles.trendTitleRow}>
                  <View style={[styles.trendDot, { backgroundColor: color }]} />
                  <Text style={styles.trendTitle}>{displayLabel} 트렌드</Text>
                </View>
                <BarChart
                  values={series.points.map(p => p.value)}
                  labels={series.points.map(p => p.label)}
                  color={color}
                  max={series.max}
                  unit={series.unit}
                />
              </View>
            );
          })}

          {/* 일반 트렌드 */}
          {!isTimeItem && trendSeries && (
            <View style={styles.card}>
              <Text style={styles.trendTitle}>
                {period === '이번 주' ? '주별' : period === '이번 달' ? '월별' : '3개월별'} 트렌드
              </Text>
              <BarChart
                values={trendSeries.points.map(p => p.value)}
                labels={trendSeries.points.map(p => p.label)}
                color={trendSeries.color}
                max={trendSeries.max}
                unit={trendSeries.unit}
              />
            </View>
          )}

          {/* 약복용 시간대별 트렌드 */}
          {isMedItem && mealTimeSeriesMap && Object.entries(mealTimeSeriesMap).map(([meal, series], i) => (
            <View key={meal} style={styles.card}>
              <View style={styles.trendTitleRow}>
                <View style={[styles.trendDot, { backgroundColor: series.color }]} />
                <Text style={styles.trendTitle}>{summarySlot.mealSlotLabels?.[meal] ?? meal} 트렌드</Text>
              </View>
              <BarChart
                values={series.points.map(p => p.value)}
                labels={series.points.map(p => p.label)}
                color={series.color}
                max={series.max}
                unit={series.unit}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  // ── 기간 탭 ──
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabBtnText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  tabBtnTextActive: { color: Colors.white },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  skeletonWrap: { paddingHorizontal: 16, paddingTop: 16 },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardSubTitle: { fontSize: 18, color: Colors.textSub, fontWeight: '600' },
  cardValueRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardBigValue: { fontSize: 48, fontWeight: '800', color: Colors.text },
  cardPrev: { fontSize: 17, color: Colors.textSub, marginTop: 8 },
  cardNote: { fontSize: 16, color: Colors.textSub, marginBottom: 18, lineHeight: 22 },

  timeSlot: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f9f9f9',
    borderLeftWidth: 5,
    marginBottom: 10,
  },
  timeSlotLabel: { fontSize: 18, fontWeight: '700', color: Colors.textSub, marginBottom: 8 },
  timeSlotRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeSlotValue: { fontSize: 32, fontWeight: '700' },
  timeSlotPrev: { fontSize: 16, color: Colors.textSub },

  trendTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  trendDot: { width: 14, height: 14, borderRadius: 7 },
  trendTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 18 },

  // ── 로딩 / 에러 ──
  stateBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  stateText: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
  },
});
