import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { MenuStackParamList } from '../../navigation/MenuNavigator';

type RouteProps = RouteProp<MenuStackParamList, 'RecordDetail'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Period = '이번 주' | '이번 달' | '최근 3개월';

const PERIODS: Period[] = ['이번 주', '이번 달', '최근 3개월'];

const prevLabels: Record<Period, string> = {
  '이번 주': '지난주',
  '이번 달': '지난달',
  '최근 3개월': '지난 3개월',
};

const timeColors: Record<string, string> = {
  '복용 직후': '#F44336',
  '30분 후': '#4CAF50',
  '2시간 후': '#2196F3',
};

const itemMeta: Record<string, { icon: IoniconName; label: string }> = {
  medication: { icon: 'medkit-outline', label: '약 복용' },
  bodyState: { icon: 'happy-outline', label: '몸 상태' },
  mood: { icon: 'happy', label: '기분 상태' },
  sleep: { icon: 'moon-outline', label: '수면' },
  constipation: { icon: 'water-outline', label: '변비' },
  exercise: { icon: 'fitness-outline', label: '운동' },
};

const summaryData = {
  '이번 주': {
    medication: { current: 90, prev: 88, unit: '%' },
    bodyState: {
      '복용 직후': { current: 2.1, prev: 2.0 },
      '30분 후': { current: 3.8, prev: 3.5 },
      '2시간 후': { current: 3.2, prev: 3.0 },
    },
    mood: {
      '복용 직후': { current: 2.3, prev: 2.1 },
      '30분 후': { current: 3.5, prev: 3.2 },
      '2시간 후': { current: 3.0, prev: 2.9 },
    },
    sleep: { current: 3.6, prev: 3.2, unit: '점' },
    constipation: { current: '4일', prev: '3일', unit: '' },
    exercise: { current: '4회 / 95분', prev: '2회 / 60분', unit: '' },
  },
  '이번 달': {
    medication: { current: 88, prev: 85, unit: '%' },
    bodyState: {
      '복용 직후': { current: 2.0, prev: 1.9 },
      '30분 후': { current: 3.5, prev: 3.2 },
      '2시간 후': { current: 3.0, prev: 2.8 },
    },
    mood: {
      '복용 직후': { current: 2.2, prev: 2.0 },
      '30분 후': { current: 3.3, prev: 3.0 },
      '2시간 후': { current: 2.9, prev: 2.7 },
    },
    sleep: { current: 3.4, prev: 3.0, unit: '점' },
    constipation: { current: '18일', prev: '15일', unit: '' },
    exercise: { current: '14회 / 380분', prev: '10회 / 280분', unit: '' },
  },
  '최근 3개월': {
    medication: { current: 87, prev: 83, unit: '%' },
    bodyState: {
      '복용 직후': { current: 2.0, prev: 1.8 },
      '30분 후': { current: 3.4, prev: 3.1 },
      '2시간 후': { current: 2.9, prev: 2.7 },
    },
    mood: {
      '복용 직후': { current: 2.1, prev: 1.9 },
      '30분 후': { current: 3.2, prev: 2.9 },
      '2시간 후': { current: 2.8, prev: 2.6 },
    },
    sleep: { current: 3.3, prev: 2.9, unit: '점' },
    constipation: { current: '54일', prev: '44일', unit: '' },
    exercise: { current: '42회 / 1140분', prev: '30회 / 820분', unit: '' },
  },
};

