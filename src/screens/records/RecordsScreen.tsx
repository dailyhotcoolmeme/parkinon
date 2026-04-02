import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { MenuStackParamList } from '../../navigation/MenuNavigator';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'Records'>;
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

const ITEMS: { key: string; icon: IoniconName; label: string }[] = [
  { key: 'medication', icon: 'medkit-outline', label: '약 복용' },
  { key: 'bodyState', icon: 'happy-outline', label: '몸 상태' },
  { key: 'mood', icon: 'happy', label: '기분 상태' },
  { key: 'sleep', icon: 'moon-outline', label: '수면' },
  { key: 'constipation', icon: 'water-outline', label: '변비' },
  { key: 'exercise', icon: 'fitness-outline', label: '운동' },
];

type ItemKey = 'medication' | 'bodyState' | 'mood' | 'sleep' | 'constipation' | 'exercise';

function ArrowBadge({ curr, prev, size = 18 }: { curr: number | string; prev: number | string; size?: number }) {
  const d = parseFloat(String(curr)) - parseFloat(String(prev));
  if (isNaN(d)) return null;
  if (d > 0) return <Text style={{ color: '#4CAF50', fontSize: size, fontWeight: '700' }}>↑</Text>;
  if (d < 0) return <Text style={{ color: '#F44336', fontSize: size, fontWeight: '700' }}>↓</Text>;
  return <Text style={{ color: Colors.textHint, fontSize: size }}>→</Text>;
}

export function RecordsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [period, setPeriod] = useState<Period>('이번 주');

  const summary = summaryData[period];
  const prevLabel = prevLabels[period];

  const handleItemPress = (key: ItemKey) => {
    navigation.navigate('RecordDetail', { type: key, period });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="기록 보기" showBack />

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

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>{period} 요약</Text>

        <View style={styles.listCard}>
          {ITEMS.map((item, i) => {
            const s = summary[item.key as ItemKey];
            const isTimeItem = item.key === 'bodyState' || item.key === 'mood';

            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.row, i < ITEMS.length - 1 && styles.rowBorder]}
                onPress={() => handleItemPress(item.key as ItemKey)}
                activeOpacity={0.7}
              >
                {/* 헤더 행 */}
                <View style={styles.rowHeader}>
                  <Ionicons name={item.icon} size={24} color={Colors.primary} style={styles.rowIcon} />
                  <Text style={styles.rowLabel}>{item.label}</Text>

                  {!isTimeItem && (
                    <View style={styles.rowValueArea}>
                      <Text style={styles.rowValue}>
                        {(s as any).current}{(s as any).unit}
                      </Text>
                      <Text style={styles.rowPrev}>
                        {prevLabel} {(s as any).prev}{(s as any).unit}
                      </Text>
                    </View>
                  )}
                  {!isTimeItem && (
                    <ArrowBadge curr={(s as any).current} prev={(s as any).prev} size={18} />
                  )}
                  <Ionicons name="chevron-forward" size={20} color={Colors.textHint} style={{ marginLeft: 4 }} />
                </View>

                {/* 시간대별 미니 카드 */}
                {isTimeItem && (
                  <View style={styles.timeCards}>
                    {Object.entries(s as Record<string, { current: number; prev: number }>).map(
                      ([time, vals]) => (
                        <View
                          key={time}
                          style={[styles.timeCard, { borderTopColor: timeColors[time] }]}
                        >
                          <Text style={styles.timeCardLabel}>{time}</Text>
                          <View style={styles.timeCardRow}>
                            <Text style={[styles.timeCardValue, { color: timeColors[time] }]}>
                              {vals.current.toFixed(1)}
                            </Text>
                            <ArrowBadge curr={vals.current} prev={vals.prev} size={14} />
                          </View>
                          <Text style={styles.timeCardPrev}>
                            {prevLabel} {vals.prev.toFixed(1)}
                          </Text>
                        </View>
                      ),
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
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
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: Colors.border,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabBtnText: { fontSize: 17, fontWeight: '600', color: Colors.textSub },
  tabBtnTextActive: { color: Colors.white },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  sectionLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 14,
  },

  listCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  row: { padding: 20 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },

  rowHeader: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { marginRight: 12 },
  rowLabel: { fontSize: 20, fontWeight: '600', color: Colors.text, flex: 1 },

  rowValueArea: { alignItems: 'flex-end', marginRight: 6 },
  rowValue: { fontSize: 20, fontWeight: '700', color: Colors.text },
  rowPrev: { fontSize: 15, color: Colors.textHint },

  timeCards: { flexDirection: 'row', gap: 8, paddingLeft: 36, marginTop: 14 },
  timeCard: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderTopWidth: 3,
  },
  timeCardLabel: { fontSize: 15, color: Colors.textSub, marginBottom: 4 },
  timeCardRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeCardValue: { fontSize: 20, fontWeight: '700' },
  timeCardPrev: { fontSize: 14, color: Colors.textHint, marginTop: 2 },
});
