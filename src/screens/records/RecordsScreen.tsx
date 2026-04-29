import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { useRecordsData } from '../../hooks/useRecordsData';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { navigateTo } from '../../navigation/navigationRef';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'Records'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Period = '이번 주' | '이번 달' | '최근 3개월';
type ItemKey = 'medication' | 'bodyState' | 'mood' | 'sleep' | 'constipation' | 'exercise';

const PERIODS: Period[] = ['이번 주', '이번 달', '최근 3개월'];

const prevLabels: Record<Period, string> = {
  '이번 주': '지난주',
  '이번 달': '지난달',
  '최근 3개월': '지난 3개월',
};

const ITEMS: { key: ItemKey; icon: IoniconName; label: string; accentColor: string }[] = [
  { key: 'medication', icon: 'medkit-outline', label: '약 복용', accentColor: Colors.primary },
  { key: 'bodyState', icon: 'happy-outline', label: '몸 상태', accentColor: '#E65100' },
  { key: 'mood', icon: 'happy', label: '기분 상태', accentColor: '#FF8F00' },
  { key: 'sleep', icon: 'moon-outline', label: '수면', accentColor: '#7B1FA2' },
  { key: 'constipation', icon: 'water-outline', label: '변비', accentColor: '#0277BD' },
  { key: 'exercise', icon: 'fitness-outline', label: '운동', accentColor: '#BF360C' },
];

// trigger_time_label → minutesToLabel 역방향 변환 (표시용)
const TRIGGER_LABEL_TO_DISPLAY: Record<string, string> = {
  after_medication: '복용 직후',
  '30min_after': '복용 30분 후',
  '2hour_after': '복용 2시간 후',
};

function triggerLabelToDisplay(label: string): string {
  return TRIGGER_LABEL_TO_DISPLAY[label] ?? label;
}

// Build rows of 2 from flat ITEMS list
const ITEM_ROWS: ItemKey[][] = ITEMS.reduce<ItemKey[][]>((rows, item, i) => {
  if (i % 2 === 0) rows.push([item.key]);
  else rows[rows.length - 1].push(item.key);
  return rows;
}, []);

