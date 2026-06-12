import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute, useNavigation, RouteProp } from '@react-navigation/native';
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
import { useDialog } from '../../context/DialogContext';
import { HistoryTimeline } from '../../components/common/HistoryTimeline';
import { useRecordRealtime } from '../../hooks/useRecordRealtime';
import { mealTimeToKorean } from '../../utils/medUtils';
import { notificationIntentManager } from '../../utils/NotificationIntentManager';
import { ensureNotGuest } from '../../utils/guestGuard';
import { resolveDisplaySlots, fetchPatientDoseSlots, type DoseSlot } from '../../hooks/useDoseSlots';
import {
  LEGACY_SLOT_META,
  LEGACY_SLOT_ORDER,
  LEGACY_KEY_TO_LABEL,
  formatSlotTime,
  slotTitle,
  type LegacyMealKey,
} from '../../constants/doseSlots';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';

interface MedicationStatus {
  id: string; // 카드 key: dose_slot id(이관) 또는 legacy meal_time 키(미이관)
  label: string;
  time: string;
  /** 라벨이 이미 시각을 포함(비표준 추가 슬롯) → 예정 줄에서 시각 중복 표기 생략. */
  labelHasTime?: boolean;
  taken: boolean;
  takenAt?: string;
  medLogId?: string; // 취소(삭제)용 med_logs.id
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
  doseSlotId?: string | null;
};

// 온보딩에서 초대번호를 건너뛴 첫 진입 회원에게 가족 연동을 1회 안내했는지 여부.
const FAMILY_LINK_GUIDE_SHOWN_KEY = 'family_link_guide_shown';

