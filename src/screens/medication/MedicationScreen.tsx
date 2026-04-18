import React, { useState, useCallback, useEffect } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { MealTimeModal } from './MealTimeModal';
import { BodyStatePopupFlow } from '../bodystate/BodyStatePopupFlow';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { useMedication } from '../../hooks/useMedication';
import { useBodyState } from '../../hooks/useBodyState';
import { useAuth } from '../../context/AuthContext';
import { DatePickerModal } from '../../components/common/DatePickerModal';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';

interface MedicationStatus {
  id: MealTime;
  label: string;
  time: string;
  taken: boolean;
  takenAt?: string;
}

const MEAL_TIME_LABELS: Record<MealTime, { label: string; time: string }> = {
  morning: { label: '아침', time: '오전 8:00' },
  lunch: { label: '점심', time: '오후 12:00' },
  dinner: { label: '저녁', time: '오후 6:00' },
  bedtime: { label: '취침', time: '오후 10:00' },
};

function formatTakenAt(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour}:${m.toString().padStart(2, '0')}`;
}

function getDateLabel(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function MedicationScreen() {
  const { user } = useAuth();
  const { todayStatus, takeMedication, getMedLogs, error: medError, refresh } = useMedication();
  const { saveBodyState, todayLogs: bodyLogs } = useBodyState();
  const insets = useSafeAreaInsets();

  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [showMealTimeModal, setShowMealTimeModal] = useState(false);
  const [showBodyStatePopup, setShowBodyStatePopup] = useState(false);
  const [selectedMealTime, setSelectedMealTime] = useState<MealTime | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // 날짜별 복용 현황 (날짜 선택 시 사용)
  const [dateLogStatus, setDateLogStatus] = useState<Record<string, any> | null>(null);
  const [dateLogsLoading, setDateLogsLoading] = useState(false);

  const isToday = toLocalDateString(selectedDate) === toLocalDateString(new Date());

  // 탭/화면 포커스 시 복용 현황 재조회 (오늘 날짜인 경우)
  useFocusEffect(
    useCallback(() => {
      if (isToday) {
        refresh();
        setDateLogStatus(null);
      }
    }, [refresh, isToday])
  );

  // 날짜 변경 시 해당 날짜 로그 조회
  useEffect(() => {
    if (isToday) {
      setDateLogStatus(null);
      return;
    }
    const dateStr = toLocalDateString(selectedDate);
    setDateLogsLoading(true);
    getMedLogs(dateStr).then((logs) => {
      const status: Record<string, any> = {
        morning: null,
        lunch: null,
        dinner: null,
        bedtime: null,
      };
      logs.forEach((log) => {
        const slot = log.meal_time as keyof typeof status;
        if (slot && !status[slot]) {
          status[slot] = log;
        }
      });
      setDateLogStatus(status);
      setDateLogsLoading(false);
    });
  }, [selectedDate, isToday, getMedLogs]);

  // 표시할 현황: 오늘이면 todayStatus, 과거 날짜면 dateLogStatus
  const activeStatus = isToday ? todayStatus : (dateLogStatus ?? { morning: null, lunch: null, dinner: null, bedtime: null });

  // 환자명: 실제 user.name 사용, 없으면 '환자'
  const patientName = user?.name ?? '환자';

  const userRole = (user?.role === 'caregiver' ? 'caregiver_same' : 'patient') as
    'patient' | 'caregiver_same' | 'caregiver_separate';

  const handleMealTimeSelect = async (mealTime: MealTime) => {
    setShowMealTimeModal(false);
    const success = await takeMedication(mealTime);
    if (!success) {
      Alert.alert('저장 실패', medError ?? '복용 기록 저장에 실패했어요. 다시 시도해 주세요.');
      return;
    }
    setSelectedMealTime(mealTime);
    setTimeout(() => {
      Alert.alert(
        '몸 상태도 기록해볼까요?',
        '약 복용 후 몸 상태와 기분 상태를 기록하면\n약효 패턴을 더 잘 파악할 수 있어요.',
        [
          { text: '나중에', style: 'cancel', onPress: () => setSelectedMealTime(null) },
          { text: '기록하기', onPress: () => setShowBodyStatePopup(true) },
        ]
      );
    }, 1500);
  };

  const handleBodyStateSave = async (record: { bodyScore: number; moodScore: number; sleepScore?: number; constipation?: boolean }) => {
    await saveBodyState({
      body_state: record.bodyScore,
      mood: record.moodScore,
      sleep_quality: record.sleepScore,
      constipation: record.constipation,
      trigger_time_label: 'after_medication',
    }, 'notification');
    setShowBodyStatePopup(false);
    setSelectedMealTime(null);
  };

  // activeStatus → MedicationStatus[] 변환
  const displayList: MedicationStatus[] = (Object.keys(MEAL_TIME_LABELS) as MealTime[]).map((mt) => {
    const log = (activeStatus as any)[mt];
    return log
      ? { id: mt, label: MEAL_TIME_LABELS[mt].label, time: MEAL_TIME_LABELS[mt].time, taken: true, takenAt: formatTakenAt(log.taken_at) }
      : { id: mt, label: MEAL_TIME_LABELS[mt].label, time: MEAL_TIME_LABELS[mt].time, taken: false };
  });

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
              (userRole === 'caregiver_separate' || !isToday) && styles.mainButtonDisabled,
            ]}
            onPress={() => {
              if (userRole === 'caregiver_separate' || !isToday) return;
              if (userRole === 'caregiver_same') {
                setShowCaregiverConfirm(true);
              } else {
                setShowMealTimeModal(true);
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.mainButtonInner}>
              <Ionicons name="medkit" size={40} color={Colors.white} />
              <Text style={styles.mainButtonText}>약 먹었어요</Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>같이 계신 경우에만 대신 입력할 수 있어요</Text>
          )}
          {!isToday && userRole !== 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>오늘 날짜에서만 복용 기록을 입력할 수 있어요</Text>
          )}
        </View>

        {/* 면책 배너 */}
        <View style={styles.disclaimerBanner}>
          <Ionicons name="information-circle-outline" size={16} color="#388E3C" style={styles.disclaimerIcon} />
          <Text style={styles.disclaimerText} numberOfLines={1}>
            복용 기록 도구예요. 약 변경은 담당 의사와 상의하세요.
          </Text>
        </View>

        {/* 오늘 복용 현황 */}
        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>{isToday ? '오늘 복용 현황' : '복용 현황'}</Text>
            <View style={styles.divider} />
          </View>
          {displayList.map(item => (
            /* 그림자용 outer wrapper */
            <View key={item.id} style={styles.cardShadow}>
              {/* overflow hidden inner wrapper */}
              <View style={[styles.cardInner, item.taken ? styles.cardInnerDone : styles.cardInnerPending]}>
                <View style={[styles.cardStripe, { backgroundColor: item.taken ? '#4CAF50' : '#E0E0E0' }]} />
                <View style={[styles.cardContent, item.taken && styles.cardContentDone]}>
                  <Ionicons
                    name={item.taken ? 'checkmark-circle' : 'time-outline'}
                    size={28}
                    color={item.taken ? Colors.primary : Colors.accent}
                    style={styles.cardIcon}
                  />
                  <View style={styles.cardBody}>
                    <Text style={styles.cardLabel}>{item.label} 약</Text>
                    <Text style={styles.cardTime}>
                      {item.taken ? `${item.takenAt} 복용 완료` : `${item.time} 예정`}
                    </Text>
                  </View>
                  <View style={[styles.cardBadge, !item.taken && styles.cardBadgeIncomplete]}>
                    <Text style={[styles.cardBadgeText, !item.taken && styles.cardBadgeTextIncomplete]}>
                      {item.taken ? '완료' : '미완료'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <MealTimeModal
        visible={showMealTimeModal}
        onSelect={handleMealTimeSelect}
        onClose={() => setShowMealTimeModal(false)}
      />
      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={patientName}
        onConfirm={() => { setShowCaregiverConfirm(false); setShowMealTimeModal(true); }}
        onCancel={() => setShowCaregiverConfirm(false)}
      />
      <BodyStatePopupFlow
        visible={showBodyStatePopup}
        onClose={() => { setShowBodyStatePopup(false); setSelectedMealTime(null); }}
        onSave={handleBodyStateSave}
        showSleep={bodyLogs.length === 0}
        showConstipation={selectedMealTime === 'bedtime'}
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  disclaimerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 24,
    marginBottom: 16,
    gap: 8,
  },
  disclaimerIcon: {
    flexShrink: 0,
  },
  disclaimerText: {
    fontSize: 14,
    color: '#2E7D32',
    lineHeight: 20,
    flex: 1,
  },

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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  mainButtonDisabled: { backgroundColor: Colors.border },
  mainButtonInner: { alignItems: 'center', gap: 12 },
  mainButtonText: { fontSize: 28, fontWeight: '800', color: Colors.white },

  caregiverNotice: {
    marginTop: 14,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
  },

  records: { paddingHorizontal: 24, paddingBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, paddingHorizontal: 4 },

  /* 그림자용 outer — overflow hidden 없음 */
  cardShadow: {
    borderRadius: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  /* 내용 + 띠 담는 inner — overflow hidden으로 띠가 둥근 모서리 안에 잘림 */
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    minHeight: 96,
    overflow: 'hidden',
  },
  cardInnerDone: { backgroundColor: '#F5F5F5' },
  cardInnerPending: { backgroundColor: Colors.white },
  cardContentDone: { opacity: 0.5 },
  /* 왼쪽 색상 띠 */
  cardStripe: { width: 5, alignSelf: 'stretch' },
  cardContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 20 },
  cardIcon: { marginRight: 14 },
  cardBody: { flex: 1 },
  cardLabel: { fontSize: 20, fontWeight: '600', color: Colors.text, marginBottom: 3 },
  cardTime: { fontSize: 17, color: Colors.textSub },
  cardBadge: { flexShrink: 0, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  cardBadgeIncomplete: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border },
  cardBadgeText: { fontSize: 16, fontWeight: '700', color: Colors.white },
  cardBadgeTextIncomplete: { color: Colors.textSub },
});
