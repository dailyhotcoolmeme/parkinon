import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BodyStatePopupFlow } from './BodyStatePopupFlow';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { useAuth } from '../../context/AuthContext';
import { useBodyState } from '../../hooks/useBodyState';
import { triggerLabelToText, mealTimeToKorean, mealTimeToPeriod } from '../../utils/medUtils';
import { fetchPatientDoseSlots, resolveDisplaySlots } from '../../hooks/useDoseSlots';
import { useScrollTopOnTabPress } from '../../hooks/useScrollTopOnTabPress';
import type { DoseSlot } from '../../hooks/useDoseSlots';
import { nextDoseLabel, slotSortValue, buildSlotTitleMaps } from '../../constants/doseSlots';
import { navigateTo } from '../../navigation/navigationRef';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useSettings } from '../../context/SettingsContext';
import { useDialog } from '../../context/DialogContext';
import { HistoryTimeline } from '../../components/common/HistoryTimeline';
import { useRecordRealtime } from '../../hooks/useRecordRealtime';
import { ensureNotGuest } from '../../utils/guestGuard';
import { MeasurementInviteModal } from '../../components/measurement/MeasurementInviteModal';
import { ensureMeasurementConsent } from '../../utils/measurementConsent';
import { MEASUREMENT_FEATURE_ENABLED } from '../../constants/featureFlags';
import { buildRecommendedMedNotifs } from '../../utils/recommendUtils';
import type { MeasurementMedPhase } from '../../types/database';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

interface BodyRecord {
  id: string;
  time: string;
  /** 시간대 키('아침'/'점심'/'저녁'/'취침') — 아이콘/색 매핑·기존 동작 보존용 */
  period: string;
  /** 표시용 슬롯 명칭(slotTitle, 예: "아침 오전 6:00") — 헤더/그룹 제목 */
  slotLabel: string;
  /** 그룹 정렬용 슬롯 시각(분). 없으면 Infinity(맨 뒤) */
  slotSort: number;
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

function labelToMinutes(label: string): number | null {
  if (label === 'after_medication') return 0;
  const match = label.match(/^(\d+)min_after$/);
  if (match) return parseInt(match[1], 10);
  // 2hour_after 처럼 시간 단위 라벨 호환
  const hourMatch = label.match(/^(\d+)hour_after$/);
  if (hourMatch) return parseInt(hourMatch[1], 10) * 60;
  return null;
}

// 약효추적 라벨 → 디지털 바이오마커 측정 시점(med_phase) 매핑.
// 30분 → '30m', 2시간(120분) → '2h'. 그 외(직후·기타)는 null(권유 안 함).
function labelToMedPhase(label: string | null | undefined): '30m' | '2h' | null {
  if (!label) return null;
  const min = labelToMinutes(label);
  if (min === 30) return '30m';
  if (min === 120) return '2h';
  return null;
}



const PERIOD_COLOR: Record<string, string> = {
  '아침': '#FF8A65',
  '점심': '#4CAF50',
  '저녁': '#1565C0',
  '취침': '#7C4DFF',
};

const PERIOD_ICON: Record<string, string> = {
  '아침': '🌅',
  '점심': '☀️',
  '저녁': '🌙',
  '취침': '💤',
};

// 배지 배경: 섹션 색상의 연한 버전
const PERIOD_BADGE_BG: Record<string, string> = {
  '아침': 'rgba(255,138,101,0.15)',
  '점심': 'rgba(76,175,80,0.15)',
  '저녁': 'rgba(21,101,192,0.15)',
  '취침': 'rgba(124,77,255,0.15)',
};
// 배지 텍스트: 섹션 색상보다 진한 버전
const PERIOD_BADGE_TEXT: Record<string, string> = {
  '아침': '#BF360C',
  '점심': '#1B5E20',
  '저녁': '#0D47A1',
  '취침': '#4527A0',
};

// KST(UTC+9) 기준 날짜 문자열 반환 — UTC 사용 시 오후 11시 이후 날짜 오류 방지
function toLocalDateString(date: Date): string {
  const kstOffset = 9 * 60 * 60 * 1000;
  const kst = new Date(date.getTime() + kstOffset);
  return kst.toISOString().slice(0, 10);
}

// 오늘(KST) 가장 최근 med_log 직접 조회 — AsyncStorage stale 데이터 의존 제거
async function fetchTodayLastMedLog(
  patientId: string
): Promise<{ taken_at: string; meal_time: string | null; dose_slot_id: string | null; id: string | null } | null> {
  try {
    const kstOffset = 9 * 60 * 60 * 1000;
    const nowKst = new Date(Date.now() + kstOffset);
    const todayKstStart = new Date(
      nowKst.getUTCFullYear(),
      nowKst.getUTCMonth(),
      nowKst.getUTCDate(),
      0,
      0,
      0
    );
    // KST 0시 → UTC ISO
    const startUtcIso = new Date(todayKstStart.getTime() - kstOffset).toISOString();

    const { data, error } = await supabase
      .from('med_logs')
      .select('taken_at, meal_time, dose_slot_id, id')
      .eq('patient_id', patientId)
      .gte('taken_at', startUtcIso)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return {
      taken_at: (data as any).taken_at,
      meal_time: (data as any).meal_time ?? null,
      dose_slot_id: (data as any).dose_slot_id ?? null,
      id: (data as any).id ?? null,
    };
  } catch {
    return null;
  }
}

// 인터벌(분) → trigger_time_label 변환 (전역)
function intervalMinutesToLabel(min: number): string {
  if (min === 0) return 'after_medication';
  if (min === 120) return '2hour_after';
  return `${min}min_after`;
}

// 인터벌(분) → 사용자 표시 텍스트 (예: 0→'직후', 60→'1시간 후')
function intervalMinutesToText(min: number): string {
  if (min === 0) return '직후';
  if (min < 60) return `${min}분 후`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`;
}

// 경과/잔여 분 → 자연스러운 한국어 표현
function formatDurationKo(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}시간` : `${h}시간 ${rem}분`;
}

export function BodyStateScreen() {
  const { user, signOut } = useAuth();
  const { todayLogs, saveBodyState, fetchVideoLogs, getBodyStateLogs, refresh } = useBodyState();
  const [showFlow, setShowFlow] = useState(false);
  // 탭 버튼 누를 때 항상 맨 위로
  const scrollRef = useRef<ScrollView>(null);
  useScrollTopOnTabPress(scrollRef);
  // 수정 중인 기록(있으면 입력 팝업이 수정 모드로 열림). null이면 신규 입력.
  const [editTarget, setEditTarget] = useState<BodyRecord | null>(null);
  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [videoLogs, setVideoLogs] = useState<any[]>([]);
  const [dateLogs, setDateLogs] = useState<any[]>([]);
  const [pendingTriggerLabel, setPendingTriggerLabel] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0);
  const [showTriggerSelect, setShowTriggerSelect] = useState(false);
  const [triggerMedTime, setTriggerMedTime] = useState<Date | null>(null);
  const [triggerModalSelected, setTriggerModalSelected] = useState<string | null>(null);
  const [pendingTriggeredBy, setPendingTriggeredBy] = useState<'notification' | 'manual'>('manual');
  const [showPreRecordInfo, setShowPreRecordInfo] = useState(false);
  const [preRecordMessage, setPreRecordMessage] = useState('');
  const [showNextNotifModal, setShowNextNotifModal] = useState(false);
  const [nextNotifInfo, setNextNotifInfo] = useState<NextNotifInfo | null>(null);
  const [pendingMealTime, setPendingMealTime] = useState<string | null>(null);
  // 약 복용 모델 7단계: 슬롯별 통계용 dose_slot_id + 복용 1:1 매칭용 med_log_id.
  // 알림 진입(또는 수동 입력 시 보강)에서 설정 → 저장 시 on_off_logs.dose_slot_id / med_log_id로 기록.
  const [pendingDoseSlotId, setPendingDoseSlotId] = useState<string | null>(null);
  const [pendingMedLogId, setPendingMedLogId] = useState<string | null>(null);
  const [hasBedtimeMedication, setHasBedtimeMedication] = useState(false);
  const [bedtimeRefreshTick, setBedtimeRefreshTick] = useState(0);
  // 컨디션 측정 권유 모달 — NextNotifModal 닫힘 후 표시
  const [showMeasureInvite, setShowMeasureInvite] = useState(false);
  const [measureInvitePhase, setMeasureInvitePhase] = useState<MeasurementMedPhase | null>(null);
  // 권유 모달이 NextNotifModal과 겹치지 않도록, NextNotif 닫힘 시 pending 상태에서 인계
  const [pendingMeasureInvitePhase, setPendingMeasureInvitePhase] = useState<MeasurementMedPhase | null>(null);
  // 환자 약 중 레보도파 계열 존재 여부 — 비레보도파 단독 환자는 권유 안 함
  const [hasLevodopaMed, setHasLevodopaMed] = useState(false);
  // 표시용 dose_slots — 기록 슬롯 명칭(slotTitle) 조회/그룹핑용 (display 전용, 기록 로직 무관)
  const [displaySlots, setDisplaySlots] = useState<DoseSlot[]>([]);
  const hasBedtimeLoadedRef = useRef(false);
  const pendingFlowArgsRef = useRef<{ label: string; medTime: Date | null; mealTimeKey: string | null; doseSlotId?: string | null; medLogId?: string | null } | null>(null);
  // 회귀 수정: route.params triggerTs dedupe — 같은 ts는 한 번만 처리
  // (다른 탭 갔다 복귀 시 stale params로 인한 중복 발화 방지)
  const processedTriggerTsRef = useRef<number | null>(null);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationBadge();
  const { medNotifs } = useSettings();
  const dialog = useDialog();

