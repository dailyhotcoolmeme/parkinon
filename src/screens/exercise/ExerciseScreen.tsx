import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { HistoryTimeline } from '../../components/common/HistoryTimeline';
import { useDialog } from '../../context/DialogContext';
import { ensureNotGuest } from '../../utils/guestGuard';
import { useRecordRealtime } from '../../hooks/useRecordRealtime';
import { useScrollTopOnTabPress } from '../../hooks/useScrollTopOnTabPress';
import { translateRawExerciseType } from '../../constants/exerciseTypes';

type Nav = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseMain'>;

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

// 아이콘 매핑 키 = 저장된 exercise_type(로케일별 라벨). 한/영 양쪽 라벨을 모두 등록해
// 영어로 저장된 기록도 올바른 아이콘이 뜨게 한다(한국어 회귀 없음).
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
  'Walking': 'walk-outline',
  'Stretching': 'body-outline',
  'Strength': 'barbell-outline',
  'Balance': 'man-outline',
  'Cycling': 'bicycle-outline',
  'Swimming': 'water-outline',
  'Dancing': 'musical-notes-outline',
  'Boxing': 'fitness-outline',
  'Yoga': 'leaf-outline',
  'Jogging': 'footsteps-outline',
};

function ExerciseTypeIcon({ type, size = 30, color = Colors.text }: { type: string; size?: number; color?: string }) {
  const iconName = EXERCISE_ICONS[type] ?? 'fitness-outline';
  return <Ionicons name={iconName} size={size} color={color} />;
}

// 현재 언어가 영어권인지. 한국어(ko)일 때는 아래 날짜 포맷을 기존과 100% 동일하게 유지한다.
function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

