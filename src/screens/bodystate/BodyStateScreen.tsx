import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BodyStatePopupFlow } from './BodyStatePopupFlow';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { useAuth } from '../../context/AuthContext';
import { useBodyState } from '../../hooks/useBodyState';
import { navigateTo } from '../../navigation/navigationRef';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

interface BodyRecord {
  id: string;
  time: string;
  period: string;
  trigger: string;
  triggeredBy: string;
  bodyScore: number;
  moodScore: number;
  sleepScore?: number;
  constipation?: boolean;
}

function getDateLabel(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour}:${m.toString().padStart(2, '0')}`;
}

function getPeriod(isoString: string): string {
  const h = new Date(isoString).getHours();
  if (h < 11) return '아침';
  if (h < 15) return '점심';
  if (h < 20) return '저녁';
  return '취침';
}

const TRIGGER_LABEL: Record<string, string> = {
  after_medication: '복용 직후',
  '30min_after': '30분 후',
  '2hour_after': '2시간 후',
};

const PERIOD_EMOJI: Record<string, string> = {
  '아침': '', '점심': '', '저녁': '', '취침': ''
};

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function BodyStateScreen() {
  const { user } = useAuth();
  const { todayLogs, saveBodyState, fetchVideoLogs, getBodyStateLogs, refresh } = useBodyState();
  const [showFlow, setShowFlow] = useState(false);
  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [videoLogs, setVideoLogs] = useState<any[]>([]);
  const [dateLogs, setDateLogs] = useState<any[]>([]);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const isToday = toLocalDateString(selectedDate) === toLocalDateString(new Date());

  const loadVideoLogs = useCallback(async () => {
    const dateStr = toLocalDateString(selectedDate);
    const logs = await fetchVideoLogs(dateStr);
    setVideoLogs(logs);
  }, [selectedDate, fetchVideoLogs]);

  const loadDateLogs = useCallback(async () => {
    if (isToday) {
      setDateLogs([]);
      return;
    }
    const dateStr = toLocalDateString(selectedDate);
    const logs = await getBodyStateLogs(dateStr);
    setDateLogs(logs);
  }, [selectedDate, isToday, getBodyStateLogs]);

  // 날짜 바뀔 때마다 영상 목록 + 날짜별 기록 갱신
  useEffect(() => {
    loadVideoLogs();
    loadDateLogs();
  }, [loadVideoLogs, loadDateLogs]);

  // 화면 포커스 시 오늘 기록 갱신
  useFocusEffect(
    useCallback(() => {
      loadVideoLogs();
      if (isToday) {
        refresh();
      } else {
        loadDateLogs();
      }
    }, [loadVideoLogs, loadDateLogs, isToday, refresh])
  );

  const userRole = user?.role === 'caregiver'
    ? (user.residence_type === 'separate' ? 'caregiver_separate' : 'caregiver_same')
    : 'patient';

  const patientName = '환자';

  // 표시할 로그: 오늘이면 todayLogs, 다른 날이면 dateLogs
  const activeLogs = isToday ? todayLogs : dateLogs;

  // DB 로그 → BodyRecord 변환
  const records: BodyRecord[] = activeLogs.map((log) => ({
    id: log.id,
    time: formatTime(log.logged_at),
    period: getPeriod(log.logged_at),
    trigger: (log.trigger_time_label && TRIGGER_LABEL[log.trigger_time_label])
      || (log.triggered_by === 'notification' ? '알림' : '직접 입력'),
    triggeredBy: log.triggered_by ?? 'manual',
    bodyScore: log.body_state ?? 3,
    moodScore: log.mood ?? 3,
    sleepScore: log.sleep_quality ?? undefined,
    constipation: log.constipation ?? undefined,
  }));

  const handleSaveRecord = async (record: { bodyScore: number; moodScore: number; sleepScore?: number; constipation?: boolean }) => {
    const success = await saveBodyState({
      body_state: record.bodyScore,
      mood: record.moodScore,
      sleep_quality: record.sleepScore,
      constipation: record.constipation,
    }, 'manual');
    if (success) {
      setShowFlow(false);
    } else {
      Alert.alert('저장 실패', '몸상태 기록 저장에 실패했어요. 다시 시도해주세요.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title="파킨온"
        showParkinon
      />

      {/* 날짜 헤더 */}
      <View style={styles.dateHeader}>
        <Text style={styles.dateText}>{getDateLabel(selectedDate)}</Text>
        <TouchableOpacity style={styles.calBtn} onPress={() => setShowDatePicker(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
          
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={[
              styles.mainButton,
              userRole === 'caregiver_separate' && styles.mainButtonDisabled,
            ]}
            onPress={() => {
              if (userRole === 'caregiver_separate') return;
              if (userRole === 'caregiver_same') {
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

          {videoLogs.length > 0 && (
            <TouchableOpacity
              style={styles.videoHistoryButton}
              onPress={() => navigation.navigate('VideoList')}
              activeOpacity={0.80}
            >
              <Ionicons name="albums-outline" size={20} color={Colors.textSub} />
              <Text style={styles.videoHistoryText}>저장된 영상 보기</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textHint} />
            </TouchableOpacity>
          )}

        </View>

        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>{isToday ? '오늘 몸상태 기록' : '몸상태 기록'}</Text>
            <View style={styles.divider} />
          </View>
          {records.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="happy-outline" size={48} color={Colors.textSub} />
              <Text style={styles.emptyText}>기록이 없어요</Text>
              <Text style={styles.emptySubText}>위 버튼을 눌러 기록해 보세요!</Text>
            </View>
          ) : (
            ['아침', '점심', '저녁', '취침'].map(period => {
              const periodRecords = records.filter(r => r.period === period);
              if (periodRecords.length === 0) return null;
              // 해당 시간대 기록이 모두 notification인 경우만 "약 복용 후" 표시
              const allNotification = periodRecords.every(r => r.triggeredBy === 'notification');
              const hasNotification = periodRecords.some(r => r.triggeredBy === 'notification');
              const periodTitle = allNotification
                ? `${period} 약 복용 후`
                : hasNotification
                  ? `${period}`
                  : `${period} 독립 기록`;
              return (
                <View key={period} style={styles.periodGroup}>
                  <Text style={styles.periodTitle}>{periodTitle}</Text>
                  {periodRecords.map(record => (
                    <BodyRecordCard key={record.id} record={record} />
                  ))}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={patientName}
        onConfirm={() => { setShowCaregiverConfirm(false); setShowFlow(true); }}
        onCancel={() => setShowCaregiverConfirm(false)}
      />
      <BodyStatePopupFlow
        visible={showFlow}
        onClose={() => setShowFlow(false)}
        onSave={handleSaveRecord}
        onGoExercise={() => navigateTo('Exercise')}
        showSleep={todayLogs.length === 0}
        showConstipation={false}
      />
      <DatePickerModal
        visible={showDatePicker}
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        onClose={() => setShowDatePicker(false)}
      />
    </SafeAreaView>
  );
}

function getScoreEmoji(score: number): string {
  if (score >= 5) return '😄';
  if (score >= 4) return '🙂';
  if (score >= 3) return '😐';
  if (score >= 2) return '😔';
  return '😢';
}

function getScoreColor(score: number): string {
  if (score >= 4) return Colors.primary;
  if (score >= 3) return Colors.accent;
  return '#F44336';
}

function BodyRecordCard({ record }: { record: BodyRecord }) {
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.header}>
        <Text style={cardStyles.time}>{record.time}</Text>
        <View style={cardStyles.triggerBadge}>
          <Text style={cardStyles.triggerText}>{record.trigger}</Text>
        </View>
      </View>

      <View style={cardStyles.scoreRow}>
        <View style={cardStyles.scoreBox}>
          <Text style={cardStyles.scoreLabel}>몸상태</Text>
          <View style={cardStyles.scoreValueRow}>
            <Text style={[cardStyles.scoreNum, { color: getScoreColor(record.bodyScore) }]}>
              {record.bodyScore}점
            </Text>
          </View>
        </View>
        <View style={cardStyles.scoreDivider} />
        <View style={cardStyles.scoreBox}>
          <Text style={cardStyles.scoreLabel}>기분</Text>
          <View style={cardStyles.scoreValueRow}>
            <Text style={[cardStyles.scoreNum, { color: getScoreColor(record.moodScore) }]}>
              {record.moodScore}점
            </Text>
          </View>
        </View>
      </View>

      {record.sleepScore !== undefined && (
        <View style={cardStyles.extraRow}>
          <Text style={cardStyles.extraLabel}>수면</Text>
          <Text style={[cardStyles.extraValue, { color: getScoreColor(record.sleepScore) }]}>
            {record.sleepScore}점
          </Text>
        </View>
      )}

      {record.constipation !== undefined && (
        <View style={cardStyles.extraRow}>
          <Text style={cardStyles.extraLabel}>변비</Text>
          <Text style={cardStyles.extraValue}>
            {record.constipation ? '있었어요' : '없었어요'}
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
  calBtn: { padding: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  calBtnText: { fontSize: 16, color: Colors.textSub },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  centerBlock: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
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

  videoHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 56,
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  videoHistoryText: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: Colors.textSub,
  },

  records: { paddingHorizontal: 24, paddingBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, paddingHorizontal: 4 },
  periodGroup: { marginBottom: 8 },
  periodTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSub, marginBottom: 10, marginLeft: 2, letterSpacing: 0.3 },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  emptySubText: { fontSize: 17, color: Colors.textHint, textAlign: 'center', lineHeight: 26 },
});