export function RecordsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [period, setPeriod] = useState<Period>('이번 주');
  const { unreadCount } = useNotificationBadge();

  // Supabase 실제 데이터
  const { summary, loading, error, refresh } = useRecordsData(period);

  // 화면 포커스 시 데이터 재조회
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleItemPress = (key: ItemKey) => {
    navigation.navigate('RecordDetail', { type: key, period });
  };

  // ── 표시값 계산 (실제 데이터 기반) ─────────────────────────────────────────
  function getDisplayValue(key: ItemKey): { value: string; subLabel?: string } {
    if (!summary) return { value: '-' };

    if (key === 'medication') {
      return { value: `${summary.medication.current}%` };
    }
    if (key === 'bodyState') {
      const entries = Object.values(summary.bodyState);
      if (entries.length === 0) return { value: '-' };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const midLabel = Object.keys(summary.bodyState)[midIdx] ?? '';
      return {
        value: midData.current > 0 ? midData.current.toFixed(1) + '점' : '-',
        subLabel: midLabel ? triggerLabelToDisplay(midLabel) + ' 기준' : undefined,
      };
    }
    if (key === 'mood') {
      const entries = Object.values(summary.mood);
      if (entries.length === 0) return { value: '-' };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const midLabel = Object.keys(summary.mood)[midIdx] ?? '';
      return {
        value: midData.current > 0 ? midData.current.toFixed(1) + '점' : '-',
        subLabel: midLabel ? triggerLabelToDisplay(midLabel) + ' 기준' : undefined,
      };
    }
    if (key === 'sleep') {
      return {
        value: summary.sleep.current > 0 ? summary.sleep.current.toFixed(1) + '점' : '-',
      };
    }
    if (key === 'constipation') {
      return { value: `${summary.constipation.currentDays}일` };
    }
    if (key === 'exercise') {
      return {
        value: `${summary.exercise.currentCount}회 / ${summary.exercise.currentMinutes}분`,
      };
    }
    return { value: '-' };
  }

  // ── 변화 정보 계산 (실제 데이터 기반) ──────────────────────────────────────
  function getChangeInfo(key: ItemKey): { text: string; positive: boolean | null } {
    if (!summary) return { text: '', positive: null };
    const prevLabel = prevLabels[period];

    if (key === 'medication') {
      const diff = summary.medication.current - summary.medication.prev;
      if (diff === 0) return { text: `${prevLabel}과 같아요`, positive: null };
      return diff > 0
        ? { text: `${prevLabel}보다 ${diff}%p 올랐어요`, positive: true }
        : { text: `${prevLabel}보다 ${Math.abs(diff)}%p 낮아요`, positive: false };
    }
    if (key === 'bodyState') {
      const entries = Object.values(summary.bodyState);
      if (entries.length === 0) return { text: '', positive: null };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const diff = midData.current - midData.prev;
      if (midData.current === 0 && midData.prev === 0) return { text: '', positive: null };
      if (Math.abs(diff) < 0.01) return { text: `${prevLabel}과 같아요`, positive: null };
      return diff > 0
        ? { text: `${prevLabel}보다 ${diff.toFixed(1)}점 좋아졌어요`, positive: true }
        : { text: `${prevLabel}보다 ${Math.abs(diff).toFixed(1)}점 낮아요`, positive: false };
    }
    if (key === 'mood') {
      const entries = Object.values(summary.mood);
      if (entries.length === 0) return { text: '', positive: null };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const diff = midData.current - midData.prev;
      if (midData.current === 0 && midData.prev === 0) return { text: '', positive: null };
      if (Math.abs(diff) < 0.01) return { text: `${prevLabel}과 같아요`, positive: null };
      return diff > 0
        ? { text: `${prevLabel}보다 ${diff.toFixed(1)}점 좋아졌어요`, positive: true }
        : { text: `${prevLabel}보다 ${Math.abs(diff).toFixed(1)}점 낮아요`, positive: false };
    }
    if (key === 'sleep') {
      const diff = summary.sleep.current - summary.sleep.prev;
      if (summary.sleep.current === 0 && summary.sleep.prev === 0) return { text: '', positive: null };
      if (Math.abs(diff) < 0.01) return { text: `${prevLabel}과 같아요`, positive: null };
      return diff > 0
        ? { text: `${prevLabel}보다 ${diff.toFixed(1)}점 좋아졌어요`, positive: true }
        : { text: `${prevLabel}보다 ${Math.abs(diff).toFixed(1)}점 나빠요`, positive: false };
    }
    if (key === 'constipation') {
      const diff = summary.constipation.currentDays - summary.constipation.prevDays;
      if (diff === 0) return { text: `${prevLabel}과 같아요`, positive: null };
      return diff > 0
        ? { text: `${prevLabel}보다 ${diff}일 늘었어요`, positive: true }
        : { text: `${prevLabel}보다 ${Math.abs(diff)}일 줄었어요`, positive: false };
    }
    if (key === 'exercise') {
      const diff = summary.exercise.currentCount - summary.exercise.prevCount;
      if (diff === 0) return { text: `${prevLabel}과 같아요`, positive: null };
      return diff > 0
        ? { text: `${prevLabel}보다 ${diff}회 더 했어요`, positive: true }
        : { text: `${prevLabel}보다 ${Math.abs(diff)}회 줄었어요`, positive: false };
    }
    return { text: '', positive: null };
  }

  // 요약 배너 약 복용률
  const medCurrent = summary?.medication.current ?? 0;
  const medDiff = summary ? summary.medication.current - summary.medication.prev : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <TopBar
        title="기록 보기"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigateTo('NotificationHistory', { mode: 'all' })}
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

      {/* 로딩 / 에러 상태 */}
      {loading && (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.stateText}>데이터를 불러오는 중이에요...</Text>
        </View>
      )}
      {!loading && !!error && (
        <View style={styles.stateBox}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textHint} />
          <Text style={styles.stateText}>{error}</Text>
        </View>
      )}

      {!loading && !error && !summary && (
        <View style={styles.stateBox}>
          <Ionicons name="bar-chart-outline" size={40} color={Colors.textHint} />
          <Text style={styles.stateText}>아직 기록된 데이터가 없어요.{'\n'}약 복용 및 몸 상태를 기록해보세요.</Text>
        </View>
      )}

      {!loading && !error && !!summary && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 요약 배너 */}
          <View style={styles.banner}>
            <Ionicons name="medkit" size={24} color={Colors.primary} />
            <Text style={styles.bannerText}>
              {period} 약 복용률 <Text style={styles.bannerHighlight}>{medCurrent}%</Text>
              {summary && medDiff !== 0
                ? ` · ${prevLabels[period]}보다 ${Math.abs(medDiff)}%p ${medDiff >= 0 ? '올랐어요 ↑' : '낮아요 ↓'}`
                : ''}
            </Text>
          </View>

          {/* 2열 그리드 */}
          <View style={styles.grid}>
            {ITEM_ROWS.map((rowKeys, ri) => (
              <View key={ri} style={styles.gridRow}>
                {rowKeys.map(key => {
                  const item = ITEMS.find(it => it.key === key)!;
                  const display = getDisplayValue(key);
                  const change = getChangeInfo(key);
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.gridCard}
                      onPress={() => handleItemPress(key)}
                      activeOpacity={0.7}
                    >
                      {/* 헤더 */}
                      <View style={styles.cardHeader}>
                        <View
                          style={[
                            styles.cardIconBg,
                            { backgroundColor: item.accentColor + '20' },
                          ]}
                        >
                          <Ionicons name={item.icon} size={20} color={item.accentColor} />
                        </View>
                        <Text style={styles.cardLabel} numberOfLines={1}>
                          {item.label}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={Colors.textHint}
                        />
                      </View>

                      {/* 값 */}
                      <Text
                        style={[styles.cardValue, { color: item.accentColor }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {display.value}
                      </Text>
                      {display.subLabel ? (
                        <Text style={styles.cardSubLabel}>{display.subLabel}</Text>
                      ) : null}

                      {/* 변화 설명 */}
                      {!!change.text && (
                        <Text
                          style={[
                            styles.cardChange,
                            change.positive === true
                              ? styles.changePos
                              : change.positive === false
                              ? styles.changeNeg
                              : styles.changeNeutral,
                          ]}
                          numberOfLines={2}
                        >
                          {change.text}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {/* 홀수 마지막 행 빈 칸 */}
                {rowKeys.length === 1 && <View style={styles.gridCardPlaceholder} />}
              </View>
            ))}
          </View>
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

  // ── 요약 배너 ──
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  bannerText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    lineHeight: 26,
  },
  bannerHighlight: {
    color: Colors.primary,
    fontWeight: '800',
  },

  // ── 그리드 ──
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },

  gridCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    minHeight: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  gridCardPlaceholder: { flex: 1 },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardIconBg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },

  cardValue: {
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 2,
  },
  cardSubLabel: {
    fontSize: 16,
    color: Colors.textHint,
    marginBottom: 6,
  },
  cardChange: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
    marginTop: 6,
  },
  changePos: { color: '#388E3C' },
  changeNeg: { color: '#C62828' },
  changeNeutral: { color: Colors.textHint },

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