function getDateLabel(date: Date): string {
  if (isEnLocale()) {
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}

// 섹션 제목용 짧은 날짜. ko: "M월 D일"(기존과 동일), en: "January 1".
function getShortDateLabel(date: Date): string {
  if (isEnLocale()) {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }
  return getDateLabel(date).split(' ').slice(0, 2).join(' ');
}

export function ExerciseScreen() {
  const navigation = useNavigation<Nav>();
  // 탭 버튼 누를 때 항상 맨 위로
  const scrollRef = useRef<ScrollView>(null);
  useScrollTopOnTabPress(scrollRef);
  const dialog = useDialog();
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { todayLogs, getTodayTotalMinutes, getExerciseLogs, cancelExercise, loading, error, refresh } = useExercise();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateLogs, setDateLogs] = useState(todayLogs);
  const [dateLoading, setDateLoading] = useState(false);
  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [patientName, setPatientName] = useState(i18n.t('medication.caregiverDefaultName'));
  const [patientId, setPatientId] = useState<string | null>(null);
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0);
  const { unreadCount } = useNotificationBadge();

  // 운동 기록 실시간 동기화 (환자↔보호자 즉시 반영)
  useRecordRealtime('exercise_logs', patientId, () => {
    refresh();                         // 오늘 운동 기록 새로고침
    setRecordsRefreshKey((k) => k + 1); // 과거기록(HistoryTimeline) 갱신
  });

  // patient_group_id가 있어도 실제 환자 멤버가 없을 수 있으므로 patientId 기준으로 판단
  const userRole: 'patient' | 'caregiver_no_patient' | 'caregiver_same' | 'caregiver_separate' =
    user?.role !== 'caregiver'
      ? 'patient'
      : !patientId
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

  // 진행 중인(in-flight) 동일 날짜 로드 키 — 포커스+마운트 동시 발화 등 중복 동시호출만 차단.
  const loadLogsInFlightKey = useRef<string | null>(null);

  // 날짜 선택 시 해당 날짜 기록 조회
  const loadLogsForDate = useCallback(async (date: Date) => {
    const kstOffset = 9 * 60 * 60 * 1000;
    const dateStr = new Date(date.getTime() + kstOffset).toISOString().slice(0, 10);
    // 중복 동시호출 가드: 같은 날짜 로드가 이미 진행 중이면 스킵.
    // (포커스 시 갱신 동작 자체는 유지 — 진행 중인 '동일' 호출만 막는다. 다른 날짜는 통과.)
    if (loadLogsInFlightKey.current === dateStr) return;
    loadLogsInFlightKey.current = dateStr;
    try {
      if (isToday(date)) {
        await refresh();
        return;
      }
      setDateLoading(true);
      const { logs, error: fetchError } = await getExerciseLogs(dateStr);
      if (fetchError) {
        dialog.alert({ title: t('exercise.loadFailTitle'), message: fetchError });
      }
      setDateLogs(logs);
      setDateLoading(false);
    } finally {
      if (loadLogsInFlightKey.current === dateStr) loadLogsInFlightKey.current = null;
    }
  }, [refresh, getExerciseLogs, t]);

  // 화면 복귀 시마다 운동 기록 재조회 (저장 후 리스트 갱신)
  useFocusEffect(
    React.useCallback(() => {
      loadLogsForDate(selectedDate);
    }, [loadLogsForDate, selectedDate])
  );

  // 운동 알림 탭 → pendingExerciseNotif 확인 후 자동으로 ExerciseRecord 이동
  // - 환자 본인만 자동 진입 (보호자 same-house는 CaregiverConfirmModal로 별도 처리되어야 함)
  // - 첫 포커스 시 user가 아직 미로드(null)면 분기 false → user 로드 후 deps 변경으로 재실행되어 동작
  // - removeItem은 push 직후 → push 실패 시 다음 포커스에 재시도 가능
  // - navigate → push: 이미 ExerciseRecord 스택에 있을 때 noop 되는 케이스 회피
  useFocusEffect(
    React.useCallback(() => {
      if (user?.role !== 'patient') return;
      AsyncStorage.getItem('pendingExerciseNotif').then(async (val) => {
        if (val === 'true') {
          // removeItem await 보장: stale 재트리거 방지
          await AsyncStorage.removeItem('pendingExerciseNotif');
          try {
            navigation.push('ExerciseRecord');
          } catch (e) {
            console.error('[ExerciseScreen] ExerciseRecord push 실패:', e);
          }
        }
      });
    }, [navigation, user])
  );

  // error 발생 시 Alert
  React.useEffect(() => {
    if (error) {
      dialog.alert({ title: t('exercise.loadFailTitle'), message: error });
    }
  }, [error]);

  // 표시할 기록: 오늘이면 훅의 todayLogs, 다른 날이면 dateLogs
  const displayLogs = isToday(selectedDate) ? todayLogs : dateLogs;
  const totalMinutes = displayLogs.reduce((sum, log) => sum + log.duration_minutes, 0);
  const isLoading = loading || dateLoading;

  // 기록 취소 버튼 노출 조건: 환자 본인 또는 함께 거주하는 보호자 + 오늘 날짜
  const canCancel = (userRole === 'patient' || userRole === 'caregiver_same') && isToday(selectedDate);

  // 운동 기록 취소(삭제)
  const handleCancelExercise = useCallback(async (exerciseLogId: string) => {
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const ok = await dialog.confirm({
      title: t('exercise.cancelRecordTitle'),
      message: t('exercise.cancelRecordMsg'),
      confirmText: t('exercise.cancelRecordConfirm'),
      cancelText: t('common.close'),
      destructive: true,
    });
    if (!ok) return;
    const success = await cancelExercise(exerciseLogId);
    if (!success) {
      dialog.alert({ title: t('exercise.cancelFailTitle'), message: t('exercise.cancelFailMsg') });
    }
  }, [user, dialog, signOut, cancelExercise, t]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={t('medication.brandTitle')}
        showParkinon
        showDiary
        onDiaryPress={() => navigateTo('Diary')}
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

      <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={[styles.primaryBtn, (userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday(selectedDate)) && styles.primaryBtnDisabled]}
            disabled={userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday(selectedDate)}
            onPress={async () => {
              if (await ensureNotGuest(user, dialog, { signOut })) return;
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
              <Text style={styles.primaryBtnText}>{t('exercise.primaryButton')}</Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>{t('exercise.noticeCaregiverNoPatient')}</Text>
          )}
          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>{t('exercise.noticeCaregiverSeparate')}</Text>
          )}
          {!isToday(selectedDate) && userRole !== 'caregiver_separate' && userRole !== 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>{t('exercise.noticeNotToday')}</Text>
          )}

          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => navigation.navigate('ExerciseVideo')}
            activeOpacity={0.85}
          >
            <View style={styles.outlineBtnInner}>
              <Ionicons name="videocam-outline" size={24} color={Colors.primary} />
              <Text style={styles.outlineBtnText}>{t('exercise.videoButton')}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 운동 기록 */}
        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.dividerLine} />
            <Text style={styles.sectionTitle}>
              {isToday(selectedDate)
                ? t('exercise.sectionTitleToday', { min: totalMinutes })
                : t('exercise.sectionTitleDate', { date: getShortDateLabel(selectedDate), min: totalMinutes })}
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
              <Text style={styles.emptyText}>{t('exercise.empty')}</Text>
              <Text style={styles.emptySubText}>{t('exercise.emptySub')}</Text>
            </View>
          ) : (
            displayLogs.map((record) => (
              <View key={record.id} style={styles.recordCard}>
                <View style={styles.recordIconWrap}>
                  <ExerciseTypeIcon type={record.exercise_type} size={30} color={Colors.primary} />
                </View>
                <View style={styles.recordInfo}>
                  <Text style={styles.recordLabel}>
                    {t('exercise.recordLabel', { type: translateRawExerciseType(record.exercise_type), min: record.duration_minutes })}
                  </Text>
                  <Text style={styles.recordTime}>
                    {new Date(record.logged_at).toLocaleTimeString(isEnLocale() ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                {canCancel && (
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => handleCancelExercise(record.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cancelBtnText}>{t('exercise.cancel')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>

        {/* 과거 기록 보기 타임라인 */}
        <HistoryTimeline type="exercise" patientId={patientId} refreshKey={recordsRefreshKey} />
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
  cancelBtn: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.danger,
    backgroundColor: Colors.white,
    marginLeft: 12,
  },
  cancelBtnText: { fontSize: 16, fontWeight: '700', color: Colors.danger },
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
    marginTop: 0,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
  },
});