  // minutes → trigger_time_label 변환
  const minutesToLabel = (minutes: number): string => {
    if (minutes === 0) return 'after_medication';
    if (minutes === 30) return '30min_after';
    if (minutes === 120) return '2hour_after';
    return `${minutes}min_after`;
  };

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

  // 포커스 시 stale 팝업 args 초기화 — 알림 useFocusEffect보다 반드시 먼저 실행되어야 함
  useFocusEffect(
    useCallback(() => {
      hasBedtimeLoadedRef.current = false;
      pendingFlowArgsRef.current = null;
    }, [])
  );

  // 알림 탭 진입 시 trigger_time_label 자동 설정
  useFocusEffect(
    React.useCallback(() => {
      const triggerMinutes = route.params?.triggerMinutes;
      if (triggerMinutes != null) {
        // 회귀 수정: triggerTs dedupe — 같은 ts는 두 번 처리하지 않음
        // (탭 전환 후 복귀 시 stale params로 useFocusEffect가 재발화해 Alert 반복되는 문제)
        const triggerTs = (route.params as any)?.triggerTs ?? null;
        if (triggerTs != null && processedTriggerTsRef.current === triggerTs) {
          return;
        }
        if (triggerTs != null) {
          processedTriggerTsRef.current = triggerTs;
        }

        const label = minutesToLabel(triggerMinutes);
        // 알림 데이터에 meal_time이 있으면 우선 사용, 없으면 AsyncStorage 조회
        const paramMealTime = (route.params as any)?.triggerMealTime ?? null;
        // 약 복용 모델 7단계: 푸시가 실어 보낸 슬롯/복용 식별자(없으면 null·미이관/구 데이터)
        const paramDoseSlotId = (route.params as any)?.triggerDoseSlotId ?? null;
        const paramMedLogId = (route.params as any)?.triggerMedLogId ?? null;
        setPendingTriggeredBy('notification');
        setPendingTriggerLabel(label);
        if (!showFlow) {
          if (paramMealTime) {
            openFlowOrPend(label, null, paramMealTime, paramDoseSlotId, paramMedLogId);
          } else if (patientId) {
            fetchTodayLastMedLog(patientId)
              .then((parsed) => {
                if (!parsed) { openFlowOrPend(label, null, null, paramDoseSlotId, paramMedLogId); return; }
                const medTime = parsed.taken_at ? new Date(parsed.taken_at) : null;
                // 알림이 식별자를 안 실었을 때만 마지막 복용 기록에서 보강.
                openFlowOrPend(
                  label,
                  medTime,
                  parsed.meal_time,
                  paramDoseSlotId ?? parsed.dose_slot_id ?? null,
                  paramMedLogId ?? parsed.id ?? null,
                );
              })
              .catch(() => openFlowOrPend(label, null, null, paramDoseSlotId, paramMedLogId));
          } else {
            openFlowOrPend(label, null, null, paramDoseSlotId, paramMedLogId);
          }
        }

        // 처리 직후 route.params 비움 — 다음 포커스 진입 시 stale 재발화 방지
        // (handleSaveRecord 성공 시에만 비우는 기존 로직은 사용자가 취소/다른 탭 이동 시 stale 잔존)
        navigation.setParams({ triggerMinutes: null, triggerMealTime: null, triggerDoseSlotId: null, triggerMedLogId: null, triggerTs: null });
      }
    }, [route.params?.triggerMinutes, (route.params as any)?.triggerMealTime, (route.params as any)?.triggerDoseSlotId, (route.params as any)?.triggerMedLogId, (route.params as any)?.triggerTs, patientId])
  );

