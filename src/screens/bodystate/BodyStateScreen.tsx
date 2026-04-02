import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BodyStatePopupFlow } from './BodyStatePopupFlow';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';

const DUMMY_USER_ROLE: 'patient' | 'caregiver_same' | 'caregiver_separate' = 'patient';
const DUMMY_PATIENT_NAME = '홍길동';
const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

interface BodyRecord {
  id: string;
  time: string;
  period: string;
  trigger: string;
  bodyScore: number;
  prevBodyScore?: number;
  moodScore: number;
  prevMoodScore?: number;
  sleepScore?: number;
  prevSleepScore?: number;
  constipation?: boolean;
}

const MOCK_RECORDS: BodyRecord[] = [
  { id: '1', time: '오전 8:30', period: '아침', trigger: '복용 직후', bodyScore: 4, prevBodyScore: 3, moodScore: 4, prevMoodScore: 2, sleepScore: 3, prevSleepScore: 4 },
  { id: '2', time: '오전 10:30', period: '아침', trigger: '2시간 후', bodyScore: 3, prevBodyScore: 4, moodScore: 3, prevMoodScore: 4 },
  { id: '3', time: '오후 12:15', period: '점심', trigger: '복용 직후', bodyScore: 3, prevBodyScore: 3, moodScore: 4, prevMoodScore: 3 },
  { id: '4', time: '오후 1:00', period: '점심', trigger: '30분 후', bodyScore: 4, prevBodyScore: 3, moodScore: 4, prevMoodScore: 4, constipation: false },
  { id: '5', time: '오후 6:10', period: '저녁', trigger: '복용 직후', bodyScore: 4, prevBodyScore: 4, moodScore: 3, prevMoodScore: 3 },
];