const trendData: Record<string, any> = {
  medication: {
    주별: {
      values: [82, 84, 85, 88, 87, 90, 90, 88, 90],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '%',
      color: '#4CAF50',
      max: 100,
    },
    월별: {
      values: [80, 83, 85, 85, 88],
      labels: ['5개월전', '4개월전', '3개월전', '지난달', '이번달'],
      unit: '%',
      color: '#4CAF50',
      max: 100,
    },
    '3개월별': {
      values: [75, 78, 83, 87],
      labels: ['9개월전', '6개월전', '지난3개월', '최근3개월'],
      unit: '%',
      color: '#4CAF50',
      max: 100,
    },
  },
  bodyState: {
    '복용 직후': {
      values: [1.8, 1.9, 2.0, 2.0, 2.1, 2.0, 2.1, 2.0, 2.1],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '점',
      color: '#F44336',
      max: 5,
    },
    '30분 후': {
      values: [3.0, 3.2, 3.3, 3.4, 3.5, 3.6, 3.5, 3.5, 3.8],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '점',
      color: '#4CAF50',
      max: 5,
    },
    '2시간 후': {
      values: [2.6, 2.7, 2.8, 2.9, 3.0, 3.0, 3.1, 3.0, 3.2],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '점',
      color: '#2196F3',
      max: 5,
    },
  },
  mood: {
    '복용 직후': {
      values: [1.9, 2.0, 2.0, 2.1, 2.1, 2.2, 2.1, 2.1, 2.3],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '점',
      color: '#F44336',
      max: 5,
    },
    '30분 후': {
      values: [2.8, 3.0, 3.1, 3.2, 3.2, 3.3, 3.3, 3.2, 3.5],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '점',
      color: '#4CAF50',
      max: 5,
    },
    '2시간 후': {
      values: [2.5, 2.6, 2.7, 2.8, 2.8, 2.9, 2.9, 2.9, 3.0],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '점',
      color: '#2196F3',
      max: 5,
    },
  },
  sleep: {
    주별: {
      values: [2.5, 2.6, 2.8, 2.9, 3.0, 3.1, 3.2, 3.2, 3.6],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '점',
      color: '#9C27B0',
      max: 5,
    },
    월별: {
      values: [2.6, 2.8, 3.0, 3.0, 3.4],
      labels: ['5개월전', '4개월전', '3개월전', '지난달', '이번달'],
      unit: '점',
      color: '#9C27B0',
      max: 5,
    },
    '3개월별': {
      values: [2.5, 2.9, 3.3],
      labels: ['9개월전', '지난3개월', '최근3개월'],
      unit: '점',
      color: '#9C27B0',
      max: 5,
    },
  },
  constipation: {
    주별: {
      values: [2, 3, 3, 4, 3, 4, 3, 3, 4],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '일',
      color: '#FF9800',
      max: 7,
    },
    월별: {
      values: [10, 13, 15, 15, 18],
      labels: ['5개월전', '4개월전', '3개월전', '지난달', '이번달'],
      unit: '일',
      color: '#FF9800',
      max: 31,
    },
    '3개월별': {
      values: [30, 44, 54],
      labels: ['9개월전', '지난3개월', '최근3개월'],
      unit: '일',
      color: '#FF9800',
      max: 92,
    },
  },
  exercise: {
    주별: {
      values: [1, 2, 2, 3, 2, 3, 2, 2, 4],
      labels: ['8주전', '7주전', '6주전', '5주전', '4주전', '3주전', '2주전', '지난주', '이번주'],
      unit: '회',
      color: '#FF5722',
      max: 7,
    },
    월별: {
      values: [6, 8, 10, 10, 14],
      labels: ['5개월전', '4개월전', '3개월전', '지난달', '이번달'],
      unit: '회',
      color: '#FF5722',
      max: 31,
    },
    '3개월별': {
      values: [18, 30, 42],
      labels: ['9개월전', '지난3개월', '최근3개월'],
      unit: '회',
      color: '#FF5722',
      max: 100,
    },
  },
};

const periodToTrendKey: Record<Period, string> = {
  '이번 주': '주별',
  '이번 달': '월별',
  '최근 3개월': '3개월별',
};

const VISIBLE_COUNT = 4;

