import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useExercise } from '../../hooks/useExercise';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { navigateTo } from '../../navigation/navigationRef';
import { useAuth } from '../../context/AuthContext';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { HistoryTimeline } from '../../components/common/HistoryTimeline';

type Nav = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseMain'>;

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

const EXERCISE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  '걷기': 'walk-outline',
  '스트레칭': 'body-outline',
  '근력': 'barbell-outline',
  '균형': 'man-outline',
  '자전거': 'bicycle-outline',
  '수영': 'water-outline',
  '댄스': 'musical-notes-outline',
  '복싱': 'fitness-outline',
  '요가': 'leaf-outline',
  '조깅': 'footsteps-outline',
};

function ExerciseTypeIcon({ type, size = 30, color = Colors.text }: { type: string; size?: number; color?: string }) {
  const iconName = EXERCISE_ICONS[type] ?? 'fitness-outline';
  return <Ionicons name={iconName} size={size} color={color} />;
}

function getDateLabel(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}

export function ExerciseScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { todayLogs, getTodayTotalMinutes, getExerciseLogs, loading, error, refresh } = useExercise();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateLogs, setDateLogs] = useState(todayLogs);
  const [dateLoading, setDateLoading] = useState(false);
  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [patientName, setPatientName] = useState('환자');
  const [patientId, setPatientId] = useState<string | null>(null);
  const { unreadCount } = useNotificationBadge();

  const userRole: 'patient' | 'caregiver_no_patient' | 'caregiver_same' | 'caregiver_separate' =
    user?.role !== 'caregiver'
      ? 'patient'
      : !user.patient_group_id
      ? 'caregiver_no_patient'
      : user.residence_type === 'separate'
      ? 'caregiver_separate'
      : 'caregiver_same';

  useEffect(() => {
    if (!user) return;
    if (user.role === 'patient') {
      setPatientName(user.name);
      setPatientId(user.id);
      return;
    }
    if (!user.patient_group_id) return;
    supabase
      .from('patient_group_members')
      .select('user_id, users(name)')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single()
      .then(({ data }) => {
        const name = (data?.users as any)?.name;
        if (name) setPatientName(name);
        if ((data as any)?.user_id) setPatientId((data as any).user_id);
      });
  }, [user]);

  // KST(UTC+9) 기준 날짜 비교 — UTC 사용 시 오후 11시 이후 날짜 오류 방지
  const isToday = (date: Date) => {
    const kstOffset = 9 * 60 * 60 * 1000;
    const nowKst = new Date(Date.now() + kstOffset);
    const todayStr = nowKst.toISOString().slice(0, 10);
    const dateKst = new Date(date.getTime() + kstOffset);
    return dateKst.toISOString().slice(0, 10) === todayStr;
  };

  // 날짜 선택 시 해당 날짜 기록 조회
  const loadLogsForDate = useCallback(async (date: Date) => {
    if (isToday(date)) {
      await refresh();
      return;
    }
    setDateLoading(true);
    const kstOffset = 9 * 60 * 60 * 1000;
    const dateStr = new Date(date.getTime() + kstOffset).toISOString().slice(0, 10);
    const { logs, error: fetchError } = await getExerciseLogs(dateStr);
    if (fetchError) {
      Alert.alert('불러오기 실패', fetchError);
    }
    setDateLogs(logs);
    setDateLoading(false);
  }, [refresh, getExerciseLogs]);

  // 화면 복귀 시마다 운동 기록 재조회 (저장 후 리스트 갱신)
  useFocusEffect(
    React.useCallback(() => {
      loadLogsForDate(selectedDate);
    }, [loadLogsForDate, selectedDate])
  );

  // error 발생 시 Alert
  React.useEffect(() => {
    if (error) {
      Alert.alert('불러오기 실패', error);
    }
  }, [error]);

  // 표시할 기록: 오늘이면 훅의 todayLogs, 다른 날이면 dateLogs
  const displayLogs = isToday(selectedDate) ? todayLogs : dateLogs;
  const totalMinutes = displayLogs.reduce((sum, log) => sum + log.duration_minutes, 0);
  const isLoading = loading || dateLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title="파킨온"
        showParkinon
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigateTo('NotificationHistory', { mode: 'all' })}
      />

      {/* 날짜 헤더 */}
      <View style={styles.dateHeader}>
        <Text style={styles.dateText}>{getDateLabel(selectedDate)}</Text>
        <TouchableOpacity style={styles.calBtn} onPress={() => setShowDatePicker(true)}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={[styles.primaryBtn, (userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate') && styles.primaryBtnDisabled]}
            onPress={() => {
              if (userRole === 'caregiver_no_patient') {
                Alert.alert('환자 연동 필요', '환자와 먼저 연동해야\n대신 기록할 수 있어요.');
                return;
              }
              if (userRole === 'caregiver_separate') {
                Alert.alert('대신 입력 불가', '함께 거주하지 않아\n대신 기록이 불가능해요.');
                return;
              }
              if (userRole === 'caregiver_same') {
                setShowCaregiverConfirm(true);
              } else {
                navigation.navigate('ExerciseRecord');
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.primaryBtnInner}>
              <Ionicons name="fitness" size={40} color={Colors.white} />
              <Text style={styles.primaryBtnText}>운동 기록하기</Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>환자와 연동 후 기록할 수 있어요</Text>
          )}
          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>같이 계신 경우에만 대신 입력할 수 있어요</Text>
          )}

          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => navigation.navigate('ExerciseVideo')}
            activeOpacity={0.85}
          >
            <View style={styles.outlineBtnInner}>
              <Ionicons name="videocam-outline" size={24} color={Colors.primary} />
              <Text style={styles.outlineBtnText}>운동 영상 보기</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 운동 기록 */}
        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.dividerLine} />
            <Text style={styles.sectionTitle}>
              {isToday(selectedDate) ? '오늘' : getDateLabel(selectedDate).split(' ').slice(0, 2).join(' ')} 운동 기록 · 총 {totalMinutes}분
            </Text>
            <View style={styles.dividerLine} />
          </View>

          {isLoading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : displayLogs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="fitness-outline" size={48} color={Colors.textSub} />
              <Text style={styles.emptyText}>운동 기록이 없어요</Text>
              <Text style={styles.emptySubText}>위 버튼을 눌러 운동을 기록해 보세요!</Text>
            </View>
          ) : (
            displayLogs.map((record) => (
              <View key={record.id} style={styles.recordCard}>
                <View style={styles.recordIconWrap}>
                  <ExerciseTypeIcon type={record.exercise_type} size={30} color={Colors.primary} />
                </View>
                <View style={styles.recordInfo}>
                  <Text style={styles.recordLabel}>
                    {record.exercise_type}  {record.duration_minutes}분
                  </Text>
                  <Text style={styles.recordTime}>
                    {new Date(record.logged_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* 과거 기록 보기 타임라인 */}
        <HistoryTimeline type="exercise" patientId={patientId} />
      </ScrollView>
      <DatePickerModal
        visible={showDatePicker}
        selectedDate={selectedDate}
        onSelect={(date) => {
          setSelectedDate(date);
          loadLogsForDate(date);
        }}
        onClose={() => setShowDatePicker(false)}
      />
      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={patientName}
        onConfirm={() => { setShowCaregiverConfirm(false); navigation.navigate('ExerciseRecord'); }}
        onCancel={() => setShowCaregiverConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  dateHeader: {
    height: DATE_HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
  },
  dateText: { fontSize: 26, fontWeight: '800', color: Colors.text },
  calBtn: { padding: 4 },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  centerBlock: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 14,
  },

  primaryBtn: {
    backgroundColor: Colors.primary,
    width: '100%',
    height: 220,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  primaryBtnDisabled: { backgroundColor: '#BDBDBD' },
  primaryBtnInner: { alignItems: 'center', gap: 12 },
  primaryBtnText: { fontSize: 26, fontWeight: '800', color: Colors.white },

  outlineBtn: {
    backgroundColor: Colors.white,
    width: '100%',
    height: 70,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  outlineBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  outlineBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },

  records: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, marginHorizontal: 12 },

  recordCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  recordIconWrap: { marginRight: 16, width: 46, alignItems: 'center' },
  recordInfo: { flex: 1 },
  recordLabel: { fontSize: 20, fontWeight: '600', color: Colors.text },
  recordTime: { fontSize: 17, color: Colors.textSub, marginTop: 4 },

  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  emptySubText: { fontSize: 17, color: Colors.textHint, textAlign: 'center', lineHeight: 26 },
  caregiverNotice: {
    marginTop: 14,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
  },
});