export function MedicationScreen() {
  const route = useRoute<RouteProp<{ Medication: MedicationRouteParams }, 'Medication'>>();
  const navigation = useNavigation<any>();
  const routeParams = (route.params ?? {}) as MedicationRouteParams;
  // 동일 autoOpen 값으로 재진입 시 모달 재오픈 차단 (탭 이동 후 재마운트 방어)
  const processedAutoOpenRef = useRef<number | boolean | null>(null);
  const { user, signOut } = useAuth();
  const {
    todayStatus,
    slots: doseSlots,
    bySlotId: todayBySlotId,
    hasDoseSlots,
    takeMedication,
    cancelMedication,
    getMedLogs,
    error: medError,
    refresh,
  } = useMedication();
  const { saveBodyState, todayLogs: bodyLogs } = useBodyState();
  const insets = useSafeAreaInsets();
  const { unreadCount, refreshBadge } = useNotificationBadge();
  const dialog = useDialog();

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
  // 7단계: 방금 기록한 복용의 슬롯/복용 식별자.
  // 복용 직후 즉시 몸상태 팝업("기록하기")이 on_off_logs.dose_slot_id / med_log_id 에 귀속하도록
  // proceedSave 에서 takeMedication 반환값을 보관 → 팝업 navigate 시 BodyState 로 전달.
  const [lastMedLogId, setLastMedLogId] = useState<string | null>(null);
  const [lastDoseSlotId, setLastDoseSlotId] = useState<string | null>(null);
  // 방금 기록한 슬롯의 "복용 직후"(track_intervals에 0 포함 + 추적 ON) 여부.
  // 이게 꺼져 있으면 복용 직후 자동 몸상태 팝업을 띄우지 않는다. (사전기록 onClose 경로에서도 참조)
  const immediateSuggestRef = useRef(true);
  // 알림으로 진입 시 "이 약 맞나요?" 확인 다이얼로그가 여러 경로(라우트 param·IntentManager·AsyncStorage)에서
  // 중복으로 뜨지 않도록 막는 가드(3초 윈도우).
  const notifEntryGuardRef = useRef(0);

  // 가족 연동 안내(1회)가 이번 세션에서 이미 트리거됐는지 — 중복 표시 방지.
  const familyGuideTriggeredRef = useRef(false);

  // 온보딩에서 초대번호를 건너뛴 첫 진입 회원에게 가족 연동을 1회 안내.
  //   - 이미 가족과 연동된 회원/이미 안내한 회원은 표시 안 함.
  //   - 받은 초대번호가 있으면 입력해 연동 / 첫 가입자면 가족 초대 → '가족 연동하러 가기' 시 가족 연동 화면으로.
  const maybeShowFamilyGuide = useCallback(async () => {
    if (!user?.onboarding_done) return;
    if (user?.patient_group_id) return; // 이미 연동됨
    if (familyGuideTriggeredRef.current) return;
    familyGuideTriggeredRef.current = true;
    try {
      const shown = await AsyncStorage.getItem(FAMILY_LINK_GUIDE_SHOWN_KEY);
      if (shown) return;
      await AsyncStorage.setItem(FAMILY_LINK_GUIDE_SHOWN_KEY, '1');
    } catch {
      return;
    }
    // 다른 모달 닫힘/화면 전환 후 표시
    setTimeout(async () => {
      const ok = await dialog.confirm({
        title: '가족과 함께 사용해요',
        message:
          '받으신 초대번호가 있다면 입력해서 가족과 연동할 수 있어요.\n\n' +
          '가족 중 처음 가입하셨다면, 가족을 초대해 환자와 보호자가 함께 사용할 수 있어요.',
        confirmText: '가족 연동하러 가기',
        cancelText: '나중에',
      });
      if (ok) {
        navigateTo('Main', { screen: 'MyInfo', params: { screen: 'FamilyLink' } });
      }
    }, 400);
  }, [user?.onboarding_done, user?.patient_group_id, dialog]);

  // 온보딩 완료 후 홈 최초 진입 시 알림 설정 팝업 1회 표시.
  //   알림 온보딩을 이미 본 회원이면 가족 연동 안내를 바로 확인.
  useEffect(() => {
    if (!user?.onboarding_done) return;
    AsyncStorage.getItem(NOTIF_ONBOARDING_SHOWN_KEY).then((val) => {
      if (!val) {
        // 약간의 딜레이 후 표시 (화면 전환 애니메이션 완료 후)
        setTimeout(() => setShowNotifOnboarding(true), 600);
      } else {
        // 알림 온보딩은 이미 봤지만 가족 연동 안내를 못 본 회원 → 가족 안내 표시
        maybeShowFamilyGuide();
      }
    }).catch(() => {});
  }, [user?.onboarding_done, maybeShowFamilyGuide]);

  // 알림 탭 진입 시 MealTimeModal 자동 오픈
  // App.tsx에서 navigation params { autoOpen: true, mealTime: '아침' } 전달
  useEffect(() => {
    if (!routeParams.autoOpen) return;
    // 같은 autoOpen 값으로 재진입(탭 재마운트 등) 시 무시
    if (processedAutoOpenRef.current === routeParams.autoOpen) return;
    processedAutoOpenRef.current = routeParams.autoOpen;

    // 알림으로 진입 시 미읽음 약 복용 알림 읽음 처리 (안전망)
    // saveNotification에서 type 불일치 등으로 읽음 처리가 안 된 경우 대비
    // cutoff: 오늘 KST 0시 (1~2시간 늦게 탭해도 안전망 작동하도록 확장)
    (async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return;
        // 오늘 KST 0시(=UTC 전날 15:00) 기준 since 계산
        const now = new Date();
        const koreaToday = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        koreaToday.setUTCHours(0, 0, 0, 0);
        const since = new Date(koreaToday.getTime() - 9 * 60 * 60 * 1000).toISOString();
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
    // ⚠️ 주석 처리: patientId 비동기 로드 전 userRole이 잘못 계산돼 modal 오픈이 막힘 (AsyncStorage useFocusEffect 방식으로 대체)
    // if (userRole === 'caregiver_separate' || userRole === 'caregiver_no_patient') return;

    // 화면 전환 애니메이션 완료 후: 알림에 실린 슬롯으로 "이 약 맞나요?" 확인 → 바로 기록.
    const enterMealTime = routeParams.mealTime ?? null;
    const enterDoseSlotId = routeParams.doseSlotId ?? null;
    const timer = setTimeout(() => {
      enterFromNotification({ mealTime: enterMealTime, doseSlotId: enterDoseSlotId });
      // routeParams 즉시 clear → 탭 이동 후 재진입 시 stale 값으로 재오픈되는 것 차단
      try {
        navigation.setParams({ autoOpen: undefined, mealTime: undefined, doseSlotId: undefined });
      } catch (e) {
        console.warn('[MedicationScreen] setParams clear 실패:', e);
      }
    }, 400);
    return () => clearTimeout(timer);
  // routeParams 객체 참조가 바뀌어도 autoOpen 값 기준으로만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams.autoOpen]);

  // NotificationIntentManager 기반 알림 탭 → 모달 열기 (콜드 스타트 레이스 컨디션 해결)
  const openMedModalRef = useRef(false);
  useEffect(() => {
    const unsubscribe = notificationIntentManager.subscribe(({ mealTime, doseSlotId }) => {
      if (openMedModalRef.current) return;
      openMedModalRef.current = true;
      setTimeout(() => { openMedModalRef.current = false; }, 2000);
      setTimeout(() => enterFromNotification({ mealTime: mealTime ?? null, doseSlotId: doseSlotId ?? null }), 100);
    });
    return unsubscribe;
  }, []);

  // 날짜별 복용 현황 (날짜 선택 시 사용)
  const [dateLogStatus, setDateLogStatus] = useState<Record<string, any> | null>(null);
  const [dateLogsLoading, setDateLogsLoading] = useState(false);

  const isToday = toLocalDateString(selectedDate) === toLocalDateString(new Date());

  // ⚠️ 회귀 수정: 과거 날짜 현황도 fetchTodayStatus(useMedication)와 동일한 정규키 규칙을 써야
  // 이관 환자(dose_slots 보유)의 과거 back-fill 로그(dose_slot_id=UUID)와 카드 키(slot.id=UUID)가
  // 일치해 완료표시가 뜬다. 이전엔 과거 경로가 `dose_slot_id ?? meal_time`만 써서
  // meal_time 만 있는 과거 로그가 UUID 카드 키와 안 맞아 누락됐음.
  // legacyKey(meal_time) → 정규 dose_slot id 매핑 (doseSlots = useMedication().slots, 실제 행).
  const legacyKeyToSlotId = useMemo(() => {
    const m = new Map<string, string>();
    doseSlots.forEach((s) => {
      if (s.legacyKey && s.id) m.set(s.legacyKey, s.id);
    });
    return m;
  }, [doseSlots]);

  // 로그 1건 → 정규 슬롯 키. fetchTodayStatus 와 동일 우선순위.
  //   dose_slot_id ?? legacyKeyToSlotId.get(meal_time) ?? meal_time
  // 미이관 환자는 doseSlots 가 비어 매핑 실패 → meal_time 키 유지(legacy 매칭 정상).
  const slotKeyForLog = useCallback(
    (log: { dose_slot_id?: string | null; meal_time?: string | null }): string | null => {
      return (
        log.dose_slot_id ??
        (log.meal_time ? legacyKeyToSlotId.get(log.meal_time) : undefined) ??
        log.meal_time ??
        null
      );
    },
    [legacyKeyToSlotId]
  );

  // 탭/화면 포커스 시 복용 현황 재조회 (오늘 날짜인 경우)
  useFocusEffect(
    useCallback(() => {
      if (isToday) {
        refresh();
        setDateLogStatus(null);
      }
    }, [refresh, isToday])
  );

  // 알림 탭 → 모달 열기 (AsyncStorage 방식, 가장 신뢰할 수 있는 방식 — 레이스 컨디션 완전 제거)
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('pendingMedNotif').then(async (value) => {
        if (!value) return;
        // removeItem await 보장: stale 재트리거 방지
        await AsyncStorage.removeItem('pendingMedNotif');
        try {
          const data = JSON.parse(value);
          // TTL 5분 초과 → stale 폐기 (모달 표시 안 함)
          if (data?.ts && Date.now() - data.ts > 5 * 60 * 1000) return;
          const mealTime = data?.mealTime ?? null;
          const doseSlotId = data?.doseSlotId ?? null;
          setTimeout(() => enterFromNotification({ mealTime, doseSlotId }), 300);
        } catch {}
      });
    }, [])
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
      // 슬롯 단위 현황(키 = dose_slot_id ?? meal_time). todayBySlotId 와 동일 규칙.
      const status: Record<string, any> = {
        morning: null,
        lunch: null,
        dinner: null,
        bedtime: null,
      };
      logs.forEach((log) => {
        // legacy 4슬롯 키(기존 호환)
        const slot = log.meal_time as keyof typeof status;
        if (slot && slot in status && !status[slot]) {
          status[slot] = log;
        }
        // 슬롯 단위 키 — fetchTodayStatus 와 동일한 정규키 규칙(이관 환자 키 통일)
        const key = slotKeyForLog(log);
        if (key && !status[key]) {
          status[key] = log;
        }
      });
      setDateLogStatus(status);
      setDateLogsLoading(false);
    });
  }, [selectedDate, isToday, getMedLogs, slotKeyForLog]);

  // 표시할 현황: 오늘이면 슬롯 단위(todayBySlotId), 과거 날짜면 dateLogStatus.
  // 둘 다 키 = dose_slot_id ?? meal_time 규칙으로 통일됨.
  const activeStatus: Record<string, any> = isToday
    ? todayBySlotId
    : (dateLogStatus ?? { morning: null, lunch: null, dinner: null, bedtime: null });

  const [patientName, setPatientName] = useState('환자');
  const [patientId, setPatientId] = useState<string | null>(null);

  // 과거기록(HistoryTimeline) 실시간 갱신 키
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0);

  // 약복용 기록 실시간 동기화 — 환자↔보호자 기기 즉시 반영
  useRecordRealtime('med_logs', patientId, () => {
    refresh();                          // 오늘 복용현황 갱신
    setRecordsRefreshKey((k) => k + 1); // 과거기록(HistoryTimeline) 갱신
  });

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

  // 취소 버튼 노출 조건: 환자 본인 또는 함께 거주 보호자(연동된 환자 있음)
  const canCancelRecord = userRole === 'patient' || userRole === 'caregiver_same';

  // 복용 기록 취소(삭제) — 확인 팝업 후 RPC로 삭제, 성공 시 현황 갱신
  const handleCancelRecord = async (medLogId: string) => {
    const ok = await dialog.confirm({
      title: '이 기록을 취소할까요?',
      message: '취소하면 기록이 삭제되고 되돌릴 수 없어요.',
      confirmText: '취소하기',
      cancelText: '닫기',
      destructive: true,
    });
    if (!ok) return;

    const success = await cancelMedication(medLogId);
    if (!success) {
      dialog.alert({ title: '취소 실패', message: '기록을 취소하지 못했어요.\n다시 시도해 주세요.' });
      return;
    }
    // 성공 시 현황 갱신 (오늘이면 cancelMedication 내부 fetchTodayStatus, 과거 날짜면 재조회)
    if (!isToday) {
      const dateStr = toLocalDateString(selectedDate);
      const logs = await getMedLogs(dateStr);
      const status: Record<string, any> = { morning: null, lunch: null, dinner: null, bedtime: null };
      logs.forEach((log) => {
        const slot = log.meal_time as keyof typeof status;
        if (slot && slot in status && !status[slot]) status[slot] = log;
        // fetchTodayStatus 와 동일한 정규키 규칙(이관 환자 키 통일)
        const key = slotKeyForLog(log);
        if (key && !status[key]) status[key] = log;
      });
      setDateLogStatus(status);
    }
  };

  const proceedSave = async (sel: { mealTime: MealTime | null; doseSlotId: string | null }) => {
    const { mealTime, doseSlotId } = sel;
    const nowForCheck = new Date();
    const result = await takeMedication({ mealTime, doseSlotId });
    if (!result.success) {
      dialog.alert({ title: '저장 실패', message: medError ?? '복용 기록 저장에 실패했어요. 다시 시도해 주세요.' });
      return;
    }

    // 7단계: 방금 기록한 복용의 식별자 보관 → 즉시 몸상태 팝업이 슬롯 귀속에 사용.
    //   takeMedication 이 doseSlotId 를 legacyKey→slot.id 로 보충했을 수 있으므로 반환값을 신뢰.
    setLastMedLogId(result.medLogId);
    setLastDoseSlotId(result.doseSlotId);

    // 해당 슬롯(이관/비표준 모두) — 사전기록 안내·라벨 폴백에 사용.
    const selSlot = doseSlotId
      ? displaySlots.find((s) => s.id === doseSlotId)
      : (mealTime ? displaySlots.find((s) => s.legacyKey === mealTime) : undefined);

    // 약 기록 성공 → 종 아이콘 뱃지 즉시 갱신 (safety net)
    // useMedication 훅 내부에서 이미 읽음 처리하지만 Context 카운트 동기화를 위해 한 번 더 호출
    refreshBadge().catch(() => {});

    // 예정 알림 시간보다 일찍 기록한 경우 → 안내 팝업.
    // 시각 폴백 우선순위: 슬롯 time → legacy meal_schedules[key] → 기본값.
    // (mealTime 이 null 인 비표준 슬롯도 슬롯 time 으로 안내 가능)
    const schedStr =
      selSlot?.time ||
      (mealTime ? (userMealSchedules?.[mealTime] ?? DEFAULT_MEAL_TIMES[mealTime]) : undefined);
    let isPreMed = false;
    if (schedStr) {
      const [schedH, schedM] = schedStr.split(':').map(Number);
      const schedMinutes = schedH * 60 + schedM;
      const nowMinutes = nowForCheck.getHours() * 60 + nowForCheck.getMinutes();
      isPreMed = nowMinutes < schedMinutes;
      if (isPreMed) {
        const label =
          (mealTime ? DEFAULT_MEAL_TIME_LABELS[mealTime].label : null) ||
          selSlot?.label ||
          '';
        const formattedTime = formatMealTime(schedStr);
        const labelPrefix = label ? `${label}약 ` : '';
        setPreMedMessage(`${labelPrefix}복용 기록을 미리 남기셨어요.\n알림 시간(${formattedTime})에 알림이 가지 않을게요.`);
      }
    }

    // selectedMealTime 은 BodyState 네비/취침 변비질문에 쓰임 → legacy key 유지(없으면 null).
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

    // "복용 직후" 설정이 켜져 있을 때만 복용 직후 자동 몸상태 팝업을 띄운다.
    //  - 신규 dose_slot 모델: 슬롯의 추적 ON + track_intervals 에 0(복용 직후) 포함 시에만.
    //  - 구(legacy) 모델: trackIntervals 에 0이 없으므로 게이팅하지 않고 기존대로 항상 표시.
    const onNewDoseModel = Array.isArray(doseSlots) && doseSlots.length > 0;
    // 슬롯을 확실히 찾았고 "복용 직후"가 꺼져 있을 때만 억제. (못 찾으면 안전하게 표시)
    const showImmediateSuggest = (onNewDoseModel && selSlot)
      ? (selSlot.trackEnabled && selSlot.trackIntervals.includes(0))
      : true;
    immediateSuggestRef.current = showImmediateSuggest;

    // ⚠️ iOS는 모달을 동시에 두 개 띄우지 못함 → 안내 팝업과 몸상태 권유가 겹치면
    //    하나 닫은 뒤 안 보이는 오버레이가 남아 스크롤이 막힘.
    //    따라서 사전기록 안내가 있으면 그 팝업을 먼저 띄우고, 닫힌 뒤(onClose)에 몸상태 권유를 표시한다.
    if (isPreMed) {
      setShowPreMedInfo(true);
    } else if (showImmediateSuggest) {
      setTimeout(() => {
        setShowBodyStateSuggest(true);
      }, 100);
    }
  };

  // 선택(mealTime/doseSlotId) → activeStatus 키 해석.
  // dose_slots 환자면 슬롯 id, 미이관 환자면 meal key 그대로.
  // (write 경로의 "이미 기록 있음" 확인용 — 표시 규칙과 동일하게 슬롯 단위로 조회)
  const findLogBySel = (sel: { mealTime: MealTime | null; doseSlotId: string | null }): any => {
    const slot = sel.doseSlotId
      ? displaySlots.find((s) => s.id === sel.doseSlotId)
      : (sel.mealTime ? displaySlots.find((s) => s.legacyKey === sel.mealTime) : undefined);
    const key = slot ? slotStatusKey(slot) : (sel.doseSlotId ?? sel.mealTime);
    return (key && activeStatus[key]) || (sel.mealTime && (activeStatus as any)[sel.mealTime]) || null;
  };

  const handleMealTimeSelect = (sel: { mealTime: MealTime | null; doseSlotId: string | null }) => {
    setShowMealTimeModal(false);

    // 라벨: legacy key 우선, 없으면 슬롯 label.
    const selSlot = sel.doseSlotId
      ? displaySlots.find((s) => s.id === sel.doseSlotId)
      : (sel.mealTime ? displaySlots.find((s) => s.legacyKey === sel.mealTime) : undefined);
    const label =
      (sel.mealTime ? DEFAULT_MEAL_TIME_LABELS[sel.mealTime].label : null) ||
      selSlot?.label ||
      '';
    const labelPrefix = label ? `${label}약 ` : '';

    // 이미 기록이 있으면 덮어쓰기 확인
    const existingLog = findLogBySel(sel);
    if (existingLog) {
      const takenAtStr = formatTakenAt(existingLog.taken_at);
      dialog
        .confirm({
          title: '이미 기록이 있어요',
          message: `${labelPrefix}복용 기록(${takenAtStr})이 이미 있어요.\n새 기록으로 덮어쓰시겠어요?`,
          confirmText: '덮어쓰기',
          cancelText: '취소',
        })
        .then((ok) => {
          if (ok) proceedSave(sel);
        });
      return;
    }

    proceedSave(sel);
  };

  // 알림(약 복용/미복용)을 눌러 진입한 경우: 알림에 실린 슬롯 식별자로 "어떤 약인지" 자동 판별.
  //  → 매번 시간대를 직접 고르게 하지 않고, "○○ 약을 드셨나요?" 한 번만 확인받고 바로 기록.
  //  (자동 판별이 틀렸으면 '다른 시간 선택'으로 기존 선택 모달로 폴백)
  // attempt: 콜드스타트 시 dose_slots 로딩 전이면 selSlot 을 못 찾을 수 있어 1회 재시도.
  function enterFromNotification(
    sel: { mealTime: string | null; doseSlotId: string | null },
    attempt: number = 0,
  ) {
    // 여러 진입 경로(라우트 param·IntentManager·AsyncStorage)에서 같은 탭으로 중복 호출되는 것 차단.
    if (attempt === 0) {
      if (Date.now() - notifEntryGuardRef.current < 3000) return;
      notifEntryGuardRef.current = Date.now();
    }

    const selSlot = sel.doseSlotId
      ? displaySlots.find((s) => s.id === sel.doseSlotId)
      : (sel.mealTime ? displaySlots.find((s) => s.legacyKey === sel.mealTime) : undefined);

    if (!selSlot) {
      // 슬롯 로딩 전일 수 있음 → 한 번 재시도, 그래도 못 찾으면 기존처럼 전체 선택 모달로.
      if (attempt < 1) {
        setTimeout(() => enterFromNotification(sel, attempt + 1), 600);
        return;
      }
      if (sel.mealTime) setSelectedMealTime(sel.mealTime as MealTime);
      setShowMealTimeModal(true);
      return;
    }

    // 알림으로 들어왔으니 어떤 약인지는 이미 정해짐 → 한 번 더 확인만 받고 바로 기록.
    const title = slotTitle(selSlot.label, selSlot.legacyKey, selSlot.time);
    dialog
      .confirm({
        title: '약 복용 기록',
        message: `${title} 약을 드셨나요?`,
        confirmText: '네, 복용했어요',
        cancelText: '다른 시간 선택',
      })
      .then((ok) => {
        if (ok) {
          // 이미 기록이 있으면 handleMealTimeSelect 가 덮어쓰기 확인 후 저장.
          handleMealTimeSelect({
            mealTime: (selSlot.legacyKey as MealTime | null) ?? null,
            doseSlotId: selSlot.id ?? null,
          });
        } else {
          // 자동 판별이 틀렸을 수 있으니 전체 선택 모달로.
          setShowMealTimeModal(true);
        }
      });
  }

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

  // ─── 표시 슬롯 리스트(단일 분기점) ────────────────────────────────────────────
  // dose_slots 환자면 N개 동적, 미이관 환자면 legacy 4슬롯 가상슬롯.
  // (resolveDisplaySlots 가 useMedication.slots 가 비면 meal_schedules 로 폴백)
  const displaySlots: DoseSlot[] = resolveDisplaySlots(doseSlots, userMealSchedules, notifPrefs);

  // 슬롯의 현황 키 = dose_slot id 또는 legacyKey(=meal_time). activeStatus 와 동일 규칙.
  const slotStatusKey = (slot: DoseSlot): string | null => slot.id ?? slot.legacyKey ?? null;

  // displaySlots → MedicationStatus[] 변환 (카드 표시용, 디자인 그대로)
  const displayList: MedicationStatus[] = displaySlots.map((slot, idx) => {
    const key = slotStatusKey(slot);
    const log = key ? activeStatus[key] : null;
    // 라벨: 설정 화면(slotTitle)과 동일하게 이름+시각 인라인 → "아침 오전 6:00", "밤 11:00".
    const label = slotTitle(slot.label, slot.legacyKey, slot.time);
    const labelHasTime = true; // 시각이 라벨에 포함되므로 시각을 별도로 표시하지 않음
    // 시각: 슬롯 time(HH:MM) → '오전 H:MM'
    const timeStr = formatSlotTime(slot.time);
    // 카드 key: 슬롯 id(이관) 또는 legacyKey(미이관). 둘 다 없으면 시각+idx로 고유화.
    const cardId = (slot.id ?? slot.legacyKey ?? `${slot.time}-${idx}`) as any;

    return log
      ? { id: cardId, label, time: timeStr, labelHasTime, taken: true, takenAt: formatTakenAt(log.taken_at), medLogId: log.id }
      : { id: cardId, label, time: timeStr, labelHasTime, taken: false };
  });

  // 오늘 모든 활성 슬롯 복용 완료 여부 (4슬롯 가정 제거, N개 every)
  const allSlotsTaken =
    isToday &&
    displaySlots.length > 0 &&
    displaySlots.every((slot) => {
      const key = slotStatusKey(slot);
      return key ? !!activeStatus[key] : false;
    });

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
            onPress={async () => {
              if (await ensureNotGuest(user, dialog, { signOut })) return;
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
                      {item.taken
                        ? `${item.takenAt} 복용 완료`
                        : item.labelHasTime
                          ? '복용 예정'
                          : `${item.time} 예정`}
                    </Text>
                  </View>
                  <View style={[styles.cardBadge, !item.taken && styles.cardBadgeIncomplete]}>
                    <Text style={[styles.cardBadgeText, !item.taken && styles.cardBadgeTextIncomplete]}>
                      {item.taken ? '완료' : '미완료'}
                    </Text>
                  </View>
                </View>
                {item.taken && canCancelRecord && item.medLogId && (
                  <TouchableOpacity
                    style={styles.cardCancelBtn}
                    onPress={() => handleCancelRecord(item.medLogId!)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cardCancelText}>취소</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* 과거 기록 보기 타임라인 */}
        <HistoryTimeline type="medication" patientId={patientId} refreshKey={recordsRefreshKey} />
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
              onPress={async () => {
                const mealTimeForNav = selectedMealTime;
                // 7단계: 즉시 몸상태 팝업도 방금 기록한 복용의 슬롯/복용 식별자를 함께 전달.
                //   BodyStateScreen 이 triggerDoseSlotId / triggerMedLogId →
                //   pendingDoseSlotId / pendingMedLogId → on_off_logs.dose_slot_id / med_log_id 로 기록.
                //   (medication_meal_time 전달은 그대로 보존 = dual)
                const doseSlotIdForNav = lastDoseSlotId;
                const medLogIdForNav = lastMedLogId;
                setShowBodyStateSuggest(false);
                // AsyncStorage write 완료 보장 후 navigate — race condition 방지
                // (BodyStateScreen useFocusEffect가 read 시점에 값이 있어야 함)
                try {
                  await AsyncStorage.setItem('pendingBodyStateNotif', JSON.stringify({
                    triggerMinutes: 0,
                    triggerMealTime: mealTimeForNav,
                    triggerDoseSlotId: doseSlotIdForNav,
                    triggerMedLogId: medLogIdForNav,
                  }));
                } catch {}
                // 안전한 nested navigation: Main > BodyStateTab > BodyState
                // route.params에도 직접 전달 (AsyncStorage 콜드스타트 fallback과 이중화)
                navigateTo('Main', {
                  screen: 'BodyStateTab',
                  params: {
                    screen: 'BodyState',
                    params: {
                      triggerMinutes: 0,
                      triggerMealTime: mealTimeForNav,
                      triggerDoseSlotId: doseSlotIdForNav,
                      triggerMedLogId: medLogIdForNav,
                      triggerTs: Date.now(),
                    },
                  },
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
        onClose={() => {
          setShowPreMedInfo(false);
          // 모달 중첩(iOS) 방지: 안내 팝업이 완전히 닫힌 뒤 몸상태 권유 표시
          // (단, "복용 직후"가 꺼진 슬롯이면 표시하지 않는다)
          if (immediateSuggestRef.current) {
            setTimeout(() => setShowBodyStateSuggest(true), 300);
          }
        }}
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
        onClose={() => { setShowNotifOnboarding(false); maybeShowFamilyGuide(); }}
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

  /* 복용 기록 취소 버튼 — secondary, 아이콘+텍스트, 터치영역 44dp 이상 */
  cardCancelBtn: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.danger,
    backgroundColor: Colors.white,
  },
  cardCancelText: { fontSize: 16, fontWeight: '700', color: Colors.danger },
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

// 'HH:MM[:SS]' → 오늘(now 기준) 해당 시각의 Date
function parseHHMM(hhmm: string, base: Date): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}


async function fetchNextNotifMessage(patientId: string): Promise<NextNotifInfo | null> {
  try {
    const now = new Date();
    let candidates: Array<{ minutesLeft: number; label: string; sendAt: Date }> = [];

    // 1) 약효추적 큐에서 미발송 + 미래 항목 중 가장 가까운 것
    //    dose_slot_id 있으면 슬롯 label 로, 없으면 legacy meal_time 으로 라벨 해석.
    const { data: queueRows } = await supabase
      .from('effect_tracking_queue')
      .select('send_at, interval_minutes, meal_time, dose_slot_id')
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
      // 라벨 해석: dose_slot_id 있으면 슬롯 label, 없으면 legacy meal_time.
      let mealKo: string | null = null;
      if (row.dose_slot_id) {
        const qSlots = await fetchPatientDoseSlots(patientId);
        const qSlot = qSlots.find((s) => s.id === row.dose_slot_id);
        mealKo = qSlot?.label ?? mealTimeToKorean(row.meal_time);
      } else {
        mealKo = mealTimeToKorean(row.meal_time);
      }

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

    // dose_slots 조회 → 있으면 슬롯 시각/라벨로, 없으면 legacy meal_schedules 폴백.
    // 공용 상수(LEGACY_SLOT_META/ORDER) 사용으로 화면 내 하드코딩 제거.
    const { data: slotRows } = await supabase
      .from('dose_slots')
      .select('time, label, remind_enabled, sort_order')
      .eq('patient_id', patientId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('time', { ascending: true });

    // 다음 복용 후보: { time'HH:MM', label } 리스트 (시각 오름차순)
    type MealCandidate = { time: string; label: string };
    let mealCandidates: MealCandidate[] = [];

    if (slotRows && slotRows.length > 0) {
      // dose_slots 환자: 알림 켜진 슬롯만, 시각순. 라벨은 슬롯 label 우선.
      mealCandidates = slotRows
        .filter((r: any) => r.remind_enabled !== false && r.time)
        .map((r: any) => {
          const hhmm = String(r.time).slice(0, 5);
          const labelText = r.label ? `다음 ${r.label}약 복용` : `다음 ${formatTimeHHMM(parseHHMM(hhmm, now))} 복용`;
          return { time: hhmm, label: labelText };
        });
    } else {
      // 미이관(legacy) 환자: meal_schedules + 공용 LEGACY_SLOT_META
      const mealSchedules: Record<string, string> =
        (userData?.meal_schedules as Record<string, string>) ?? {};
      mealCandidates = LEGACY_SLOT_ORDER.map((key) => {
        const meta = LEGACY_SLOT_META[key];
        const time = mealSchedules[key] ?? meta.defaultTime;
        return { time, label: `다음 ${LEGACY_KEY_TO_LABEL[key]}약 복용` };
      });
    }

    let foundMeal = false;
    for (const mc of mealCandidates) {
      const scheduled = parseHHMM(mc.time, now);
      if (scheduled > now) {
        const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
        candidates.push({ minutesLeft, label: mc.label, sendAt: scheduled });
        foundMeal = true;
        break; // 가장 가까운 한 개만
      }
    }

    // 오늘 복용 시간이 모두 지난 경우 → 내일 첫 복용 폴백
    if (!foundMeal && mealCandidates.length > 0) {
      const first = mealCandidates[0];
      const tomorrowFirst = parseHHMM(first.time, now);
      tomorrowFirst.setDate(tomorrowFirst.getDate() + 1);
      const minutesLeft = Math.round((tomorrowFirst.getTime() - now.getTime()) / 60000);
      candidates.push({ minutesLeft, label: `내일 ${first.label.replace(/^다음 /, '')}`, sendAt: tomorrowFirst });
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