function ArrowBadge({ curr, prev, size = 18 }: { curr: number | string; prev: number | string; size?: number }) {
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

  const BAR_MAX_HEIGHT = 80;

  return (
    <View>
      <View style={chartStyles.chartArea}>
        {visible.map((v, i) => {
          const barH = Math.max((v / max) * BAR_MAX_HEIGHT, 4);
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
    height: 120,
    gap: 8,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  barValue: {
    fontSize: 13,
    color: Colors.textSub,
    fontWeight: '700',
  },
  bar: {
    width: '100%',
    borderRadius: 6,
  },
  barLabel: {
    fontSize: 11,
    color: Colors.textHint,
    textAlign: 'center',
    lineHeight: 14,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  navBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  navBtnDisabled: {
    backgroundColor: '#f5f5f5',
  },
  navBtnText: {
    fontSize: 15,
    color: Colors.textSub,
    fontWeight: '600',
  },
  navBtnTextDisabled: {
    color: Colors.textHint,
  },
});

export function RecordDetailScreen() {
  const route = useRoute<RouteProps>();
  const { type, period: initialPeriod } = route.params;

  const [period, setPeriod] = useState<Period>((initialPeriod as Period) || '이번 주');

  const meta = itemMeta[type];
  const summary = summaryData[period][type as keyof typeof summaryData['이번 주']];
  const prevLabel = prevLabels[period];
  const trendKey = periodToTrendKey[period];
  const isTimeItem = type === 'bodyState' || type === 'mood';

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title={meta.label} showBack />

      {/* 기간 탭 */}
      <View style={styles.tabRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.tabBtn, period === p && styles.tabBtnActive]}
            onPress={() => setPeriod(p)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabBtnText, period === p && styles.tabBtnTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* 일반 항목 현황 카드 */}
        {!isTimeItem && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name={meta.icon} size={22} color={Colors.primary} />
              <Text style={styles.cardSubTitle}>{period} 현황</Text>
            </View>
            <View style={styles.cardValueRow}>
              <Text style={styles.cardBigValue}>
                {(summary as any).current}{(summary as any).unit}
              </Text>
              <ArrowBadge curr={(summary as any).current} prev={(summary as any).prev} size={24} />
            </View>
            <Text style={styles.cardPrev}>
              {prevLabel} {(summary as any).prev}{(summary as any).unit}
            </Text>
          </View>
        )}

        {/* 시간대별 현황 카드 */}
        {isTimeItem && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name={meta.icon} size={22} color={Colors.primary} />
              <Text style={styles.cardSubTitle}>{period} 시간대별 현황</Text>
            </View>
            <Text style={styles.cardNote}>
              ※ 약효 추적 알림을 통해 입력한 기록만 반영돼요
            </Text>
            {Object.entries(summary as Record<string, { current: number; prev: number }>).map(
              ([time, vals]) => (
                <View
                  key={time}
                  style={[styles.timeSlot, { borderLeftColor: timeColors[time] }]}
                >
                  <Text style={styles.timeSlotLabel}>{time}</Text>
                  <View style={styles.timeSlotRow}>
                    <Text style={[styles.timeSlotValue, { color: timeColors[time] }]}>
                      {vals.current.toFixed(1)}점
                    </Text>
                    <ArrowBadge curr={vals.current} prev={vals.prev} size={20} />
                    <Text style={styles.timeSlotPrev}>
                      {prevLabel} {vals.prev.toFixed(1)}점
                    </Text>
                  </View>
                </View>
              ),
            )}
          </View>
        )}

        {/* 시간대별 트렌드 (bodyState/mood) */}
        {isTimeItem &&
          Object.entries(trendData[type] || {}).map(([time, d]: [string, any]) => (
            <View key={time} style={styles.card}>
              <View style={styles.trendTitleRow}>
                <View style={[styles.trendDot, { backgroundColor: timeColors[time] }]} />
                <Text style={styles.trendTitle}>{time} 트렌드</Text>
              </View>
              <BarChart
                values={d.values}
                labels={d.labels}
                color={d.color}
                max={d.max}
                unit={d.unit}
              />
            </View>
          ))}

        {/* 일반 트렌드 */}
        {!isTimeItem && trendData[type]?.[trendKey] && (
          <View style={styles.card}>
            <Text style={styles.trendTitle}>{trendKey} 트렌드</Text>
            <BarChart
              values={trendData[type][trendKey].values}
              labels={trendData[type][trendKey].labels}
              color={trendData[type][trendKey].color}
              max={trendData[type][trendKey].max}
              unit={trendData[type][trendKey].unit}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.border,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSub },
  tabBtnTextActive: { color: Colors.white },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

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

  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardSubTitle: { fontSize: 15, color: Colors.textHint },
  cardValueRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardBigValue: { fontSize: 36, fontWeight: '700', color: Colors.text },
  cardPrev: { fontSize: 15, color: Colors.textHint, marginTop: 6 },
  cardNote: { fontSize: 13, color: Colors.textHint, marginBottom: 16 },

  timeSlot: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f9f9f9',
    borderLeftWidth: 5,
    marginBottom: 10,
  },
  timeSlotLabel: { fontSize: 16, fontWeight: '700', color: Colors.textSub, marginBottom: 6 },
  timeSlotRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeSlotValue: { fontSize: 30, fontWeight: '700' },
  timeSlotPrev: { fontSize: 14, color: Colors.textHint },

  trendTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  trendDot: { width: 12, height: 12, borderRadius: 6 },
  trendTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 16 },
});
