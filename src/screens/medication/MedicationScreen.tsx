import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { HistoryTimeline } from '../../components/common/HistoryTimeline';
import { mealTimeToKorean } from '../../utils/medUtils';
import { notificationIntentManager } from '../../utils/NotificationIntentManager';

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

// 시간 비교용 HH:MM 기본값
const DEFAULT_MEAL_TIMES: Record<MealTime, string> = {
  morning: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  bedtime: '22:00',
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
  autoOpen?: number | boolean;
  mealTime?: string | null;
};

export function MedicationScreen() {
  const route = useRoute<RouteProp<{ Medication: MedicationRouteParams }, 'Medication'>>();
  const routeParams = (route.params ?? {}) as MedicationRouteParams;
  const { user } = useAuth();
  const { todayStatus, takeMedication, getMedLogs, error: medError, refresh } = useMedication();
  const { saveBodyState, todayLogs: bodyLogs } = useBodyState();
  const insets = useSafeAreaInsets();
  const { unreadCount, refreshBadge } = useNotificationBadge();

  // users.meal_schedules 기반 시간 표시 (약 없을 때 사용)
  const [userMealSchedules, setUserMealSchedules] = useState<Record<string, string> | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean> | null>(null);

  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [showMealTimeModal, setShowMealTimeModal] = useState(false);
  const [showBodyStatePopup, setShowBodyStatePopup] = useState(false);
  const [showBodyStateSuggest, setShowBodyStateSuggest] = useState(false);
  const [selectedMealTime, setSelectedMealTime] = useState<MealTime | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showNotifOnboarding, setShowNotifOnboarding] = useState(false);
  const [showPreMedInfo, setShowPreMedInfo] = useState(false);
  const [preMedMessage, setPreMedMessage] = useState('');
  const [showNextNotifModal, setShowNextNotifModal] = useState(false);
  const [nextNotifInfo, setNextNotifInfo] = useState<NextNotifInfo | null>(null);

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

    // 알림으로 진입 시 미읽음 약 복용 알림 읽음 처리 (안전망)
    // saveNotification에서 type 불일치 등으로 읽음 처리가 안 된 경우 대비
    (async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return;
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1시간 이내
        await supabase
          .from('notification_logs')
          .update({ read_at: new Date().toISOString() })
          .eq('user_id', authUser.id)
          .in('type', ['medication_reminder', 'missed_medication'])
          .is('read_at', null)
          .gte('created_at', since);
        refreshBadge();
      } catch (e) {
        console.error('[MedicationScreen] 읽음 처리 오류:', e);
      }
    })();

    // 따로 거주 보호자 / 연동 환자 없는 보호자는 바텀시트 차단
    if (userRole === 'caregiver_separate' || userRole === 'caregiver_no_patient') return;

    // 화면 전환 애니메이션 완료 후 모달 오픈
    const timer = setTimeout(() => {
      setShowMealTimeModal(true);
    }, 400);
    return () => clearTimeout(timer);
  // routeParams 객체 참조가 바뀌어도 autoOpen 값 기준으로만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams.autoOpen]);

  // NotificationIntentManager 기반 알림 탭 → 모달 열기 (콜드 스타트 레이스 컨디션 해결)
  const openMedModalRef = useRef(false);
  useEffect(() => {
    const unsubscribe = notificationIntentManager.subscribe(({ mealTime }) => {
      if (openMedModalRef.current) return;
      openMedModalRef.current = true;
      setTimeout(() => { openMedModalRef.current = false; }, 2000);
      if (mealTime) setSelectedMealTime(mealTime as MealTime);
      setTimeout(() => setShowMealTimeModal(true), 100);
    });
    return unsubscribe;
  }, []);

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
  const [patientId, setPatientId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'patient') {
      setPatientName(user.name);
      setPatientId(user.id);
      // 환자 본인의 meal_schedules 로드
      supabase
        .from('users')
        .select('meal_schedules, med_time_notif_prefs')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.meal_schedules) {
            setUserMealSchedules(data.meal_schedules as Record<string, string>);
          }
          if (data?.med_time_notif_prefs) {
            setNotifPrefs(data.med_time_notif_prefs as Record<string, boolean>);
          }
        });
      return;
    }
    if (!user.patient_group_id) return;
    // 보호자인 경우 환자 정보 로드
    supabase
      .from('patient_group_members')
      .select('user_id, users(name, meal_schedules, med_time_notif_prefs)')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single()
      .then(({ data }) => {
        const userInfo = data?.users as any;
        if (userInfo?.name) setPatientName(userInfo.name);
        if (userInfo?.meal_schedules) {
          setUserMealSchedules(userInfo.meal_schedules as Record<string, string>);
        }
        if (userInfo?.med_time_notif_prefs) {
          setNotifPrefs(userInfo.med_time_notif_prefs as Record<string, boolean>);
        }
        if ((data as any)?.user_id) setPatientId((data as any).user_id);
      });
  }, [user]);

  // patient_group_id가 있어도 실제 환자 멤버가 없을 수 있으므로 patientId 기준으로 판단
  const userRole: 'patient' | 'caregiver_no_patient' | 'caregiver_same' | 'caregiver_separate' =
    user?.role !== 'caregiver'
      ? 'patient'
      : !patientId
      ? 'caregiver_no_patient'
      : user.residence_type === 'separate'
      ? 'caregiver_separate'
      : 'caregiver_same';

  const proceedSave = async (mealTime: MealTime) => {
    const nowForCheck = new Date();
    const success = await takeMedication(mealTime);
    if (!success) {
      Alert.alert('저장 실패', medError ?? '복용 기록 저장에 실패했어요. 다시 시도해 주세요.');
      return;
    }

    // 예정 알림 시간보다 일찍 기록한 경우 → 안내 팝업
    const schedStr = userMealSchedules?.[mealTime] ?? DEFAULT_MEAL_TIMES[mealTime];
    const [schedH, schedM] = schedStr.split(':').map(Number);
    const schedMinutes = schedH * 60 + schedM;
    const nowMinutes = nowForCheck.getHours() * 60 + nowForCheck.getMinutes();
    if (nowMinutes < schedMinutes) {
      const label = DEFAULT_MEAL_TIME_LABELS[mealTime].label;
      const formattedTime = formatMealTime(schedStr);
      setPreMedMessage(`${label}약 복용 기록을 미리 남기셨어요.\n알림 시간(${formattedTime})에 알림이 가지 않을게요.`);
      setShowPreMedInfo(true);
    }

    setSelectedMealTime(mealTime);

    // 다음 예정 알림 조회 — 팝업은 바로 표시하지 않고 state만 저장
    // (몸상태 팝업에서 "다음에 기록하기" 선택 시 nextNotif 팝업 표시)
    if (patientId) {
      fetchNextNotifMessage(patientId).then((info) => {
        if (info) {
          setNextNotifInfo(info);
          // setShowNextNotifModal(true); ← 몸상태 팝업 이후로 이동
        }
      });
    }

    setTimeout(() => {
      setShowBodyStateSuggest(true);
    }, 100);
  };

  const handleMealTimeSelect = (mealTime: MealTime) => {
    setShowMealTimeModal(false);

    // 이미 기록이 있으면 덮어쓰기 확인
    const existingLog = (activeStatus as any)[mealTime];
    if (existingLog) {
      const label = DEFAULT_MEAL_TIME_LABELS[mealTime].label;
      const takenAtStr = formatTakenAt(existingLog.taken_at);
      Alert.alert(
        '이미 기록이 있어요',
        `${label}약 복용 기록(${takenAtStr})이 이미 있어요.\n새 기록으로 덮어쓰시겠어요?`,
        [
          { text: '취소', style: 'cancel' },
          { text: '덮어쓰기', onPress: () => proceedSave(mealTime) },
        ],
      );
      return;
    }

    proceedSave(mealTime);
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

  // 오늘 모든 시간대(아침/점심/저녁/취침) 복용 완료 여부
  const ALL_MEAL_SLOTS: MealTime[] = ['morning', 'lunch', 'dinner', 'bedtime'];
  const allSlotsTaken = isToday && ALL_MEAL_SLOTS.every(
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
              (userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday || allSlotsTaken) && styles.mainButtonDisabled,
            ]}
            disabled={userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday || allSlotsTaken}
            onPress={() => {
              if (userRole === 'caregiver_same') {
                setShowCaregiverConfirm(true);
              } else {
                setShowMealTimeModal(true);
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.mainButtonInner}>
              <Ionicons name={allSlotsTaken ? 'checkmark-circle' : 'medkit'} size={40} color={Colors.white} />
              <Text style={styles.mainButtonText}>
                {allSlotsTaken ? '오늘 복용 완료' : '약복용 기록하기'}
              </Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>환자와 연동 후 기록할 수 있어요</Text>
          )}
          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>같이 계신 경우에만 대신 입력할 수 있어요</Text>
          )}
          {!isToday && userRole !== 'caregiver_separate' && userRole !== 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>오늘 날짜에서만 복용 기록을 입력할 수 있어요</Text>
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

        {/* 과거 기록 보기 타임라인 */}
        <HistoryTimeline type="medication" patientId={patientId} />
      </ScrollView>

      <MealTimeModal
        visible={showMealTimeModal}
        onSelect={handleMealTimeSelect}
        onClose={() => setShowMealTimeModal(false)}
        mealSchedules={userMealSchedules}
        notifPrefs={notifPrefs}
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
                // BodyState 화면으로 이동 — 거기서 기록 완료 후 NextNotif 팝업 자체 표시
                navigateTo('BodyState', {
                  triggerMinutes: 0,
                  triggerMealTime: selectedMealTime,
                  triggerTs: Date.now(),
                });
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
              onPress={() => {
                setShowBodyStateSuggest(false);
                setSelectedMealTime(null);
                // 다음 알림 팝업 표시 (nextNotifInfo가 있을 때만)
                if (nextNotifInfo) {
                  setShowNextNotifModal(true);
                }
              }}
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
      <PreMedInfoModal
        visible={showPreMedInfo}
        message={preMedMessage}
        onClose={() => setShowPreMedInfo(false)}
      />
      <NextNotifModal
        visible={showNextNotifModal}
        info={nextNotifInfo}
        onClose={() => setShowNextNotifModal(false)}
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

// ─── NextNotifInfo 타입 ───────────────────────────────────────────────────────

interface NextNotifInfo {
  label: string;      // 알림 종류 (예: "아침약 복용 후 30분 약효추적")
  timeStr: string;    // 구체적 시간 (예: "오전 9:30")
  minutesLeft: number; // 남은 분
}

// ─── fetchNextNotifMessage ────────────────────────────────────────────────────
// 기록 완료 후 다음 예정 알림 정보를 반환합니다.
// effect_tracking_queue (약효추적), meal_schedules (식사 알림), exercise_notif_prefs (운동 알림) 중 가장 가까운 것 선택.

function formatTimeHHMM(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour}:${m.toString().padStart(2, '0')}`;
}


async function fetchNextNotifMessage(patientId: string): Promise<NextNotifInfo | null> {
  try {
    const now = new Date();
    let candidates: Array<{ minutesLeft: number; label: string; sendAt: Date }> = [];

    // 1) 약효추적 큐에서 미발송 + 미래 항목 중 가장 가까운 것
    const { data: queueRows } = await supabase
      .from('effect_tracking_queue')
      .select('send_at, interval_minutes, meal_time')
      .eq('patient_id', patientId)
      .is('sent_at', null)
      .gt('send_at', now.toISOString())
      .order('send_at', { ascending: true })
      .limit(1);

    if (queueRows && queueRows.length > 0) {
      const row = queueRows[0];
      const sendAt = new Date(row.send_at);
      const minutesLeft = Math.round((sendAt.getTime() - now.getTime()) / 60000);
      const intervalMin: number = row.interval_minutes ?? 0;
      const mealKo = mealTimeToKorean(row.meal_time);

      let intervalLabel: string;
      if (intervalMin === 0) intervalLabel = '복용 직후';
      else if (intervalMin < 60) intervalLabel = `복용 ${intervalMin}분 후`;
      else {
        const h = Math.floor(intervalMin / 60);
        const rem = intervalMin % 60;
        intervalLabel = rem === 0 ? `복용 ${h}시간 후` : `복용 ${h}시간 ${rem}분 후`;
      }
      const label = mealKo ? `${mealKo} ${intervalLabel} 약효추적` : `${intervalLabel} 약효추적`;
      candidates.push({ minutesLeft, label, sendAt });
    }

    // 2) meal_schedules에서 현재 시각 이후 다음 식사 알림 + exercise_notif_prefs 운동 알림
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('meal_schedules, exercise_notif_prefs')
      .eq('id', patientId)
      .single();

    if (userError) console.error('[fetchNextNotifMessage] userData error:', userError);

    const DEFAULT_MEAL: Record<string, string> = {
      morning: '08:00', lunch: '12:00', dinner: '18:00', bedtime: '22:00',
    };

    const mealSchedules: Record<string, string> = (userData?.meal_schedules as Record<string, string>) ?? DEFAULT_MEAL;

    const MEAL_LABELS: Record<string, string> = {
      morning: '다음 아침약 복용',
      lunch: '다음 점심약 복용',
      dinner: '다음 저녁약 복용',
      bedtime: '다음 취침약 복용',
    };

    let foundMeal = false;
    for (const key of ['morning', 'lunch', 'dinner', 'bedtime']) {
      const timeStr = mealSchedules[key] ?? DEFAULT_MEAL_TIMES[key as MealTime];
      const [h, m] = timeStr.split(':').map(Number);
      const scheduled = new Date(now);
      scheduled.setHours(h, m, 0, 0);
      if (scheduled > now) {
        const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
        candidates.push({ minutesLeft, label: MEAL_LABELS[key], sendAt: scheduled });
        foundMeal = true;
        break; // 가장 가까운 한 개만
      }
    }

    // 오늘 식사 시간이 모두 지난 경우 내일 아침 폴백
    if (!foundMeal) {
      const tomorrowMorning = new Date(now);
      tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
      const morningStr = mealSchedules['morning'] ?? DEFAULT_MEAL['morning'];
      const [mh, mm] = morningStr.split(':').map(Number);
      tomorrowMorning.setHours(mh, mm, 0, 0);
      const minutesLeft = Math.round((tomorrowMorning.getTime() - now.getTime()) / 60000);
      candidates.push({ minutesLeft, label: '내일 아침약 복용', sendAt: tomorrowMorning });
    }

    // 3) 운동 알림 (exercise_notif_prefs) — 오늘 이후 가장 가까운 운동 알림 시간
    const exercisePrefs = userData?.exercise_notif_prefs as Array<{
      id: string; ampm: '오전' | '오후'; hour: number; minute: number; enabled: boolean;
    }> | null;
    if (exercisePrefs && exercisePrefs.length > 0) {
      for (const ep of exercisePrefs) {
        if (!ep.enabled) continue;
        let hour = ep.hour;
        if (ep.ampm === '오후' && hour !== 12) hour += 12;
        if (ep.ampm === '오전' && hour === 12) hour = 0;
        const scheduled = new Date(now);
        scheduled.setHours(hour, ep.minute, 0, 0);
        if (scheduled > now) {
          const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
          candidates.push({ minutesLeft, label: '운동 알림', sendAt: scheduled });
        }
      }
    }

    // 최후 폴백: candidates가 비어있으면 내일 아침 08:00
    if (candidates.length === 0) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      return {
        label: '내일 아침약 복용',
        timeStr: formatTimeHHMM(tomorrow),
        minutesLeft: Math.round((tomorrow.getTime() - now.getTime()) / 60000),
      };
    }

    // 더 가까운 것 선택
    candidates.sort((a, b) => a.minutesLeft - b.minutesLeft);
    const best = candidates[0];

    if (best.minutesLeft < 1) return null;

    return {
      label: best.label,
      timeStr: formatTimeHHMM(best.sendAt),
      minutesLeft: best.minutesLeft,
    };
  } catch (e) {
    console.error('[fetchNextNotifMessage] error:', e);
    return null;
  }
}

// ─── NextNotifModal ───────────────────────────────────────────────────────────

function NextNotifModal({ visible, info, onClose }: { visible: boolean; info: NextNotifInfo | null; onClose: () => void }) {
  if (!visible || !info) return null;

  let minutesText: string;
  if (info.minutesLeft < 60) {
    minutesText = `${info.minutesLeft}분`;
  } else {
    const h = Math.floor(info.minutesLeft / 60);
    const rem = info.minutesLeft % 60;
    minutesText = rem === 0 ? `${h}시간` : `${h}시간 ${rem}분`;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={nnStyles.overlay}>
        <View style={nnStyles.card}>
          <Text style={nnStyles.icon}>🔔</Text>
          <Text style={nnStyles.title}>다음 알림 예고</Text>

          {/* 알림 종류 — 오렌지 배경 pill */}
          <View style={nnStyles.labelPill}>
            <Text style={nnStyles.labelPillText}>{info.label}</Text>
          </View>

          {/* 구체적 시간 — 크게 */}
          <Text style={nnStyles.timeText}>{info.timeStr}</Text>

          {/* 서브텍스트 */}
          <Text style={nnStyles.subText}>
            지금부터 약 {minutesText} 후에{'\n'}알림을 보내드릴게요
          </Text>

          <TouchableOpacity style={nnStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={nnStyles.closeBtnText}>확인</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const nnStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 20 },
  labelPill: {
    backgroundColor: '#FF6B00',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 16,
  },
  labelPillText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  timeText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FF6B00',
    marginBottom: 16,
  },
  subText: {
    fontSize: 17,
    color: Colors.textSub,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 28,
  },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});

// ─── PreMedInfoModal ──────────────────────────────────────────────────────────

function PreMedInfoModal({ visible, message, onClose }: { visible: boolean; message: string; onClose: () => void }) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={pmStyles.overlay}>
        <View style={pmStyles.card}>
          <Text style={pmStyles.icon}>🔕</Text>
          <Text style={pmStyles.title}>알림 취소 안내</Text>
          <Text style={pmStyles.message}>{message}</Text>
          <TouchableOpacity style={pmStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={pmStyles.closeBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const pmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 16 },
  message: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 28,
    textAlign: 'center',
    marginBottom: 28,
  },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