  // 약효 추적 알림 탭 → 몸상태 팝업 열기 (AsyncStorage 방식 — 콜드스타트 대응)
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('pendingBodyStateNotif').then(async (value) => {
        if (!value) return;
        // removeItem await 보장: stale 재트리거 방지
        await AsyncStorage.removeItem('pendingBodyStateNotif');
        try {
          const parsed = JSON.parse(value);
          // TTL 5분 초과 → stale 폐기
          if (parsed?.ts && Date.now() - parsed.ts > 5 * 60 * 1000) return;
          const { triggerMinutes, triggerMealTime, triggerDoseSlotId, triggerMedLogId } = parsed;
          if (triggerMinutes == null) return;
          // 약 복용 모델 7단계: AsyncStorage pending에 실린 슬롯/복용 식별자(없으면 null)
          const psDoseSlotId = triggerDoseSlotId ?? null;
          const psMedLogId = triggerMedLogId ?? null;
          const label = minutesToLabel(triggerMinutes);
          setPendingTriggeredBy('notification');
          setPendingTriggerLabel(label);
          if (triggerMealTime) {
            openFlowOrPend(label, null, triggerMealTime, psDoseSlotId, psMedLogId);
          } else if (patientId) {
            fetchTodayLastMedLog(patientId)
              .then((parsed) => {
                if (!parsed) { openFlowOrPend(label, null, null, psDoseSlotId, psMedLogId); return; }
                const medTime = parsed.taken_at ? new Date(parsed.taken_at) : null;
                openFlowOrPend(
                  label,
                  medTime,
                  parsed.meal_time,
                  psDoseSlotId ?? parsed.dose_slot_id ?? null,
                  psMedLogId ?? parsed.id ?? null,
                );
              })
              .catch(() => openFlowOrPend(label, null, null, psDoseSlotId, psMedLogId));
          } else {
            openFlowOrPend(label, null, null, psDoseSlotId, psMedLogId);
          }
        } catch {}
      });
    }, [patientId])
  );

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

  const [patientName, setPatientName] = useState('환자');
  const [patientId, setPatientId] = useState<string | null>(null);

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
        const pid = (data as any)?.user_id;
        if (pid) setPatientId(pid);
      });
  }, [user]);

  // 몸상태 기록 실시간 동기화 — 환자↔보호자 즉시 반영
  // 지정 환자의 on_off_logs가 추가/삭제/수정되면 오늘 기록 + 과거기록 모두 갱신
  useRecordRealtime('on_off_logs', patientId, () => {
    if (isToday) {
      refresh();
    } else {
      loadDateLogs();
    }
    setRecordsRefreshKey(k => k + 1);
  });

  // 포커스 시 취침약 재조회 트리거 (patientId 확보된 경우만)
  useFocusEffect(
    useCallback(() => {
      if (patientId) setBedtimeRefreshTick(t => t + 1);
    }, [patientId])
  );

  // 취침약 여부 실제 조회 — useEffect로 patientId 확보 후 실행 보장
  useEffect(() => {
    if (!patientId) return;
    hasBedtimeLoadedRef.current = false;
    supabase
      .from('medications')
      .select('id')
      .eq('patient_id', patientId)
      .contains('meal_times', ['bedtime'])
      .limit(1)
      .then(({ data }) => {
        setHasBedtimeMedication(!!(data && data.length > 0));
        hasBedtimeLoadedRef.current = true;
        if (pendingFlowArgsRef.current) {
          const args = pendingFlowArgsRef.current;
          pendingFlowArgsRef.current = null;
          openFlowLatestRef.current(args.label, args.medTime, args.mealTimeKey, args.doseSlotId ?? null, args.medLogId ?? null);
        }
      });
  }, [patientId, bedtimeRefreshTick]);

  // 환자 medications에 레보도파 계열이 있는지 1회 조회 — 측정 권유 노출 게이트
  // 환자 본인일 때만 (보호자는 권유 자체가 차단되므로 조회 불필요)
  useEffect(() => {
    if (!patientId || userRole !== 'patient') return;
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('medications')
          .select('name')
          .eq('patient_id', patientId);
        if (error || !data || !alive) return;
        const meds = data.map((m: any) => ({
          name: m.name ?? '',
        }));
        const { activeClasses } = buildRecommendedMedNotifs(meds);
        if (alive) setHasLevodopaMed(activeClasses.length > 0);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [patientId, userRole]);

  // 표시용 dose_slots 로드 — 기록 슬롯 명칭(slotTitle)·그룹핑에만 사용(display 전용)
  useEffect(() => {
    if (!patientId) {
      setDisplaySlots([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('meal_schedules')
          .eq('id', patientId)
          .single();
        const doseSlots = await fetchPatientDoseSlots(patientId);
        const resolved = resolveDisplaySlots(
          doseSlots,
          userData?.meal_schedules as Record<string, string> | null | undefined
        );
        if (alive) setDisplaySlots(resolved);
      } catch {
        if (alive) setDisplaySlots([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId, recordsRefreshKey]);

  // 슬롯 표시명(slotTitle) 조회맵 — byId[dose_slot_id] / byLegacyKey[meal_time]
  const slotTitleMaps = React.useMemo(
    () =>
      buildSlotTitleMaps(
        displaySlots.map((s) => ({ id: s.id, label: s.label, legacyKey: s.legacyKey, time: s.time }))
      ),
    [displaySlots]
  );

  // 표시할 로그: 오늘이면 todayLogs, 다른 날이면 dateLogs
  const activeLogs = isToday ? todayLogs : dateLogs;

  // trigger_time_label → 표시 텍스트 (공용 유틸 위임)
  const getTriggerLabel = (label: string): string => triggerLabelToText(label);

  // 같은 시간대 배지가 오늘 이미 있으면 확인 후 팝업 오픈
  // mealTimeKey: 실제 med_logs.meal_time ('morning'|'lunch'|'dinner'|'bedtime')
  const openFlowWithDuplicateCheck = (
    labelKey: string,
    medTime: Date | null,
    mealTimeKey: string | null,
    doseSlotId: string | null = null,
    medLogId: string | null = null,
  ) => {
    setPendingMealTime(mealTimeKey);
    // 슬롯/복용 식별자 보강 — 알림 진입 시 전달됨. 없으면 null(미이관/수동·통계 미반영).
    setPendingDoseSlotId(doseSlotId);
    setPendingMedLogId(medLogId);
    // mealTimeKey가 있는 경우 — label + meal_time 모두 일치할 때만 중복으로 처리
    // (예: 점심약 복용 직후 기록이 있어도 저녁약 복용 직후 기록은 허용)
    const hasDuplicate = activeLogs.some((log: any) => {
      if (log.trigger_time_label !== labelKey) return false;
      // mealTimeKey가 지정된 경우 medication_meal_time도 일치해야 중복
      if (mealTimeKey && log.medication_meal_time && log.medication_meal_time !== mealTimeKey) return false;
      return true;
    });
    if (hasDuplicate) {
      // 회귀 수정: Alert 대신 TriggerSelectModal로 fallback (handleOpenBodyState와 일관)
      // 사용자가 다른 시간대 trigger를 선택하거나 자연스럽게 닫을 수 있게 함.
      // 기존 Alert은 useFocusEffect 재발화 시 매번 떠서 회귀 버그의 원인이 됨.
      setTriggerMedTime(medTime);
      setTriggerModalSelected(labelKey);
      setShowTriggerSelect(true);
    } else {
      setShowFlow(true);
    }
  };

  // openFlowWithDuplicateCheck 최신 참조 유지 (비동기 콜백에서 stale closure 방지)
  const openFlowLatestRef = useRef(openFlowWithDuplicateCheck);
  useEffect(() => { openFlowLatestRef.current = openFlowWithDuplicateCheck; });

  // TriggerSelectModal '기록하기' 확정 처리.
  // 버그 수정: 기존엔 onConfirm → openFlowOrPend → openFlowWithDuplicateCheck로 되돌아가
  // 같은 (중복) 시간대가 그대로 재검출되면 TriggerSelectModal이 무한 재오픈 →
  // "기록하기 눌러도 반응 없음"으로 보임. 사용자가 모달에서 시간대를 명시적으로 선택한
  // 시점부터는 중복 재검사를 하지 않고, 중복이면 덮어쓰기 모드로 바로 팝업을 연다.
  const handleTriggerSelectConfirm = (labelKey: string, medTime: Date | null) => {
    setShowTriggerSelect(false);
    setPendingTriggerLabel(labelKey);
    // 선택한 시간대가 이미 오늘 기록되어 있으면 → 덮어쓰기 모드로 진입
    const existing = activeLogs.find((log: any) => log.trigger_time_label === labelKey);
    overrideLogIdRef.current = existing ? ((existing as any).id ?? null) : null;
    // pendingMealTime은 openFlowWithDuplicateCheck 진입 시 이미 설정됨(중복 검사 경유).
    // 중복 재검사 없이 바로 팝업 오픈.
    setShowFlow(true);
  };

  // hasBedtimeMedication 로드 완료 전 팝업 오픈 방지 헬퍼
  const openFlowOrPend = (
    label: string,
    medTime: Date | null,
    mealTimeKey: string | null,
    doseSlotId: string | null = null,
    medLogId: string | null = null,
  ) => {
    if (!hasBedtimeLoadedRef.current) {
      pendingFlowArgsRef.current = { label, medTime, mealTimeKey, doseSlotId, medLogId };
      return;
    }
    openFlowWithDuplicateCheck(label, medTime, mealTimeKey, doseSlotId, medLogId);
  };

  // 활성화된 medNotifs 인터벌 목록 (복용 직후 포함)
  const getEnabledIntervals = (): Array<{ minutes: number; labelKey: string; labelDisplay: string }> => {
    const result: Array<{ minutes: number; labelKey: string; labelDisplay: string }> = [
      { minutes: 0, labelKey: 'after_medication', labelDisplay: '복용 직후' },
    ];
    for (const notif of medNotifs) {
      if (notif.enabled && notif.minutes > 0) {
        const key = minutesToLabel(notif.minutes);
        result.push({ minutes: notif.minutes, labelKey: key, labelDisplay: getTriggerLabel(key) });
      }
    }
    return result;
  };

  // 덮어쓸 기존 on_off_logs.id (덮어쓰기 모드 시 저장 직전에 setOverrideLogId로 설정)
  const overrideLogIdRef = useRef<string | null>(null);

  // 버튼 탭 진입: 6개 케이스 처리 (사양 기반)
  // 1) 오늘 약 복용 기록 없음 → 차단
  // 2) ±20분 매칭 → 확인 팝업
  // 3) 동률 → 이전(작은) 인터벌 우선
  // 4/6) ±20분 벗어남 → 차단 + 다음 알림 안내
  // 5) 같은 (meal_time × interval) 기록 존재 → 덮어쓰기 확인
  const handleOpenBodyState = async () => {
    if (!patientId) return;
    setPendingTriggeredBy('manual');

    // 1. 오늘 가장 최근 med_log 조회
    const lastMedLog = await fetchTodayLastMedLog(patientId);

    // 케이스 1: 약 복용 기록 없음
    if (!lastMedLog || !lastMedLog.taken_at) {
      dialog.alert({
        title: '몸상태 기록 불가',
        message: '약 복용 기록이 있어야 몸상태 기록을 남길 수 있어요.\n\n약을 드신 후 다시 시도해 주세요.',
      });
      return;
    }

    // 2. 활성 인터벌 (분 단위 배열, 오름차순) — 복용 직후(0) 포함
    const intervalsRaw = getEnabledIntervals();
    const intervals = [...intervalsRaw]
      .map(iv => iv.minutes)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);

    if (intervals.length === 0) {
      dialog.alert({
        title: '몸상태 기록 불가',
        message: '약효 추적 시간대가 설정되어 있지 않아요.\n\n설정 화면에서 알림 시간대를 먼저 설정해 주세요.',
      });
      return;
    }

    const takenAt = new Date(lastMedLog.taken_at);
    const mealTime = lastMedLog.meal_time;
    // 수동 입력은 triggered_by='manual'이라 통계 미반영이지만 슬롯/복용 식별자는 채워둠.
    const manualDoseSlotId = lastMedLog.dose_slot_id ?? null;
    const manualMedLogId = lastMedLog.id ?? null;
    const now = new Date();
    const elapsedMin = (now.getTime() - takenAt.getTime()) / 60000;

    // 3. 가장 가까운 인터벌 매칭 (±20분, 동률 시 작은 인터벌 우선)
    //    intervals를 오름차순으로 순회하며 더 작은 diff일 때만 갱신
    //    (동률은 갱신 안 함 → 먼저 들어온 작은 값이 유지됨)
    let closestInterval: number | null = null;
    let closestDiff = Infinity;
    for (const iv of intervals) {
      const diff = Math.abs(elapsedMin - iv);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestInterval = iv;
      }
    }

    // 케이스 4 & 6: ±20분 벗어남
    if (closestInterval === null || closestDiff > 20) {
      // 다음 도래할 인터벌 시각 계산
      let nextAt: Date | null = null;
      for (const iv of intervals) {
        const t = new Date(takenAt.getTime() + iv * 60000);
        if (t.getTime() - now.getTime() > 20 * 60 * 1000 * -1 && t.getTime() > now.getTime()) {
          // 미래 시점만
          nextAt = t;
          break;
        }
      }
      if (!nextAt) {
        dialog.alert({
          title: '몸상태 기록 불가',
          message: '약효 추적 가능 시간 범위를 벗어났어요.\n\n다음 약 복용 후 다시 기록해 주세요.',
        });
      } else {
        const remainMin = (nextAt.getTime() - now.getTime()) / 60000;
        dialog.alert({
          title: '몸상태 기록 불가',
          message: `약효 추적 가능 시간 범위를 벗어났어요.\n\n다음 알림 시간까지 ${formatDurationKo(remainMin)} 남았어요.\n그때부터 기록 가능해요.`,
        });
      }
      return;
    }

    // 4. 같은 (meal_time × interval) 이미 기록되어 있는지 확인
    const labelKey = intervalMinutesToLabel(closestInterval);
    const existing = todayLogs.find((log: any) => {
      if (log.trigger_time_label !== labelKey) return false;
      // mealTime이 있으면 동일해야 중복으로 처리 (없으면 label만으로 판단)
      if (mealTime && log.medication_meal_time && log.medication_meal_time !== mealTime) return false;
      if (mealTime && !log.medication_meal_time) return false;
      return true;
    });

    const intervalText = intervalMinutesToText(closestInterval);
    const mealLabel = mealTime ? mealTimeToKorean(mealTime) : '';

    if (existing) {
      // 케이스 5: 이미 기록됨 → 덮어쓰기 확인
      // 오타 수정: mealLabel이 이미 "저녁약" 형태이므로 추가 "약" 붙이지 않음
      const targetLabel = mealLabel ? `${mealLabel} 복용 ${intervalText}` : `복용 ${intervalText}`;
      const confirmed = await dialog.confirm({
        title: '이미 기록되어 있어요',
        message: `${targetLabel}는 이미 기록되어 있어요.\n덮어쓸까요?`,
        confirmText: '덮어쓰기',
      });
      if (confirmed) {
        overrideLogIdRef.current = (existing as any).id ?? null;
        setPendingTriggerLabel(labelKey);
        setPendingMealTime(mealTime ?? null);
        openFlowOrPend(labelKey, takenAt, mealTime ?? null, manualDoseSlotId, manualMedLogId);
      }
      return;
    }

    // 케이스 2: 정상 매칭 → 확인 Alert 없이 즉시 진입
    // (사용자가 ±20분 이내 약효추적 시간대에 들어와있으면 별도 확인 불필요)
    overrideLogIdRef.current = null;
    setPendingTriggerLabel(labelKey);
    setPendingMealTime(mealTime ?? null);
    openFlowOrPend(labelKey, takenAt, mealTime ?? null, manualDoseSlotId, manualMedLogId);
  };

  // DB 로그 → BodyRecord 변환
  const records: BodyRecord[] = activeLogs.map((log: any) => {
    const mealTimeKo = log.medication_meal_time ? mealTimeToPeriod(log.medication_meal_time) : null;
    // 아이콘/색용 시간대 키(기존 동작 보존)
    const period = mealTimeKo ?? getPeriod(log.logged_at);
    // 표시용 슬롯 명칭(slotTitle): byId[dose_slot_id] 우선 → byLegacyKey[meal_time] → legacy 폴백
    const slotLabel =
      (log.dose_slot_id && slotTitleMaps.byId[log.dose_slot_id]) ||
      (log.medication_meal_time && slotTitleMaps.byLegacyKey[log.medication_meal_time]) ||
      period;
    // 그룹 정렬용 시각: 해당 슬롯의 time(없으면 기록 시각)
    const matchedSlot =
      (log.dose_slot_id && displaySlots.find((s) => s.id === log.dose_slot_id)) ||
      (log.medication_meal_time &&
        displaySlots.find((s) => s.legacyKey === log.medication_meal_time)) ||
      null;
    const slotSort = matchedSlot
      ? slotSortValue(matchedSlot.time)
      : new Date(log.logged_at).getHours() * 60 + new Date(log.logged_at).getMinutes();
    return {
      id: log.id,
      time: formatTime(log.logged_at),
      period,
      slotLabel,
      slotSort,
      trigger: (log.trigger_time_label && getTriggerLabel(log.trigger_time_label))
        || (log.triggered_by === 'notification' ? '알림' : '직접 입력'),
      triggeredBy: log.triggered_by ?? 'manual',
      bodyScore: log.body_state ?? 3,
      moodScore: log.mood ?? 3,
      sleepScore: log.sleep_quality ?? undefined,
      constipation: log.constipation ?? undefined,
    };
  });

  // 기록 취소(삭제) 버튼 노출 조건:
  //   - 환자 본인, 또는
  //   - 함께 거주 보호자(residence_type === 'together')
  //   그 외(따로 거주 보호자 등)는 숨김
  const canCancelRecord =
    user?.role === 'patient' ||
    (user?.role === 'caregiver' && user?.residence_type === 'together');

  // 기록 한 건 취소(삭제) — RLS 우회 + 권한 자체검증 RPC 사용(직접 delete 금지)
  const handleCancelRecord = async (onOffLogId: string) => {
    const ok = await dialog.confirm({
      title: '이 기록을 취소할까요?',
      message: '취소하면 기록이 삭제되고 되돌릴 수 없어요.',
      confirmText: '취소하기',
      cancelText: '닫기',
      destructive: true,
    });
    if (!ok) return;

    const { error } = await supabase.rpc('cancel_patient_record', {
      p_table: 'on_off_logs',
      p_record_id: onOffLogId,
    });

    if (error) {
      console.error('[BodyStateScreen] handleCancelRecord 오류:', error);
      dialog.alert({ title: '취소 실패', message: '기록을 취소하지 못했어요.\n다시 시도해 주세요.' });
      return;
    }

    // 성공 → 오늘/선택 날짜 기록 리스트 갱신
    if (isToday) {
      await refresh();
    } else {
      await loadDateLogs();
    }
  };

  // 기록 수정 — 입력 팝업을 수정 모드로 열기(각 단계에 기존 점수 미리 선택).
  const handleEditRecord = (record: BodyRecord) => {
    setEditTarget(record);
    setShowFlow(true);
  };

  // 수정 저장 — 새 기록 생성 대신 해당 on_off_logs 행을 update(권한 게이트 RPC).
  const handleSaveEdit = async (
    target: BodyRecord,
    record: { bodyScore: number; moodScore: number; sleepScore?: number; constipation?: boolean },
  ) => {
    setShowFlow(false);
    setEditTarget(null);

    const { error } = await supabase.rpc('update_patient_onoff_record', {
      p_record_id: target.id,
      p_body_state: record.bodyScore,
      p_mood: record.moodScore,
      p_sleep_quality: record.sleepScore ?? null,
      p_constipation: record.constipation ?? null,
    });

    if (error) {
      console.error('[BodyStateScreen] handleSaveEdit 오류:', error);
      dialog.alert({ title: '수정 실패', message: '기록을 수정하지 못했어요.\n다시 시도해 주세요.' });
      return;
    }

    setHistoryRefreshKey(k => k + 1);
    if (isToday) {
      await refresh();
    } else {
      await loadDateLogs();
    }
  };

  const handleSaveRecord = async (record: { bodyScore: number; moodScore: number; sleepScore?: number; constipation?: boolean }) => {
    // 수정 모드: 새 기록 생성 대신 기존 기록 update 후 종료.
    if (editTarget) {
      await handleSaveEdit(editTarget, record);
      return;
    }

    // pendingMealTime은 handleOpenBodyState 또는 알림 진입 흐름에서 이미 설정됨
    // (medication_meal_time DB 컬럼에 저장될 값)
    const medicationMealTime: string | undefined = pendingMealTime ?? undefined;

    // 1. UI 즉시 닫기 (저장 완료를 기다리지 않음)
    const savedLabel = pendingTriggerLabel; // state 초기화 전 캡처
    const savedTriggeredBy = pendingTriggeredBy;
    const savedMealTime = medicationMealTime;
    // 약 복용 모델 7단계: 슬롯/복용 식별자 캡처(state 초기화 전) → on_off_logs.dose_slot_id / med_log_id
    const savedDoseSlotId = pendingDoseSlotId ?? undefined;
    const savedMedLogId = pendingMedLogId ?? undefined;
    const savedPatientId = patientId; // 클로저 캡처 — 비동기 처리 중 state 변경 방지
    const savedOverrideLogId = overrideLogIdRef.current; // 덮어쓰기 모드 캡처
    overrideLogIdRef.current = null;
    setShowFlow(false);
    setPendingTriggerLabel(null);
    setPendingTriggeredBy('manual');
    setPendingDoseSlotId(null);
    setPendingMedLogId(null);
    setHistoryRefreshKey(k => k + 1);
    if (route.params?.triggerMinutes != null) {
      navigation.setParams({ triggerMinutes: null });
    }

    // 2. 저장 + 큐 삭제 + 다음 알림 팝업 — await 체인으로 순서 보장
    (async () => {
      // 2-1. 저장
      const success = await saveBodyState({
        body_state: record.bodyScore,
        mood: record.moodScore,
        sleep_quality: record.sleepScore,
        constipation: record.constipation,
        trigger_time_label: savedLabel ?? undefined,
        medication_meal_time: savedMealTime,
        dose_slot_id: savedDoseSlotId,
        med_log_id: savedMedLogId,
      }, savedTriggeredBy);

      if (!success) {
        dialog.alert({ title: '저장 실패', message: '몸상태 기록 저장에 실패했어요. 다시 시도해주세요.' });
        return;
      }

      // 2-1b. 덮어쓰기 모드: 기존 로그 삭제 (새 로그가 성공적으로 저장된 경우에만)
      if (savedOverrideLogId) {
        try {
          await supabase.from('on_off_logs').delete().eq('id', savedOverrideLogId);
          // 화면 갱신
          await refresh();
        } catch (overrideErr) {
          console.error('[handleSaveRecord] 기존 로그 삭제 실패:', overrideErr);
        }
      }

      // 2-2. 큐 삭제 (await — fetchNextNotifMessage보다 반드시 먼저 완료되어야 함)
      // SELECT+DELETE를 단일 DELETE+select로 합쳐 네트워크 왕복 1회 절감
      const intervalMin = savedLabel ? labelToMinutes(savedLabel) : null;
      if (intervalMin != null && savedPatientId) {
        try {
          let query = supabase
            .from('effect_tracking_queue')
            .delete()
            .eq('patient_id', savedPatientId)
            .eq('interval_minutes', intervalMin)
            .is('sent_at', null);
          if (savedMealTime) query = (query as any).eq('meal_time', savedMealTime);
          const { data: deletedItems } = await (query as any).select();
          if (deletedItems && deletedItems.length > 0) {
            // 슬롯 표시명: byId[dose_slot_id] 우선 → byLegacyKey[meal_time] → legacy period 폴백
            let slotName = getPeriod(new Date().toISOString());
            const mapped =
              (savedDoseSlotId && slotTitleMaps.byId[savedDoseSlotId]) ||
              (savedMealTime && slotTitleMaps.byLegacyKey[savedMealTime]) ||
              (savedMealTime ? mealTimeToPeriod(savedMealTime) : null);
            if (mapped) slotName = mapped;
            const delta = triggerLabelToText(savedLabel!);
            setPreRecordMessage(
              `${slotName} 약 복용 ${delta} 후 몸상태 기록을 미리 남기셨어요.\n\n사전에 설정된 알림은 보내지 않을게요.`
            );
            setShowPreRecordInfo(true);
          }
        } catch (queueErr) {
          console.error('[handleSaveRecord] 큐 삭제 오류:', queueErr);
        }
      }

      // 2-3. 큐 삭제 완료 후 다음 예정 알림 조회 → 팝업 표시
      let nextInfoShown = false;
      if (savedPatientId) {
        const info = await fetchNextNotifMessage(savedPatientId);
        if (info) {
          setNextNotifInfo(info);
          setShowNextNotifModal(true);
          nextInfoShown = true;
        }
      }

      // 2-4. 컨디션 측정 권유 — 조건 충족 시 NextNotifModal 닫힘 후 표시
      //   조건: 환자 본인 + 약효추적 알림 진입(notification) + 30m/2h 시점 + 레보도파 보유
      //   비노출: 보호자 / 게스트 / 비레보도파 단독 / 자율 입력
      const phase = labelToMedPhase(savedLabel);
      if (
        MEASUREMENT_FEATURE_ENABLED &&
        phase &&
        userRole === 'patient' &&
        savedTriggeredBy === 'notification' &&
        hasLevodopaMed
      ) {
        // 다음 알림 모달이 떠있으면 닫힘 후 표시, 없으면 즉시 표시
        if (nextInfoShown) {
          setPendingMeasureInvitePhase(phase);
        } else {
          setMeasureInvitePhase(phase);
          setShowMeasureInvite(true);
        }
      }
    })().catch(console.error);
  };

  // 컨디션 측정 권유 — 동의 게이트 통과 후 TapGame으로 직진입(Phase 4 결정)
  const handleMeasureInviteAccept = async () => {
    const phase = measureInvitePhase ?? 'self_initiated';
    setShowMeasureInvite(false);
    setMeasureInvitePhase(null);
    // 동의 화면 게이트 — 미동의면 ConsentScreen으로 이동되고 false 반환
    const ok = await ensureMeasurementConsent(navigation);
    if (!ok) return;
    navigation.navigate('TapGame', { medPhase: phase, medIntakeId: null });
  };

  const handleMeasureInviteLater = () => {
    setShowMeasureInvite(false);
    setMeasureInvitePhase(null);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title="파킨온"
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
        <TouchableOpacity style={styles.calBtn} onPress={() => setShowDatePicker(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
          
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={[
              styles.mainButton,
              (userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday) && styles.mainButtonDisabled,
            ]}
            disabled={userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday}
            onPress={async () => {
              if (await ensureNotGuest(user, dialog, { signOut })) return;
              if (userRole === 'caregiver_same') {
                setShowCaregiverConfirm(true);
              } else {
                handleOpenBodyState();
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.mainButtonInner}>
              <Ionicons name="happy" size={40} color={Colors.white} />
              <Text style={styles.mainButtonText}>몸상태·기분상태 기록하기</Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>환자와 연동 후 기록할 수 있어요</Text>
          )}
          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>같이 계신 경우에만 대신 입력할 수 있어요</Text>
          )}
          {!isToday && userRole !== 'caregiver_separate' && userRole !== 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>오늘 날짜에서만 기록할 수 있어요</Text>
          )}

          {/* 컨디션 측정 진입점 (환자 본인만 노출) — 영상 두 항목 바로 위 */}
          {MEASUREMENT_FEATURE_ENABLED && userRole === 'patient' && (
            <View style={styles.videoButtonRow}>
              <TouchableOpacity
                style={styles.outlineButton}
                onPress={async () => {
                  if (await ensureNotGuest(user, dialog, { signOut })) return;
                  navigateTo('MeasurementMenu');
                }}
                activeOpacity={0.85}
              >
                <View style={styles.outlineButtonInner}>
                  <Text style={styles.outlineButtonEmoji}>🖐️</Text>
                  <Text style={styles.outlineButtonText}>컨디션 측정하기</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.outlineButton}
                onPress={async () => {
                  if (await ensureNotGuest(user, dialog, { signOut })) return;
                  navigateTo('MeasurementRecords');
                }}
                activeOpacity={0.85}
              >
                <View style={styles.outlineButtonInner}>
                  <Text style={styles.outlineButtonEmoji}>📊</Text>
                  <Text style={styles.outlineButtonText}>측정 기록 보기</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.videoButtonRow}>
            <TouchableOpacity
              style={[styles.outlineButton, !isToday && styles.outlineButtonDisabled]}
              onPress={async () => {
                if (!isToday) return;
                if (await ensureNotGuest(user, dialog, { signOut })) return;
                navigation.navigate('VideoRecord');
              }}
              activeOpacity={isToday ? 0.85 : 1}
              disabled={!isToday}
            >
              <View style={styles.outlineButtonInner}>
                <Ionicons name="film-outline" size={24} color={isToday ? Colors.primary : '#BDBDBD'} />
                <Text style={[styles.outlineButtonText, !isToday && styles.outlineButtonTextDisabled]}>영상 기록하기</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => navigation.navigate('VideoList')}
              activeOpacity={0.85}
            >
              <View style={styles.outlineButtonInner}>
                <Ionicons name="albums-outline" size={24} color={Colors.primary} />
                <Text style={styles.outlineButtonText}>저장 영상 보기</Text>
              </View>
            </TouchableOpacity>
          </View>

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
            (() => {
              // records 에 등장하는 distinct slotLabel 을 슬롯 시각 순(내림차순: 취침→아침)으로 그룹핑
              const order: string[] = [];
              const sortOf: Record<string, number> = {};
              records.forEach(r => {
                if (!(r.slotLabel in sortOf)) {
                  sortOf[r.slotLabel] = r.slotSort;
                  order.push(r.slotLabel);
                }
              });
              order.sort((a, b) => sortOf[b] - sortOf[a]);
              return order.map(slotLabel => {
                const groupRecords = records.filter(r => r.slotLabel === slotLabel);
                if (groupRecords.length === 0) return null;
                // 아이콘/색은 기존 시간대 키(period) 기준 유지
                const period = groupRecords[0].period;
                return (
                  <MealSectionCard
                    key={slotLabel}
                    period={period}
                    displayTitle={slotLabel}
                    records={groupRecords}
                    canCancel={canCancelRecord}
                    onCancel={handleCancelRecord}
                    onEdit={handleEditRecord}
                  />
                );
              });
            })()
          )}
        </View>

        {/* 과거 기록 보기 타임라인 */}
        <HistoryTimeline type="bodystate" patientId={patientId} refreshKey={historyRefreshKey + recordsRefreshKey} />
      </ScrollView>

      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={patientName}
        onConfirm={() => { setShowCaregiverConfirm(false); handleOpenBodyState(); }}
        onCancel={() => setShowCaregiverConfirm(false)}
      />
      <BodyStatePopupFlow
        visible={showFlow}
        onClose={() => { setShowFlow(false); setEditTarget(null); }}
        onSave={handleSaveRecord}
        onGoExercise={() => navigateTo('Exercise')}
        mode={editTarget ? 'edit' : 'create'}
        initialBody={editTarget?.bodyScore ?? null}
        initialMood={editTarget?.moodScore ?? null}
        initialSleep={editTarget?.sleepScore ?? null}
        initialConstipation={editTarget?.constipation ?? null}
        showSleep={editTarget ? editTarget.sleepScore !== undefined : todayLogs.length === 0}
        showConstipation={
          editTarget
            ? editTarget.constipation !== undefined
            : (pendingMealTime === 'bedtime' ||
               (pendingMealTime === 'dinner' && !hasBedtimeMedication))
        }
      />
      <DatePickerModal
        visible={showDatePicker}
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        onClose={() => setShowDatePicker(false)}
      />
      <PreRecordInfoModal
        visible={showPreRecordInfo}
        message={preRecordMessage}
        onClose={() => setShowPreRecordInfo(false)}
      />
      <NextNotifModal
        visible={showNextNotifModal}
        info={nextNotifInfo}
        onClose={() => {
          setShowNextNotifModal(false);
          // 다음 알림 안내가 닫힌 직후 권유 모달 인계 (조건 충족 시)
          if (pendingMeasureInvitePhase) {
            const p = pendingMeasureInvitePhase;
            setPendingMeasureInvitePhase(null);
            setMeasureInvitePhase(p);
            setShowMeasureInvite(true);
          }
        }}
      />
      <MeasurementInviteModal
        visible={showMeasureInvite}
        onMeasureNow={handleMeasureInviteAccept}
        onLater={handleMeasureInviteLater}
      />
      <TriggerSelectModal
        visible={showTriggerSelect}
        medTime={triggerMedTime}
        options={getEnabledIntervals()}
        selected={triggerModalSelected}
        onSelect={setTriggerModalSelected}
        onConfirm={() => {
          if (!triggerModalSelected) return;
          handleTriggerSelectConfirm(triggerModalSelected, triggerMedTime);
        }}
        onDismiss={() => setShowTriggerSelect(false)}
      />
    </SafeAreaView>
  );
}

