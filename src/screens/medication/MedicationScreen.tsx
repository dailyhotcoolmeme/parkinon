import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { MealTimeModal } from './MealTimeModal';
import { BodyStatePopupFlow } from '../bodystate/BodyStatePopupFlow';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { NotificationOnboardingModal, NOTIF_ONBOARDING_SHOWN_KEY } from '../../components/common/NotificationOnboardingModal';
import { useMedication } from '../../hooks/useMedication';
import { useBodyState } from '../../hooks/useBodyState';
import { useAuth } from '../../context/AuthContext';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { navigateTo } from '../../navigation/navigationRef';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

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

const DEFAULT_MEAL_TIME_LABELS: Record<MealTime, { label: string; time: string }> = {
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

// "HH:mm" 문자열을 "오전/오후 H:mm" 형식으로 변환
function formatMealTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
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

// KST(UTC+9) 기준 날짜 문자열 반환 — UTC 사용 시 오후 11시 이후 날짜 오류 방지
function toLocalDateString(date: Date): string {
  const kstOffset = 9 * 60 * 60 * 1000;
  const kst = new Date(date.getTime() + kstOffset);
  return kst.toISOString().slice(0, 10);
}

type MedicationRouteParams = {
  autoOpen?: boolean;
  mealTime?: string | null;
};

export function MedicationScreen() {
  const route = useRoute<RouteProp<{ Medication: MedicationRouteParams }, 'Medication'>>();
  const routeParams = (route.params ?? {}) as MedicationRouteParams;
  const { user } = useAuth();
  const { todayStatus, takeMedication, getMedLogs, error: medError, refresh } = useMedication();
  const { saveBodyState, todayLogs: bodyLogs } = useBodyState();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationBadge();

  // users.meal_schedules 기반 시간 표시 (약 없을 때 사용)
  const [userMealSchedules, setUserMealSchedules] = useState<Record<string, string> | null>(null);

  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [showMealTimeModal, setShowMealTimeModal] = useState(false);
  const [showBodyStatePopup, setShowBodyStatePopup] = useState(false);
  const [showBodyStateSuggest, setShowBodyStateSuggest] = useState(false);
  const [selectedMealTime, setSelectedMealTime] = useState<MealTime | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showNotifOnboarding, setShowNotifOnboarding] = useState(false);

  // 온보딩 완료 후 홈 최초 진입 시 알림 설정 팝업 1회 표시
  useEffect(() => {
    if (!user?.onboarding_done) return;
    AsyncStorage.getItem(NOTIF_ONBOARDING_SHOWN_KEY).then((val) => {
      if (!val) {
        // 약간의 딜레이 후 표시 (화면 전환 애니메이션 완료 후)
        setTimeout(() => setShowNotifOnboarding(true), 600);
      }
    }).catch(() => {});
  }, [user?.onboarding_done]);

  // 알림 탭 진입 시 MealTimeModal 자동 오픈
  // App.tsx에서 navigation params { autoOpen: true, mealTime: '아침' } 전달
  useEffect(() => {
    if (!routeParams.autoOpen) return;
    // 화면 전환 애니메이션 완료 후 모달 오픈
    const timer = setTimeout(() => {
      setShowMealTimeModal(true);
    }, 400);
    return () => clearTimeout(timer);
  // routeParams 객체 참조가 바뀌어도 autoOpen 값 기준으로만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams.autoOpen]);

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

  const [patientName, setPatientName] = useState('환자');

  useEffect(() => {
    if (!user) return;
    if (user.role === 'patient') {
      setPatientName(user.name);
      // 환자 본인의 meal_schedules 로드
      supabase
        .from('users')
        .select('meal_schedules')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.meal_schedules) {
            setUserMealSchedules(data.meal_schedules as Record<string, string>);
          }
        });
      return;
    }
    if (!user.patient_group_id) return;
    // 보호자인 경우 환자 정보 로드
    supabase
      .from('patient_group_members')
      .select('users(name, meal_schedules)')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single()
      .then(({ data }) => {
        const userInfo = data?.users as any;
        if (userInfo?.name) setPatientName(userInfo.name);
        if (userInfo?.meal_schedules) {
          setUserMealSchedules(userInfo.meal_schedules as Record<string, string>);
        }
      });
  }, [user]);

  // 환자는 항상 활성화. 보호자만 residence_type 체크.
  // residence_type === null(정보 없음)이면 함께거주로 기본값 처리.
  const userRole: 'patient' | 'caregiver_same' | 'caregiver_separate' =
    user?.role !== 'caregiver'
      ? 'patient'
      : user.residence_type === 'separate'
      ? 'caregiver_separate'
      : 'caregiver_same'; // 'together' 또는 null → 함께거주 취급

  const handleMealTimeSelect = async (mealTime: MealTime) => {
    setShowMealTimeModal(false);
    const success = await takeMedication(mealTime);
    if (!success) {
      Alert.alert('저장 실패', medError ?? '복용 기록 저장에 실패했어요. 다시 시도해 주세요.');
      return;
    }
    setSelectedMealTime(mealTime);
    setTimeout(() => {
      setShowBodyStateSuggest(true);
    }, 400);
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
  // users.meal_schedules가 있으면 사용, 없으면 기본값 사용
  const displayList: MedicationStatus[] = (Object.keys(DEFAULT_MEAL_TIME_LABELS) as MealTime[]).map((mt) => {
    const log = (activeStatus as any)[mt];
    const defaultInfo = DEFAULT_MEAL_TIME_LABELS[mt];
    const timeStr = userMealSchedules?.[mt]
      ? formatMealTime(userMealSchedules[mt])
      : defaultInfo.time;

    return log
      ? { id: mt, label: defaultInfo.label, time: timeStr, taken: true, takenAt: formatTakenAt(log.taken_at) }
      : { id: mt, label: defaultInfo.label, time: timeStr, taken: false };
  });

  // 오늘 모든 시간대 복용 완료 여부 (아침/점심/저녁 기준 — 취침은 모달에 없으므로 제외)
  const NON_BEDTIME_SLOTS: MealTime[] = ['morning', 'lunch', 'dinner'];
  const allNonBedtimeTaken = isToday && NON_BEDTIME_SLOTS.every(
    (mt) => !!(activeStatus as any)[mt]
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
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
              (userRole === 'caregiver_separate' || !isToday || allNonBedtimeTaken) && styles.mainButtonDisabled,
            ]}
            onPress={() => {
              if (!isToday) return;
              if (allNonBedtimeTaken) return;
              if (userRole === 'caregiver_separate') {
                Alert.alert('대신 입력 불가', '함께 거주하지 않아\n대신 기록이 불가능해요.');
                return;
              }
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
              <Text style={styles.mainButtonText}>
                {allNonBedtimeTaken ? '오늘 복용 완료 ✓' : '약 먹었어요'}
              </Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>같이 계신 경우에만 대신 입력할 수 있어요</Text>
          )}
          {!isToday && userRole !== 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>오늘 날짜에서만 복용 기록을 입력할 수 있어요</Text>
          )}
          {allNonBedtimeTaken && (
            <Text style={styles.caregiverNotice}>아침·점심·저녁 약을 모두 복용했어요</Text>
          )}
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
      <Modal
        visible={showBodyStateSuggest}
        transparent
        animationType="fade"
        onRequestClose={() => { setShowBodyStateSuggest(false); setSelectedMealTime(null); }}
      >
        <View style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.45)',
          paddingHorizontal: 28,
        }}>
          <View style={{
            backgroundColor: '#fff',
            borderRadius: 20,
            padding: 28,
            width: '100%',
            alignItems: 'center',
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 12,
          }}>
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: '#FFF3E0',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Text style={{ fontSize: 32 }}>😊</Text>
            </View>
            <Text style={{
              fontSize: 20, fontWeight: '700', color: '#222',
              textAlign: 'center', marginBottom: 10,
            }}>
              몸 상태도 기록해볼까요?
            </Text>
            <Text style={{
              fontSize: 15, color: '#666', textAlign: 'center',
              lineHeight: 22, marginBottom: 24,
            }}>
              약 복용 후 몸 상태를 기록하면{'\n'}약효 패턴을 더 잘 파악할 수 있어요.
            </Text>
            <TouchableOpacity
              onPress={() => {
                setShowBodyStateSuggest(false);
                setShowBodyStatePopup(true);
              }}
              style={{
                backgroundColor: '#FF6B35',
                borderRadius: 12,
                paddingVertical: 15,
                width: '100%',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>기록하기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowBodyStateSuggest(false); setSelectedMealTime(null); }}
              style={{ paddingVertical: 10, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#999', fontSize: 16 }}>나중에</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
      {/* 온보딩 완료 후 최초 진입 시 알림 설정 팝업 */}
      <NotificationOnboardingModal
        visible={showNotifOnboarding}
        isCaregiver={user?.role === 'caregiver'}
        userId={user?.id ?? ''}
        onClose={() => setShowNotifOnboarding(false)}
      />
    </SafeAreaView>
  );
}

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
    paddingHorizontal: 16,
  },
  dateText: { fontSize: 26, fontWeight: '800', color: Colors.text },
  calBtn: { padding: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  calBtnText: { fontSize: 16, color: Colors.textSub },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  centerBlock: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
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
  mainButtonDisabled: { backgroundColor: '#BDBDBD' },
  mainButtonInner: { alignItems: 'center', gap: 12 },
  mainButtonText: { fontSize: 28, fontWeight: '800', color: Colors.white },

  caregiverNotice: {
    marginTop: 14,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
  },

  records: { paddingHorizontal: 16, paddingBottom: 40 },
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