function getTodayLabel(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${date}일 ${dayNames[now.getDay()]}`;
}

const PERIOD_EMOJI: Record<string, string> = {
  '아침': '🌅', '점심': '☀️', '저녁': '🌙', '취침': '😴'
};

export function BodyStateScreen() {
  const [records, setRecords] = useState<BodyRecord[]>(MOCK_RECORDS);
  const [showFlow, setShowFlow] = useState(false);
  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const handleSaveRecord = (record: Omit<BodyRecord, 'id' | 'time' | 'trigger' | 'period'>) => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const ampm = h < 12 ? '오전' : '오후';
    const hour = h % 12 === 0 ? 12 : h % 12;
    const time = `${ampm} ${hour}:${m.toString().padStart(2, '0')}`;
    const period = h < 11 ? '아침' : h < 15 ? '점심' : h < 20 ? '저녁' : '취침';

    setRecords(prev => [{ id: Date.now().toString(), time, period, trigger: '직접 입력', ...record }, ...prev]);
    setShowFlow(false);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title="파킨온"
        showMenu
        onMenuPress={() => navigation.navigate('Menu')}
      />

      {/* 날짜 헤더 */}
      <View style={styles.dateHeader}>
        <Text style={styles.dateText}>{getTodayLabel()}</Text>
        <TouchableOpacity style={styles.calBtn}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={[
              styles.mainButton,
              DUMMY_USER_ROLE === 'caregiver_separate' && styles.mainButtonDisabled,
            ]}
            onPress={() => {
              if (DUMMY_USER_ROLE === 'caregiver_separate') return;
              if (DUMMY_USER_ROLE === 'caregiver_same') {
                setShowCaregiverConfirm(true);
              } else {
                setShowFlow(true);
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.mainButtonInner}>
              <Ionicons name="happy" size={40} color={Colors.white} />
              <Text style={styles.mainButtonText}>몸상태 기록하기</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.outlineButton}
            onPress={() => navigation.navigate('VideoRecord')}
            activeOpacity={0.85}
          >
            <View style={styles.outlineButtonInner}>
              <Ionicons name="film-outline" size={24} color={Colors.primary} />
              <Text style={styles.outlineButtonText}>영상 기록하기</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>오늘 몸상태 기록</Text>
            <View style={styles.divider} />
          </View>
          {['아침', '점심', '저녁', '취침'].map(period => {
            const periodRecords = records.filter(r => r.period === period);
            if (periodRecords.length === 0) return null;
            return (
              <View key={period} style={styles.periodGroup}>
                <Text style={styles.periodTitle}>{PERIOD_EMOJI[period] ?? ''} {period} 약 복용 후</Text>
                {periodRecords.map(record => (
                  <BodyRecordCard key={record.id} record={record} />
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={DUMMY_PATIENT_NAME}
        onConfirm={() => { setShowCaregiverConfirm(false); setShowFlow(true); }}
        onCancel={() => setShowCaregiverConfirm(false)}
      />
      <BodyStatePopupFlow
        visible={showFlow}
        onClose={() => setShowFlow(false)}
        onSave={handleSaveRecord}
        showSleep={records.length === 0}
        showConstipation={false}
      />
    </SafeAreaView>
  );
}

function getScoreEmoji(score: number): string {
  if (score >= 5) return '😄';
  if (score >= 4) return '🙂';
  if (score >= 3) return '😐';
  if (score >= 2) return '😞';
  return '😣';
}

function getScoreColor(score: number): string {
  if (score >= 4) return Colors.primary;
  if (score >= 3) return Colors.accent;
  return '#F44336';
}

function BodyRecordCard({ record }: { record: BodyRecord }) {
  return (
    <View style={cardStyles.card}>
      {/* 시간 + 트리거 */}
      <View style={cardStyles.header}>
        <Text style={cardStyles.time}>{record.time}</Text>
        <View style={cardStyles.triggerBadge}>
          <Text style={cardStyles.triggerText}>{record.trigger}</Text>
        </View>
      </View>

      {/* 몸상태 + 기분 점수 */}
      <View style={cardStyles.scoreRow}>
        <View style={cardStyles.scoreBox}>
          <Text style={cardStyles.scoreLabel}>몸상태</Text>
          <View style={cardStyles.scoreValueRow}>
            <Text style={cardStyles.scoreEmoji}>{getScoreEmoji(record.bodyScore)}</Text>
            <Text style={[cardStyles.scoreNum, { color: getScoreColor(record.bodyScore) }]}>
              {record.bodyScore}점
            </Text>
          </View>
        </View>
        <View style={cardStyles.scoreDivider} />
        <View style={cardStyles.scoreBox}>
          <Text style={cardStyles.scoreLabel}>기분</Text>
          <View style={cardStyles.scoreValueRow}>
            <Text style={cardStyles.scoreEmoji}>{getScoreEmoji(record.moodScore)}</Text>
            <Text style={[cardStyles.scoreNum, { color: getScoreColor(record.moodScore) }]}>
              {record.moodScore}점
            </Text>
          </View>
        </View>
      </View>

      {/* 수면 (선택) */}
      {record.sleepScore !== undefined && (
        <View style={cardStyles.extraRow}>
          <Text style={cardStyles.extraLabel}>수면</Text>
          <Text style={cardStyles.scoreEmoji}>{getScoreEmoji(record.sleepScore)}</Text>
          <Text style={[cardStyles.extraValue, { color: getScoreColor(record.sleepScore) }]}>
            {record.sleepScore}점
          </Text>
        </View>
      )}

      {/* 변비 (선택) */}
      {record.constipation !== undefined && (
        <View style={cardStyles.extraRow}>
          <Text style={cardStyles.extraLabel}>변비</Text>
          <Text style={cardStyles.extraValue}>
            {record.constipation ? '😖 있었어요' : '😊 없었어요'}
          </Text>
        </View>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  time: { fontSize: 18, fontWeight: '700', color: Colors.text },
  triggerBadge: {
    backgroundColor: Colors.light,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  triggerText: { fontSize: 15, fontWeight: '600', color: Colors.dark },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  scoreBox: { flex: 1, alignItems: 'center' },
  scoreDivider: { width: 1, height: 44, backgroundColor: Colors.border },
  scoreLabel: { fontSize: 15, color: Colors.textSub, marginBottom: 6, fontWeight: '600' },
  scoreValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreEmoji: { fontSize: 26 },
  scoreNum: { fontSize: 22, fontWeight: '800' },

  extraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  extraLabel: { fontSize: 16, color: Colors.textSub, fontWeight: '600', width: 36 },
  extraValue: { fontSize: 18, fontWeight: '600', color: Colors.text },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  dateHeader: {
    height: DATE_HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 20,
  },
  dateText: { fontSize: 26, fontWeight: '800', color: Colors.text },
  calBtn: { padding: 4 },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  centerBlock: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
  },

  mainButton: {
    backgroundColor: Colors.primary,
    borderRadius: 16,
    width: '100%',
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  mainButtonDisabled: { backgroundColor: Colors.border },
  mainButtonInner: { alignItems: 'center', gap: 12 },
  mainButtonText: { fontSize: 26, fontWeight: '800', color: Colors.white },

  outlineButton: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    width: '100%',
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  outlineButtonInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  outlineButtonText: { fontSize: 18, fontWeight: '700', color: Colors.primary },

  records: { paddingHorizontal: 24, paddingBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, paddingHorizontal: 4 },
  periodGroup: { marginBottom: 8 },
  periodTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSub, marginBottom: 10, marginLeft: 2, letterSpacing: 0.3 },
});