function scoreEmoji(s: number): string {
  if (s >= 5) return '😄';
  if (s >= 4) return '😊';
  if (s >= 3) return '😐';
  if (s >= 2) return '😟';
  return '😢';
}

function scoreColor(s: number): string {
  if (s >= 4) return '#2E7D32';
  if (s === 3) return '#E65100';
  return '#B71C1C';
}

function RecordRow({
  record,
  isLast,
  canCancel,
  onCancel,
  onEdit,
}: {
  record: BodyRecord;
  isLast: boolean;
  canCancel: boolean;
  onCancel: (id: string) => void;
  onEdit: (record: BodyRecord) => void;
}) {
  const badgeBg = PERIOD_BADGE_BG[record.period] ?? 'rgba(0,0,0,0.08)';
  const badgeText = PERIOD_BADGE_TEXT[record.period] ?? '#333';
  const sep = <Text style={{ fontSize: 17, color: '#CCC', marginHorizontal: 10 }}>|</Text>;
  return (
    <View style={{
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderBottomWidth: isLast ? 0 : 1,
      borderBottomColor: '#F0F0F0',
    }}>
      {/* 트리거 배지 + 시간(좌) / 수정·삭제 아이콘(우) */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {/* 배지 + 시간 — 시간은 배지 바로 오른쪽에 붙임 */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{
            backgroundColor: badgeBg,
            borderRadius: 20,
            paddingHorizontal: 14,
            paddingVertical: 5,
          }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: badgeText }}>
              {record.trigger}
            </Text>
          </View>
          <Text style={{ fontSize: 16, color: '#999', marginLeft: 10 }}>{record.time}</Text>
        </View>
        {/* 수정/삭제 아이콘 — 오른쪽 유지(알림 설정과 동일 아이콘) */}
        {canCancel && (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.recordIconBtn}
              onPress={() => onEdit(record)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={22} color={Colors.textSub} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.recordIconBtnDelete}
              onPress={() => onCancel(record.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={22} color={Colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 점수 한 줄 — 이모지 + 점수 | 구분 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 18, color: scoreColor(record.bodyScore) }}>
          몸상태 {record.bodyScore}점 {scoreEmoji(record.bodyScore)}
        </Text>
        {sep}
        <Text style={{ fontSize: 18, color: scoreColor(record.moodScore) }}>
          기분 {record.moodScore}점 {scoreEmoji(record.moodScore)}
        </Text>
        {record.sleepScore !== undefined && (
          <>
            {sep}
            <Text style={{ fontSize: 18, color: scoreColor(record.sleepScore) }}>
              수면 {record.sleepScore}점 {scoreEmoji(record.sleepScore)}
            </Text>
          </>
        )}
        {record.constipation !== undefined && (
          <>
            {sep}
            <Text style={{ fontSize: 18, color: record.constipation ? '#B71C1C' : '#2E7D32' }}>
              변비 {record.constipation ? '있음' : '없음'}
            </Text>
          </>
        )}
      </View>

    </View>
  );
}

function MealSectionCard({
  period,
  displayTitle,
  records,
  canCancel,
  onCancel,
  onEdit,
}: {
  period: string;
  /** 헤더 표시 텍스트(slotTitle). 없으면 period 사용 */
  displayTitle?: string;
  records: BodyRecord[];
  canCancel: boolean;
  onCancel: (id: string) => void;
  onEdit: (record: BodyRecord) => void;
}) {
  // 색·아이콘은 시간대 키(period) 기준 유지, 표시 텍스트만 displayTitle
  const color = PERIOD_COLOR[period] ?? '#888';
  const icon = PERIOD_ICON[period] ?? '🕐';
  const title = displayTitle ?? period;

  return (
    <View style={{
      backgroundColor: '#fff',
      borderRadius: 16,
      marginBottom: 14,
      overflow: 'hidden',
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
    }}>
      {/* 섹션 헤더 */}
      <View style={{
        backgroundColor: color,
        paddingHorizontal: 18,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
      }}>
        <Text style={{ fontSize: 20, marginRight: 8 }}>{icon}</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#fff' }}>{title}</Text>
        <Text style={{ fontSize: 16, color: 'rgba(255,255,255,0.85)', marginLeft: 8 }}>
          {records.length}개 기록
        </Text>
      </View>

      {/* 기록 행들 */}
      {records.map((rec, idx) => (
        <RecordRow
          key={rec.id}
          record={rec}
          isLast={idx === records.length - 1}
          canCancel={canCancel}
          onCancel={onCancel}
          onEdit={onEdit}
        />
      ))}
    </View>
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
    gap: 14,
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
  mainButtonText: { fontSize: 26, fontWeight: '800', color: Colors.white },

  videoButtonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  outlineButton: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  outlineButtonDisabled: {
    borderColor: '#BDBDBD',
  },
  outlineButtonInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  outlineButtonEmoji: { fontSize: 22 },
  outlineButtonText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  outlineButtonTextDisabled: { color: '#BDBDBD' },

  records: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, paddingHorizontal: 4 },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  emptySubText: { fontSize: 17, color: Colors.textHint, textAlign: 'center', lineHeight: 26 },
  caregiverNotice: {
    marginTop: 0,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
  },
  // 기록 수정/삭제 아이콘 버튼 — 알림 설정(DoseSlotSetList)과 동일한 스타일
  recordIconBtn: {
    marginLeft: 12,
    padding: 4,
  },
  recordIconBtnDelete: {
    marginLeft: 4,
    padding: 4,
  },
});

// ─── TriggerSelectModal ───────────────────────────────────────────────────────

interface TriggerSelectOption {
  minutes: number;
  labelKey: string;
  labelDisplay: string;
}

interface TriggerSelectModalProps {
  visible: boolean;
  medTime: Date | null;
  options: TriggerSelectOption[];
  selected: string | null;
  onSelect: (labelKey: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}

function TriggerSelectModal({ visible, medTime, options, selected, onSelect, onConfirm, onDismiss }: TriggerSelectModalProps) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  const now = new Date();
  const elapsedMin = medTime ? Math.round((now.getTime() - medTime.getTime()) / 60000) : null;
  const elapsedText = elapsedMin !== null
    ? elapsedMin < 60
      ? `약 ${elapsedMin}분 경과`
      : `약 ${Math.floor(elapsedMin / 60)}시간 ${elapsedMin % 60}분 경과`
    : null;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={tsStyles.overlay}>
        <TouchableOpacity style={tsStyles.backdrop} activeOpacity={1} onPress={onDismiss} />
        <View style={[tsStyles.sheet, { paddingBottom: Math.max(44, 24 + insets.bottom) }]}>
          <View style={tsStyles.header}>
            <Text style={tsStyles.title}>약효 추적 시간대 선택</Text>
            <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={26} color={Colors.textSub} />
            </TouchableOpacity>
          </View>

          {medTime ? (
            <View style={tsStyles.medInfo}>
              <Text style={tsStyles.medTimeText}>{formatTime(medTime.toISOString())}에 약을 복용하셨어요</Text>
              {elapsedText && <Text style={tsStyles.elapsedText}>{elapsedText}</Text>}
            </View>
          ) : (
            <View style={tsStyles.medInfo}>
              <Text style={tsStyles.medTimeText}>약 복용 시간 기록이 없어요{'\n'}해당 약효 시간대를 선택해주세요</Text>
            </View>
          )}

          <View style={tsStyles.optionsList}>
            {options.map((opt) => {
              const isSel = selected === opt.labelKey;
              return (
                <TouchableOpacity
                  key={opt.labelKey}
                  style={[tsStyles.optionRow, isSel && tsStyles.optionRowSelected]}
                  onPress={() => onSelect(opt.labelKey)}
                  activeOpacity={0.7}
                >
                  <View style={[tsStyles.radio, isSel && tsStyles.radioSelected]}>
                    {isSel && <View style={tsStyles.radioDot} />}
                  </View>
                  <Text style={[tsStyles.optionLabel, isSel && tsStyles.optionLabelSelected]}>
                    {opt.labelDisplay}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[tsStyles.confirmBtn, !selected && tsStyles.confirmBtnDisabled]}
            onPress={onConfirm}
            disabled={!selected}
            activeOpacity={0.85}
          >
            <Text style={tsStyles.confirmBtnText}>기록하기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const tsStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 44,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text },
  medInfo: {
    backgroundColor: Colors.background,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  medTimeText: { fontSize: 18, fontWeight: '600', color: Colors.text, lineHeight: 26 },
  elapsedText: { fontSize: 16, color: Colors.textSub, marginTop: 4 },
  optionsList: { gap: 10, marginBottom: 24 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    gap: 14,
  },
  optionRowSelected: { borderColor: Colors.primary, backgroundColor: 'rgba(255,138,101,0.06)' },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.textHint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: { borderColor: Colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary },
  optionLabel: { fontSize: 20, color: Colors.text, fontWeight: '600' },
  optionLabelSelected: { color: Colors.primary, fontWeight: '700' },
  confirmBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: Colors.textHint },
  confirmBtnText: { fontSize: 20, fontWeight: '800', color: Colors.white },
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

function formatTimeHHMM_BS(date: Date): string {
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

    // 2) 다음 복용 안내 — dose_slots 순회(없으면 meal_schedules legacy 폴백) + exercise_notif_prefs 운동 알림
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('meal_schedules, exercise_notif_prefs')
      .eq('id', patientId)
      .single();

    if (userError) console.error('[fetchNextNotifMessage] userData error:', userError);

    // dose_slots 있으면 그것으로, 없으면 meal_schedules 4슬롯 legacy 가상 슬롯(동작 동일)
    const doseSlots = await fetchPatientDoseSlots(patientId);
    const displaySlots = resolveDisplaySlots(
      doseSlots,
      userData?.meal_schedules as Record<string, string> | null | undefined
    );
    // 시각 순(자정 기준 분)으로 정렬 후 현재 시각 이후 첫 슬롯 1개만 후보
    const sortedSlots = [...displaySlots].sort(
      (a, b) => slotSortValue(a.time) - slotSortValue(b.time)
    );

    let foundMeal = false;
    for (const slot of sortedSlots) {
      const [h, m] = slot.time.split(':').map(Number);
      if (Number.isNaN(h)) continue;
      const scheduled = new Date(now);
      scheduled.setHours(h, m || 0, 0, 0);
      if (scheduled > now) {
        const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
        candidates.push({
          minutesLeft,
          label: nextDoseLabel(slot.legacyKey, slot.label, slot.time),
          sendAt: scheduled,
        });
        foundMeal = true;
        break;
      }
    }

    // 오늘 복용 시각이 모두 지난 경우 내일 첫 복용으로 폴백
    if (!foundMeal && sortedSlots.length > 0) {
      const first = sortedSlots[0];
      const [fh, fm] = first.time.split(':').map(Number);
      if (!Number.isNaN(fh)) {
        const tomorrowFirst = new Date(now);
        tomorrowFirst.setDate(tomorrowFirst.getDate() + 1);
        tomorrowFirst.setHours(fh, fm || 0, 0, 0);
        const minutesLeft = Math.round((tomorrowFirst.getTime() - now.getTime()) / 60000);
        candidates.push({
          minutesLeft,
          label: `내일 ${nextDoseLabel(first.legacyKey, first.label, first.time).replace(/^다음 /, '')}`,
          sendAt: tomorrowFirst,
        });
      }
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
        timeStr: formatTimeHHMM_BS(tomorrow),
        minutesLeft: Math.round((tomorrow.getTime() - now.getTime()) / 60000),
      };
    }

    candidates.sort((a, b) => a.minutesLeft - b.minutesLeft);
    const best = candidates[0];

    if (best.minutesLeft < 1) return null;

    return {
      label: best.label,
      timeStr: formatTimeHHMM_BS(best.sendAt),
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

// ─── PreRecordInfoModal ───────────────────────────────────────────────────────

function PreRecordInfoModal({ visible, message, onClose }: { visible: boolean; message: string; onClose: () => void }) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={piStyles.overlay}>
        <View style={piStyles.card}>
          <Text style={piStyles.icon}>🔕</Text>
          <Text style={piStyles.title}>알림 취소 안내</Text>
          <Text style={piStyles.message}>{message}</Text>
          <TouchableOpacity style={piStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={piStyles.closeBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const piStyles = StyleSheet.create({
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
