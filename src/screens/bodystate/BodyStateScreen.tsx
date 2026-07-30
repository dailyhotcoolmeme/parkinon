import React, { useState, useEffect, useCallback, useRef } from 'react';
import { monthDayWeekday } from '../../utils/dateLabels';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { isOverseasLocale, displayLocaleTag } from '../../i18n/detectLocale';
import {
  formatClock, intervalAfterLabel, effectTrackingLabel, nextDoseLabelLoc,
  tomorrowLabel, exerciseReminderLabel, tomorrowMorningDoseLabel,
  intervalShortLabel, elapsedLabel, periodKeyToLabel,
} from '../../utils/notifLabels';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { AdSlot } from '../../components/common/AdSlot';
import { TopBar } from '../../components/common/TopBar';
import { SlotTimeIcon } from '../../components/common/SlotTimeIcon';
import { BodyStatePopupFlow } from './BodyStatePopupFlow';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { useAuth } from '../../context/AuthContext';
import { useBodyState } from '../../hooks/useBodyState';
import { triggerLabelToText, triggerLabelToMinutes, mealTimeToKorean, mealTimeToPeriod, mealTimeToPeriodKey } from '../../utils/medUtils';
import { fetchPatientDoseSlots, fetchPatientLabelDoseSlots, resolveDisplaySlots, getTrackingDayBounds } from '../../hooks/useDoseSlots';
import { useScrollTopOnTabPress } from '../../hooks/useScrollTopOnTabPress';
import type { DoseSlot } from '../../hooks/useDoseSlots';
import { nextDoseLabel, slotSortValue, buildSlotTitleMaps, slotDisplayName } from '../../constants/doseSlots';
import { navigateTo } from '../../navigation/navigationRef';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useSettings, type AmPm } from '../../context/SettingsContext';
import { useDialog } from '../../context/DialogContext';
import { HistoryTimeline } from '../../components/common/HistoryTimeline';
import { useRecordRealtime } from '../../hooks/useRecordRealtime';
import { ensureNotGuest } from '../../utils/guestGuard';
import { useSetupGate } from '../../hooks/useSetupGate';
import { SetupGuideBanner } from '../../components/common/SetupGuideBanner';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
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
  /** 시간대 키(morning/midday/evening/bedtime) — 아이콘/색 매핑용 */
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
  if (isOverseasLocale()) {
    return date.toLocaleDateString(displayLocaleTag(), { weekday: 'long', month: 'long', day: 'numeric' });
  }
  return monthDayWeekday(date);
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  return formatClock(d);
}

// 수시(식사시간대 없는) 기록의 시간대 키.
// 오너 확정 6구간(doseSlots.periodWord)과 일치: 새벽·아침·점심·오후·저녁·밤.
// (이전엔 4구간이라 15시가 '저녁'(h<20)으로 묶여 달(🌙) 아이콘이 떴음 — 낮인데 달이 뜨는 버그)
function getPeriod(isoString: string): string {
  const h = new Date(isoString).getHours();
  if (h < 6) return 'dawn';       // 0–5
  if (h < 11) return 'morning';   // 6–10
  if (h < 13) return 'midday';    // 11–12
  if (h < 17) return 'afternoon'; // 13–16 (15시 = 오후 = 해)
  if (h < 21) return 'evening';   // 17–20
  return 'night';                 // 21–23
}

// getPeriod() 반환값(내부 키·PERIOD_COLOR/ICON 조회용)의 표시용 라벨.
// 영어 고정표를 쓰면 새 언어에서 영어가 나온다 → 언어 파일 키로 위임한다.
const periodDisplayLabel = periodKeyToLabel;

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



// 시간대 키(morning/midday/evening/bedtime=식사 슬롯, dawn/afternoon/night=수시 기록 getPeriod)
const PERIOD_COLOR: Record<string, string> = {
  dawn: '#5C6BC0',
  morning: '#FF8A65',
  midday: '#4CAF50',
  afternoon: '#FFB300',
  evening: '#FB8C00',
  night: '#5E35B1',
  bedtime: '#7C4DFF',
};

// 시간대 키 → 대표 시각(HH). SlotTimeIcon 도형(해/달) 종류 결정용 — slotIconMeta 구간과 1:1.
const PERIOD_TIME: Record<string, string> = {
  dawn: '03:00',  // 초승달
  morning: '08:00',  // 뜨는 해
  midday: '12:00',  // 꽉 찬 해
  afternoon: '15:00',  // 꽉 찬 해
  evening: '19:00',  // 뜨는 초승달
  night: '22:00',    // 초승달
  bedtime: '23:00',  // 초승달
};

// 배지 배경: 섹션 색상의 연한 버전
const PERIOD_BADGE_BG: Record<string, string> = {
  dawn: 'rgba(92,107,192,0.15)',
  morning: 'rgba(255,138,101,0.15)',
  midday: 'rgba(76,175,80,0.15)',
  afternoon: 'rgba(255,179,0,0.15)',
  evening: 'rgba(251,140,0,0.15)',
  night: 'rgba(94,53,177,0.15)',
  bedtime: 'rgba(124,77,255,0.15)',
};
// 배지 텍스트: 섹션 색상보다 진한 버전
const PERIOD_BADGE_TEXT: Record<string, string> = {
  dawn: '#283593',
  morning: '#BF360C',
  midday: '#1B5E20',
  afternoon: '#E65100',
  evening: '#E65100',
  night: '#311B92',
  bedtime: '#4527A0',
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

// 약효추적 알림 진입이 원래 응답 시점(복용시각+interval)에서 너무 늦었는지 판정.
//   manual 경로(handleOpenBodyState)가 쓰는 ±30분 유예를 그대로 재사용한다.
//   알림 진입은 기존에 이 검사를 건너뛰어("지금 이 시점을 기록하라"는 명시적 지시로 취급)
//   울린 지 몇 시간 지난 알림을 몰아서 눌러도 그대로 기록되던 문제 → 늦으면 입력 자체를 막는다
//   (오너 결정 2026-07-24: 늦은 시점 데이터는 신뢰할 수 없으니 통계 제외가 아니라 입력 차단).
async function isNotifTrackingTooLate(
  medLogId: string | null,
  triggerMinutes: number | null
): Promise<boolean> {
  if (!medLogId || triggerMinutes == null) return false;
  try {
    const { data } = await supabase.from('med_logs').select('taken_at').eq('id', medLogId).maybeSingle();
    const takenAt = (data as any)?.taken_at;
    if (!takenAt) return false;
    const intended = new Date(takenAt).getTime() + triggerMinutes * 60000;
    return Date.now() - intended > 30 * 60 * 1000;
  } catch {
    return false;
  }
}

// 인터벌(분) → trigger_time_label 변환 (전역)
function intervalMinutesToLabel(min: number): string {
  if (min === 0) return 'after_medication';
  if (min === 120) return '2hour_after';
  return `${min}min_after`;
}

const intervalMinutesToText = intervalShortLabel;

const formatDurationKo = elapsedLabel;

export function BodyStateScreen() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { todayLogs, loadedOnce: bodyLogsLoadedOnce, saveBodyState, fetchVideoLogs, getBodyStateLogs, refresh } = useBodyState();
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
  // 과거 날짜 기록 로딩 표시 — 로딩 중 이전 날짜 데이터가 잠깐 남아 보이는 것 방지(스피너 표시).
  const [dateLogsLoading, setDateLogsLoading] = useState(false);
  // 진행 중인(in-flight) 동일 날짜 로드 키 — 포커스+마운트 동시 발화 등 중복 동시호출만 차단.
  const videoLogsInFlightKey = useRef<string | null>(null);
  const dateLogsInFlightKey = useRef<string | null>(null);
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
  // 저장 스피너 — "완료" 누른 뒤 저장(on_off_logs insert) + 다음 알림 조회 대기 구간을 덮는다.
  //   질문 체인(BodyStatePopupFlow) 전환에는 쓰지 않는다(즉시 전환 → 번쩍임).
  const [saving, setSaving] = useState(false);
  // 스피너(BrandProgressOverlay·Modal)가 "완전히 사라진 뒤" 단독으로 present 할 후속 동작을 담아둔다.
  //   닫히는 스피너 Modal 위에 NextNotifModal/AppDialog 를 올리면 iOS 에서 적층 교착(무한 스피너)이 나므로,
  //   setSaving(false) 로 오버레이를 내린 뒤 onHidden 에서만 후속 모달을 띄운다(ProfileEdit 패턴).
  const pendingAfterSaveRef = useRef<
    | { kind: 'next'; info: NextNotifInfo | null; measurePhase: MeasurementMedPhase | null }
    | { kind: 'alert'; title: string; message: string }
    | null
  >(null);
  // 환자 약 중 레보도파 계열 존재 여부 — 비레보도파 단독 환자는 권유 안 함
  const [hasLevodopaMed, setHasLevodopaMed] = useState(false);
  // 활성 dose_slots — 게이팅(첫/마지막 활성 슬롯)·실제 슬롯 보유 판정 등 "로직" 전용.
  const [displaySlots, setDisplaySlots] = useState<DoseSlot[]>([]);
  // 표시/라벨 전용 dose_slots — 비활성(soft delete) 슬롯 포함. 과거 기록 명칭(slotTitle)
  // 복원에만 사용한다(삭제해도 원래 시간대 이름 유지). 게이팅/스케줄에는 절대 쓰지 않음.
  const [labelSlots, setLabelSlots] = useState<DoseSlot[]>([]);
  const hasBedtimeLoadedRef = useRef(false);
  // 취침약 로딩 게이팅 bypass 타이머 — medications 로딩이 지연돼도 일정 시간 후엔 팝업 진입을 막지 않는다.
  const bedtimeGateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFlowArgsRef = useRef<{ label: string; medTime: Date | null; mealTimeKey: string | null; doseSlotId?: string | null; medLogId?: string | null; fromNotification?: boolean } | null>(null);
  // 회귀 수정: route.params triggerTs dedupe — 같은 ts는 한 번만 처리
  // (다른 탭 갔다 복귀 시 stale params로 인한 중복 발화 방지)
  const processedTriggerTsRef = useRef<number | null>(null);
  // 재진입 가드: 입력 팝업(BodyStatePopupFlow) 또는 시간대 선택 모달(TriggerSelectModal)이
  //   이미 열려 있는 동안 알림 탭으로 또 진입하면, 같은 시트를 두 번째 Modal 로 겹쳐 띄워
  //   Android 에서 흰화면/네이티브 크래시가 날 수 있다. 이 ref 로 "이미 플로우 진행 중"이면 무시한다.
  //   (state 는 useFocusEffect 클로저에서 stale 캡처되므로 ref 로 최신값을 읽는다.)
  const flowOpenRef = useRef(false);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationBadge();
  const { medNotifs } = useSettings();
  const dialog = useDialog();
  // 복용 시간대(dose_slot) 미등록 시 약효추적 기록 차단 게이팅 (B차).
  const { requireSetup } = useSetupGate();

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
    // 중복 동시호출 가드: 같은 날짜 영상 로드가 진행 중이면 스킵(다른 날짜는 통과 → 갱신 유지).
    if (videoLogsInFlightKey.current === dateStr) return;
    videoLogsInFlightKey.current = dateStr;
    try {
      const logs = await fetchVideoLogs(dateStr);
      setVideoLogs(logs);
    } finally {
      if (videoLogsInFlightKey.current === dateStr) videoLogsInFlightKey.current = null;
    }
  }, [selectedDate, fetchVideoLogs]);

  const loadDateLogs = useCallback(async () => {
    if (isToday) {
      setDateLogs([]);
      return;
    }
    const dateStr = toLocalDateString(selectedDate);
    // 중복 동시호출 가드: 같은 날짜 로드가 진행 중이면 스킵(포커스+마운트 동시 발화 등).
    if (dateLogsInFlightKey.current === dateStr) return;
    dateLogsInFlightKey.current = dateStr;
    setDateLogsLoading(true);
    try {
      const logs = await getBodyStateLogs(dateStr);
      setDateLogs(logs);
    } finally {
      setDateLogsLoading(false);
      if (dateLogsInFlightKey.current === dateStr) dateLogsInFlightKey.current = null;
    }
  }, [selectedDate, isToday, getBodyStateLogs]);

  // 날짜 바뀔 때마다 영상 목록 + 날짜별 기록 갱신
  useEffect(() => {
    loadVideoLogs();
    loadDateLogs();
  }, [loadVideoLogs, loadDateLogs]);

  // 포커스 시 stale 팝업 args 초기화 — 알림 useFocusEffect보다 반드시 먼저 실행되어야 함
  // ⚠️ 성능: 여기서 hasBedtimeLoadedRef 를 리셋하지 않는다. 취침약 정보는 한 번 로드하면
  //    유지하고(아래 취침약 조회 effect), 약(medications)이 실제 변경될 때만 realtime 으로
  //    무효화→재조회한다. 매 포커스마다 게이트를 풀면 진입할 때마다 재조회 + 팝업 대기가 생긴다.
  useFocusEffect(
    useCallback(() => {
      // ⚠️ 회귀 방지: 취침약 로딩 게이트로 보류 중(bypass 타이머 가동 중)인 args 는 지우지 않는다.
      //   콜드스타트 알림 진입 시 openFlowOrPend 가 args 를 pend → 네비게이션 정착으로 재포커스가
      //   발생하면 이 reset 이 args 를 지워, replay/timer 의 동일성 가드가 깨지면서 팝업이 영영
      //   안 열리던 회귀가 있었음. 활성 타이머가 있으면 곧 열릴 예정이므로 보존한다.
      if (bedtimeGateTimerRef.current) return;
      pendingFlowArgsRef.current = null;
    }, [])
  );

  // 환자 식별 state — 아래 알림 useFocusEffect/useEffect 의존성 배열에서 참조하므로
  // "선언 전 사용"(TS2448/TS2454) 방지를 위해 effect들보다 먼저 선언한다.
  const [patientName, setPatientName] = useState(i18n.t('medication.caregiverDefaultName'));
  const [patientId, setPatientId] = useState<string | null>(null);

  // 알림 탭 진입 시 trigger_time_label 자동 설정
  useFocusEffect(
    React.useCallback(() => {
      // ⚠️ 크래시 안전망: 이 effect 가 throw 하면(렌더 외 비동기 throw 포함) 앱이 닫힐 수 있어 전체를 감싼다.
      try {
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
        // 재진입 가드: 이미 플로우가 열려 있으면(약효추적 시트가 떠 있는 상태에서 또 탭) 무시.
        //   (기존 `!showFlow` 는 stale 캡처라 두 번째 탭에서 잘못 통과 → 중복 오픈/크래시.
        //    openFlowOrPend 내부에서도 flowOpenRef 로 한 번 더 가드한다.)
        if (!flowOpenRef.current) {
          isNotifTrackingTooLate(paramMedLogId, triggerMinutes).then((tooLate) => {
            if (tooLate) {
              dialog.alert({ emoji: '⏰', title: t('bodystate.cannotRecordTitle'), message: t('bodystate.trackingTooLateMsg') });
              return;
            }
            setPendingTriggeredBy('notification');
            setPendingTriggerLabel(label);
            if (paramMealTime) {
              openFlowOrPend(label, null, paramMealTime, paramDoseSlotId, paramMedLogId, true);
            } else if (patientId) {
              fetchTodayLastMedLog(patientId)
                .then((parsed) => {
                  if (!parsed) { openFlowOrPend(label, null, null, paramDoseSlotId, paramMedLogId, true); return; }
                  const medTime = parsed.taken_at ? new Date(parsed.taken_at) : null;
                  // 알림이 식별자를 안 실었을 때만 마지막 복용 기록에서 보강.
                  openFlowOrPend(
                    label,
                    medTime,
                    parsed.meal_time,
                    paramDoseSlotId ?? parsed.dose_slot_id ?? null,
                    paramMedLogId ?? parsed.id ?? null,
                    true,
                  );
                })
                .catch(() => openFlowOrPend(label, null, null, paramDoseSlotId, paramMedLogId, true));
            } else {
              openFlowOrPend(label, null, null, paramDoseSlotId, paramMedLogId, true);
            }
          });
        }

        // 처리 직후 route.params 비움 — 다음 포커스 진입 시 stale 재발화 방지
        // (handleSaveRecord 성공 시에만 비우는 기존 로직은 사용자가 취소/다른 탭 이동 시 stale 잔존)
        navigation.setParams({ triggerMinutes: null, triggerMealTime: null, triggerDoseSlotId: null, triggerMedLogId: null, triggerTs: null });
      }
      } catch (e) {
        console.error('[BodyStateScreen] exception handling route.params trigger (safety net):', e);
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
          // H-1 dedup: route params 경로와 '동일한' triggerTs(App.tsx에서 같은 값으로 주입)를
          // processedTriggerTsRef 로 공유한다. 같은 포커스에서 route effect가 먼저 처리했다면
          // 여기선 같은 ts 이므로 진입을 막아 openFlowOrPend 2회 호출(시트 2겹)을 방지한다.
          const psTriggerTs = parsed?.ts ?? null;
          if (psTriggerTs != null && processedTriggerTsRef.current === psTriggerTs) {
            return;
          }
          if (psTriggerTs != null) {
            processedTriggerTsRef.current = psTriggerTs;
          }
          // 약 복용 모델 7단계: AsyncStorage pending에 실린 슬롯/복용 식별자(없으면 null)
          const psDoseSlotId = triggerDoseSlotId ?? null;
          const psMedLogId = triggerMedLogId ?? null;
          const label = minutesToLabel(triggerMinutes);
          if (await isNotifTrackingTooLate(psMedLogId, triggerMinutes)) {
            dialog.alert({ emoji: '⏰', title: t('bodystate.cannotRecordTitle'), message: t('bodystate.trackingTooLateMsg') });
            return;
          }
          setPendingTriggeredBy('notification');
          setPendingTriggerLabel(label);
          if (triggerMealTime) {
            openFlowOrPend(label, null, triggerMealTime, psDoseSlotId, psMedLogId, true);
          } else if (patientId) {
            fetchTodayLastMedLog(patientId)
              .then((parsed) => {
                if (!parsed) { openFlowOrPend(label, null, null, psDoseSlotId, psMedLogId, true); return; }
                const medTime = parsed.taken_at ? new Date(parsed.taken_at) : null;
                openFlowOrPend(
                  label,
                  medTime,
                  parsed.meal_time,
                  psDoseSlotId ?? parsed.dose_slot_id ?? null,
                  psMedLogId ?? parsed.id ?? null,
                  true,
                );
              })
              .catch(() => openFlowOrPend(label, null, null, psDoseSlotId, psMedLogId, true));
          } else {
            openFlowOrPend(label, null, null, psDoseSlotId, psMedLogId, true);
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

  // 취침약 무효화 트리거: 약(medications)이 실제 추가/수정/삭제될 때만 재조회한다.
  //   useMedication.ts 의 medications realtime 과 동일 패턴(patient_id 필터). 매 포커스
  //   강제 재조회 대신, 약이 바뀐 경우에만 bedtimeRefreshTick 증가 → 취침약 게이트 최신화.
  //   (약 관리 화면에서 추가/삭제/시간변경 시 이 화면이 백그라운드여도 이벤트가 도착하면 갱신.)
  useEffect(() => {
    if (!patientId) return;
    const topic = `bodystate-meds-bedtime-${patientId}`;
    // 재진입/StrictMode 이중 마운트 시 같은 topic 잔존 채널이 재사용되어 .on() 추가 중
    // throw 하는 크래시 방지(useRecordRealtime 과 동일 방어).
    supabase
      .getChannels()
      .filter((c) => c.topic === `realtime:${topic}` || c.topic === topic)
      .forEach((c) => { supabase.removeChannel(c); });
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medications', filter: `patient_id=eq.${patientId}` },
        () => { setBedtimeRefreshTick(t => t + 1); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [patientId]);

  // 취침약 여부 실제 조회 — useEffect로 patientId 확보 후 실행 보장.
  //   patientId 변경 또는 약 변경(bedtimeRefreshTick) 시에만 재조회. 매 포커스 재조회 아님.
  //   재조회 동안은 hasBedtimeLoadedRef 를 내려 stale 판정 팝업을 막고, 완료 후 다시 올린다.
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
          // 게이팅이 정상 로드로 풀린 경우 — bypass 타이머가 떠 있으면 정리(중복 오픈 방지).
          if (bedtimeGateTimerRef.current) { clearTimeout(bedtimeGateTimerRef.current); bedtimeGateTimerRef.current = null; }
          openFlowLatestRef.current(args.label, args.medTime, args.mealTimeKey, args.doseSlotId ?? null, args.medLogId ?? null, args.fromNotification ?? false);
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

  // dose_slots 로드 — 활성(게이팅용)과 표시/라벨용(비활성 포함)을 한 번에 가져온다.
  useEffect(() => {
    if (!patientId) {
      setDisplaySlots([]);
      setLabelSlots([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        // 세 조회는 patientId 만 의존하므로 병렬화(로딩 1왕복으로 단축).
        const [userRes, doseSlots, labelDoseSlots] = await Promise.all([
          supabase.from('users').select('meal_schedules').eq('id', patientId).single(),
          fetchPatientDoseSlots(patientId),       // 활성 전용 — 게이팅/판정용
          fetchPatientLabelDoseSlots(patientId),  // 비활성 포함 — 과거 기록 라벨용
        ]);
        const mealSchedules = userRes.data?.meal_schedules as Record<string, string> | null | undefined;
        const resolved = resolveDisplaySlots(doseSlots, mealSchedules);
        // 라벨용: 비활성 포함 슬롯이 있으면 그것으로, 없으면 동일 legacy 폴백.
        const resolvedLabel = resolveDisplaySlots(labelDoseSlots, mealSchedules);
        if (alive) {
          setDisplaySlots(resolved);
          setLabelSlots(resolvedLabel);
        }
      } catch {
        if (alive) {
          setDisplaySlots([]);
          setLabelSlots([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId, recordsRefreshKey]);

  // 슬롯 표시명(slotTitle) 조회맵 — byId[dose_slot_id] / byLegacyKey[meal_time]
  // 비활성(삭제) 슬롯 포함 labelSlots 로 구성 → 삭제된 슬롯의 과거 기록도 원래 이름 유지.
  const slotTitleMaps = React.useMemo(
    () =>
      buildSlotTitleMaps(
        labelSlots.map((s) => ({ id: s.id, label: s.label, legacyKey: s.legacyKey, time: s.time }))
      ),
    [labelSlots]
  );

  // 수면/변비 게이팅용 — dose_slot 환자 여부(실제 슬롯 보유)
  const isDoseSlotPatient = React.useMemo(
    () => displaySlots.some((s) => s.isReal),
    [displaySlots]
  );

  // [변비/수면 게이팅] 변비=그날 "마지막 약효추적 시점", 수면=그날 "첫 약효추적 시점" 1건에서만.
  //   ⚠️ 슬롯-id 기준 게이팅(마지막/첫 슬롯)은, 같은 슬롯의 복용직후 + 약효추적(30/60/120분후) 기록이
  //      모두 같은 슬롯에 귀속돼 게이트를 중복 통과시켰다(변비가 마지막 슬롯의 복용직후에서 떠버림).
  //   → "슬롯시각 + interval" 합으로 그날 약효추적 시점들을 펼쳐, 가장 늦은/이른 시점과 정확히 일치하는
  //      단 1건의 기록에서만 변비/수면을 묻는다(getTrackingDayBounds).
  const trackingDayBounds = React.useMemo(
    () => getTrackingDayBounds(displaySlots),
    [displaySlots]
  );
  // 현재 기록(팝업 진입)의 약효추적 시점(분, 자정 기준) = 진입 슬롯시각 + 이 기록의 interval.
  //   - 진입 슬롯: pendingDoseSlotId 로 displaySlots 에서 해석.
  //   - interval: pendingTriggerLabel(after_medication=0 / 30min_after=30 / 2hour_after=120 …) 식별.
  //   슬롯/라벨이 해석 안 되면 null → 게이팅에서 표시 안 함(보수적).
  const currentTrackingMin = React.useMemo<number | null>(() => {
    if (!pendingDoseSlotId) return null;
    const slot = displaySlots.find((s) => s.id === pendingDoseSlotId);
    if (!slot) return null;
    const base = slotSortValue(slot.time);
    if (!Number.isFinite(base)) return null;
    return base + triggerLabelToMinutes(pendingTriggerLabel);
  }, [pendingDoseSlotId, pendingTriggerLabel, displaySlots]);

  // 표시할 로그: 오늘이면 todayLogs, 다른 날이면 dateLogs
  const activeLogs = isToday ? todayLogs : dateLogs;

  // [수면 게이팅] 그날 이미 수면(sleep_quality)이 기록됐는지 — "하루 1회"(중복 방지) 불변식 유지용.
  //   이미 로드된 해당 날짜 로그(activeLogs)에서 sleep_quality 가 채워진 on_off_log 유무로 판단.
  //   → 추가 네트워크 쿼리 없이 계산. 저장 시 saveBodyState 가 insert 결과 행(sleep_quality 포함)을
  //      todayLogs 에 낙관적 prepend + 재조회 + realtime 재조회로 반영하므로, 다음 진입에서 true 가 되어
  //      중복 노출이 막힌다.
  const hasSleepToday = React.useMemo(
    () => activeLogs.some((log: any) => log?.sleep_quality != null),
    [activeLogs]
  );

  // trigger_time_label → 표시 텍스트 (공용 유틸 위임)
  const getTriggerLabel = (label: string): string => triggerLabelToText(label);

  // 약효추적 중복/덮어쓰기 판정의 "복용 인스턴스 동일" 비교.
  //   중복 단위 = med_log_id(복용 인스턴스) + trigger_time_label(시점). 여기선 같은 복용인지만 본다
  //   (label 일치는 호출부에서 이미 확인). 다른 복용의 같은 시점 라벨은 별개 기록이므로 false.
  //   med_log_id null 폴백: 양쪽 med_log_id가 모두 없는 구(舊)/미이관 기록일 때만
  //   기존 label(+meal_time) 기준 비교로 폴백. 한쪽만 null이면 다른 복용으로 간주(중복 아님).
  const isSameDoseInstance = (
    log: any,
    medLogId: string | null | undefined,
    mealTimeKey: string | null | undefined
  ): boolean => {
    const logMedLogId = log?.med_log_id ?? null;
    const candidateMedLogId = medLogId ?? null;
    if (logMedLogId != null && candidateMedLogId != null) {
      // 둘 다 식별자 있음 → 같은 복용 인스턴스일 때만 동일.
      return logMedLogId === candidateMedLogId;
    }
    if (logMedLogId != null || candidateMedLogId != null) {
      // 한쪽만 식별자 있음 → 서로 다른 복용으로 간주(중복 아님).
      return false;
    }
    // 양쪽 모두 med_log_id 없음 → 기존 meal_time 기준 폴백.
    if (mealTimeKey && log?.medication_meal_time && log.medication_meal_time !== mealTimeKey) return false;
    return true;
  };

  // 같은 시간대 배지가 오늘 이미 있으면 확인 후 팝업 오픈
  // mealTimeKey: 실제 med_logs.meal_time ('morning'|'lunch'|'dinner'|'bedtime')
  const openFlowWithDuplicateCheck = (
    labelKey: string,
    medTime: Date | null,
    mealTimeKey: string | null,
    doseSlotId: string | null = null,
    medLogId: string | null = null,
    fromNotification: boolean = false,
  ) => {
    setPendingMealTime(mealTimeKey);
    // 슬롯/복용 식별자 보강 — 알림 진입 시 전달됨. 없으면 null(미이관/수동·통계 미반영).
    setPendingDoseSlotId(doseSlotId);
    setPendingMedLogId(medLogId);
    // 알림 진입(약효추적 알림 탭)은 "지금 이 시점을 기록하라"는 명시적 지시이므로
    // 중복 검사·시간대 선택 시트를 거치지 않고 바로 입력 팝업을 연다.
    // 같은 시점(label) 기록이 오늘 이미 있으면 새 행을 만들지 않고 그 기록을 덮어쓰기(수정)한다.
    if (fromNotification) {
      // 중복(=덮어쓰기 대상) 판정 = "같은 복용(med_log_id) + 같은 시점(label)"일 때만.
      // 다른 복용의 같은 시점 라벨은 별개 기록이므로 existing 없음 → 새 기록으로 입력.
      const existing = activeLogs.find((log: any) => {
        if (log.trigger_time_label !== labelKey) return false;
        return isSameDoseInstance(log, medLogId, mealTimeKey);
      });
      overrideLogIdRef.current = existing ? ((existing as any).id ?? null) : null;
      setShowFlow(true);
      return;
    }
    // mealTimeKey가 있는 경우 — label + meal_time 모두 일치할 때만 중복으로 처리
    // (예: 점심약 복용 직후 기록이 있어도 저녁약 복용 직후 기록은 허용)
    const hasDuplicate = activeLogs.some((log: any) => {
      if (log.trigger_time_label !== labelKey) return false;
      // 중복 = 같은 복용(med_log_id) + 같은 시점(label). 다른 복용은 중복 아님.
      return isSameDoseInstance(log, medLogId, mealTimeKey);
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

  // 재진입 가드 ref 를 현재 모달 오픈 상태와 동기화.
  //   showFlow(입력 팝업) 또는 showTriggerSelect(시간대 선택)가 하나라도 열려 있으면 '진행 중'.
  useEffect(() => {
    flowOpenRef.current = showFlow || showTriggerSelect;
  }, [showFlow, showTriggerSelect]);

  // 언마운트 시 게이팅 bypass 타이머 정리 — 언마운트 후 늦게 발화해 setState 하는 것 방지.
  useEffect(() => {
    return () => {
      if (bedtimeGateTimerRef.current) {
        clearTimeout(bedtimeGateTimerRef.current);
        bedtimeGateTimerRef.current = null;
      }
    };
  }, []);

  // TriggerSelectModal '기록하기' 확정 처리.
  // 버그 수정: 기존엔 onConfirm → openFlowOrPend → openFlowWithDuplicateCheck로 되돌아가
  // 같은 (중복) 시간대가 그대로 재검출되면 TriggerSelectModal이 무한 재오픈 →
  // "기록하기 눌러도 반응 없음"으로 보임. 사용자가 모달에서 시간대를 명시적으로 선택한
  // 시점부터는 중복 재검사를 하지 않고, 중복이면 덮어쓰기 모드로 바로 팝업을 연다.
  const handleTriggerSelectConfirm = (labelKey: string, medTime: Date | null) => {
    setShowTriggerSelect(false);
    setPendingTriggerLabel(labelKey);
    // 선택한 시간대가 같은 복용(med_log_id)으로 이미 기록되어 있으면 → 덮어쓰기 모드로 진입.
    // 다른 복용의 같은 라벨은 별개 기록이므로 덮어쓰지 않는다.
    // pendingMedLogId/pendingMealTime은 openFlowWithDuplicateCheck 진입 시 설정됨.
    const existing = activeLogs.find(
      (log: any) =>
        log.trigger_time_label === labelKey &&
        isSameDoseInstance(log, pendingMedLogId, pendingMealTime)
    );
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
    fromNotification: boolean = false,
  ) => {
    // 재진입 가드: 이미 입력 팝업/시간대 선택이 열려 있으면 무시.
    //   (약효추적 알림을 두 번째로 탭해 진입 → 같은 시트를 겹쳐 여는 중복 오픈 차단.
    //    이미 열린 시트에서 사용자가 그대로 입력하면 되므로, 새로 열거나 닫고 다시 열지 않는다.)
    if (flowOpenRef.current) {
      return;
    }
    // ⚠️ 회귀 수정(콜드스타트 약효추적 알림 미오픈): 알림 진입은 "지금 이 시점을 기록하라"는
    //   명시적 지시이므로 취침약 로딩 게이트를 기다리지 않고 즉시 팝업을 연다.
    //   변비/수면 단계 노출은 BodyStatePopupFlow 렌더 시 hasBedtimeMedication·currentTrackingMin
    //   최신값으로 평가되므로(사용자가 해당 단계에 닿을 때쯤 이미 로드 완료) 즉시 열어도 안전.
    //   (기존엔 cold-start 에서 args 를 pend 했다가 재포커스의 focus-reset 으로 args 가 지워지고
    //    replay/2.5s 타이머의 동일성 가드가 깨져 팝업이 영영 안 열리는 회귀가 있었음.)
    if (fromNotification) {
      openFlowWithDuplicateCheck(label, medTime, mealTimeKey, doseSlotId, medLogId, fromNotification);
      return;
    }
    if (!hasBedtimeLoadedRef.current) {
      const args = { label, medTime, mealTimeKey, doseSlotId, medLogId, fromNotification };
      pendingFlowArgsRef.current = args;
      // 게이팅 bypass 타임아웃: medications 로딩이 지연돼도 2.5초 후엔 팝업 진입을 막지 않는다.
      //   취침약 데이터는 로드되면 위 bedtime effect 의 replay 로 반영된다(다단계 팝업이라
      //   사용자가 변비 단계에 닿을 때쯤이면 hasBedtimeMedication 최신값이 prop 으로 반영됨).
      //   먼저 발화한 쪽(타이머 vs replay)만 열도록 pendingFlowArgsRef 동일성으로 중복 오픈을 막는다.
      if (bedtimeGateTimerRef.current) clearTimeout(bedtimeGateTimerRef.current);
      bedtimeGateTimerRef.current = setTimeout(() => {
        bedtimeGateTimerRef.current = null;
        if (pendingFlowArgsRef.current === args && !flowOpenRef.current) {
          pendingFlowArgsRef.current = null;
          openFlowLatestRef.current(args.label, args.medTime, args.mealTimeKey, args.doseSlotId ?? null, args.medLogId ?? null, args.fromNotification ?? false);
        }
      }, 2500);
      return;
    }
    openFlowWithDuplicateCheck(label, medTime, mealTimeKey, doseSlotId, medLogId, fromNotification);
  };

  // 활성화된 medNotifs 인터벌 목록 (복용 직후 포함)
  const getEnabledIntervals = (): Array<{ minutes: number; labelKey: string; labelDisplay: string }> => {
    const result: Array<{ minutes: number; labelKey: string; labelDisplay: string }> = [
      { minutes: 0, labelKey: 'after_medication', labelDisplay: getTriggerLabel('after_medication') },
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
  // 2) ±30분 매칭 → 확인 팝업
  // 3) 동률 → 이전(작은) 인터벌 우선
  // 4/6) ±30분 벗어남 → 차단 + 다음 알림 안내
  // 5) 같은 (meal_time × interval) 기록 존재 → 덮어쓰기 확인
  const handleOpenBodyState = async () => {
    if (!patientId) return;
    // 게이팅(B차): 활성 dose_slot 0개면 약효추적 기록 막고 통합 등록(복용 관리) 유도.
    // 메인 버튼/보호자 확인 양쪽이 이 함수로 모이므로 단일 차단점. 보수적(로딩 중/조회불가 통과).
    if (!(await requireSetup(dialog))) return;
    setPendingTriggeredBy('manual');

    // 1. 오늘 가장 최근 med_log 조회
    const lastMedLog = await fetchTodayLastMedLog(patientId);

    // 케이스 1: 약 복용 기록 없음
    if (!lastMedLog || !lastMedLog.taken_at) {
      dialog.alert({
        title: t('bodystate.cannotRecordTitle'),
        message: t('bodystate.noMedLogMsg'),
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
        title: t('bodystate.cannotRecordTitle'),
        message: t('bodystate.noIntervalMsg'),
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

    // 3. 가장 가까운 인터벌 매칭 (±30분, 동률 시 작은 인터벌 우선)
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

    // 케이스 4 & 6: ±30분 벗어남
    if (closestInterval === null || closestDiff > 30) {
      // 다음 도래할 인터벌 시각 계산
      let nextAt: Date | null = null;
      for (const iv of intervals) {
        const t = new Date(takenAt.getTime() + iv * 60000);
        if (t.getTime() - now.getTime() > 30 * 60 * 1000 * -1 && t.getTime() > now.getTime()) {
          // 미래 시점만
          nextAt = t;
          break;
        }
      }
      if (!nextAt) {
        dialog.alert({
          title: t('bodystate.cannotRecordTitle'),
          message: t('bodystate.outOfRangeMsg'),
        });
      } else {
        const remainMin = (nextAt.getTime() - now.getTime()) / 60000;
        dialog.alert({
          title: t('bodystate.cannotRecordTitle'),
          message: t('bodystate.outOfRangeNextMsg', { duration: formatDurationKo(remainMin) }),
        });
      }
      return;
    }

    // 4. 같은 (meal_time × interval) 이미 기록되어 있는지 확인
    const labelKey = intervalMinutesToLabel(closestInterval);
    const existing = todayLogs.find((log: any) => {
      if (log.trigger_time_label !== labelKey) return false;
      // 중복 = 같은 복용(med_log_id) + 같은 시점(label). 다른 복용은 별개 기록.
      return isSameDoseInstance(log, manualMedLogId, mealTime);
    });

    const intervalText = intervalMinutesToText(closestInterval);
    const mealLabel = mealTime ? mealTimeToKorean(mealTime) : '';

    if (existing) {
      // 케이스 5: 이미 기록됨 → 덮어쓰기 확인
      // 오타 수정: mealLabel이 이미 "저녁약" 형태이므로 추가 "약" 붙이지 않음
      const targetLabel = mealLabel
        ? t('bodystate.targetWithMeal', { meal: mealLabel, interval: intervalText })
        : t('bodystate.targetNoMeal', { interval: intervalText });
      const confirmed = await dialog.confirm({
        title: t('bodystate.alreadyRecordedTitle'),
        message: t('bodystate.alreadyRecordedMsg', { target: targetLabel }),
        confirmText: t('bodystate.overwrite'),
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
    // (사용자가 ±30분 이내 약효추적 시간대에 들어와있으면 별도 확인 불필요)
    overrideLogIdRef.current = null;
    setPendingTriggerLabel(labelKey);
    setPendingMealTime(mealTime ?? null);
    openFlowOrPend(labelKey, takenAt, mealTime ?? null, manualDoseSlotId, manualMedLogId);
  };

  // DB 로그 → BodyRecord 변환
  const records: BodyRecord[] = activeLogs.map((log: any) => {
    // 아이콘/색 조회용 키는 로케일 무관 영어 키다 — 표시용 값을 쓰면 해외에서 조회가 전부 실패한다.
    const mealPeriodKey = log.medication_meal_time ? mealTimeToPeriodKey(log.medication_meal_time) : null;
    const period = mealPeriodKey ?? getPeriod(log.logged_at);
    // 표시용 슬롯 명칭(slotTitle): byId[dose_slot_id] 우선 → byLegacyKey[meal_time] → legacy 폴백
    const slotLabel =
      (log.dose_slot_id && slotTitleMaps.byId[log.dose_slot_id]) ||
      (log.medication_meal_time && slotTitleMaps.byLegacyKey[log.medication_meal_time]) ||
      periodDisplayLabel(period);
    // 그룹 정렬용 시각: 해당 슬롯의 time(없으면 기록 시각).
    // labelSlots(비활성 포함) 로 찾아 삭제된 슬롯 기록도 원래 시각으로 정렬되게 한다.
    const matchedSlot =
      (log.dose_slot_id && labelSlots.find((s) => s.id === log.dose_slot_id)) ||
      (log.medication_meal_time &&
        labelSlots.find((s) => s.legacyKey === log.medication_meal_time)) ||
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
        || (log.triggered_by === 'notification' ? t('bodystate.triggerNotification') : t('bodystate.triggerManual')),
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
      title: t('bodystate.cancelRecordTitle'),
      message: t('bodystate.cancelRecordMsg'),
      confirmText: t('bodystate.cancelRecordConfirm'),
      cancelText: t('common.close'),
      destructive: true,
    });
    if (!ok) return;

    const { error } = await supabase.rpc('cancel_patient_record', {
      p_table: 'on_off_logs',
      p_record_id: onOffLogId,
    });

    if (error) {
      console.error('[BodyStateScreen] handleCancelRecord error:', error);
      dialog.alert({ title: t('bodystate.cancelFailTitle'), message: t('bodystate.cancelFailMsg') });
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
      // null = "그 항목은 미수정" → RPC가 coalesce(p_*, 기존값)로 기존값 보존.
      // (0/false 기본값으로 좁히면 기존 수면/변비 기록을 덮어쓰는 데이터 손상 버그가 됨.
      //  Supabase 타입젠이 함수 인자 nullability를 잃어 number/boolean로만 잡지만 런타임은 null 허용)
      p_sleep_quality: (record.sleepScore ?? null) as unknown as number,
      p_constipation: (record.constipation ?? null) as unknown as boolean,
    });

    if (error) {
      console.error('[BodyStateScreen] handleSaveEdit error:', error);
      dialog.alert({ title: t('bodystate.editFailTitle'), message: t('bodystate.editFailMsg') });
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

    // 질문 모달을 닫은 뒤 저장 스피너 ON — 저장 + 다음 알림 조회 대기 구간을 덮는다.
    pendingAfterSaveRef.current = null;
    setSaving(true);

    // 2. 저장 + 큐 삭제 + 다음 알림 팝업 — await 체인으로 순서 보장
    (async () => {
      try {
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
        // 스피너 Modal 위에 AppDialog 를 적층하지 않도록, 알림은 onHidden 에서 단독 present.
        pendingAfterSaveRef.current = { kind: 'alert', title: t('bodystate.saveFailTitle'), message: t('bodystate.saveFailMsg') };
        return;
      }

      // 2-1a. 다음 예정 알림 조회를 미리(병렬로) 시작 — 팝업이 즉시 뜨도록.
      //   fetchNextNotifMessage 의 큐 SELECT 는 send_at > now 만 보므로, 아래 큐 삭제(과거·미발송 항목)와
      //   독립적이다. 저장 성공 직후 promise 를 띄워 두고, 모달 표시 시점에 await 한다(B: 병렬화).
      // 방금 기록이 "복용 직후"(triggerMinutes=0) 진입이고 dose_slot 환자면, 그 복용의
      //   약효추적 시점을 결정적으로 후보에 넣는다(큐 적재 경합으로 더 먼 알림이 뜨는 것 방지).
      //   - 큐 적재(takeMedication 백그라운드 invoke)가 아직 안 끝났을 수 있는 유일한 경로가 이 복용 직후 기록이다.
      //   - 30분/2시간 알림 진입(intervalMin>0)은 큐가 이미 적재돼 있어 전달하지 않는다(불필요한 변경 회피).
      //   - takenAt≈now: 복용 직후 기록이라 기록 시각이 복용 시각과 거의 같다(약 복용 흐름의 nowForCheck 앵커와 동일 근사).
      const recordedIntervalMin = savedLabel ? labelToMinutes(savedLabel) : null;
      const justTakenForNotif: { takenAt: Date; doseSlotId: string } | null =
        savedDoseSlotId && recordedIntervalMin === 0
          ? { takenAt: new Date(), doseSlotId: savedDoseSlotId }
          : null;
      const nextNotifPromise: Promise<NextNotifInfo | null> | null = savedPatientId
        ? fetchNextNotifMessage(savedPatientId, justTakenForNotif).catch((e) => {
            console.error('[fetchNextNotifMessage] error:', e);
            return null;
          })
        : null;

      // 2-1b. 덮어쓰기 모드: 기존 로그 삭제 (새 로그가 성공적으로 저장된 경우에만)
      if (savedOverrideLogId) {
        try {
          await supabase.from('on_off_logs').delete().eq('id', savedOverrideLogId);
          // 화면 갱신
          await refresh();
        } catch (overrideErr) {
          console.error('[handleSaveRecord] failed to delete the existing log:', overrideErr);
        }
      }

      // 2-2. 큐 삭제 — PreRecordInfoModal(별개 팝업) 표시에만 쓰임.
      //   NextNotifModal 표시는 큐 삭제 결과에 의존하지 않으므로 await 로 막지 않고
      //   백그라운드(void)로 돌려 네트워크 왕복 1회만큼 NextNotifModal 표시를 앞당긴다.
      //   (fetchNextNotifMessage 의 큐 SELECT 는 send_at > now 만 보므로 이 삭제(과거·미발송)와 독립.
      //    그리고 nextNotifPromise 는 이미 2-1a 에서 병렬로 시작됨 → 이 삭제가 그 fetch 를 게이팅하지 않음.)
      //   PreRecordInfo 는 큐가 실제 삭제될 때만 떠야 하므로, 삭제 결과를 받아 그 안에서만 표시.
      const intervalMin = savedLabel ? labelToMinutes(savedLabel) : null;
      if (intervalMin != null && savedPatientId) {
        void (async () => {
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
              let slotName = periodDisplayLabel(getPeriod(new Date().toISOString()));
              const mapped =
                (savedDoseSlotId && slotTitleMaps.byId[savedDoseSlotId]) ||
                (savedMealTime && slotTitleMaps.byLegacyKey[savedMealTime]) ||
                (savedMealTime ? mealTimeToPeriod(savedMealTime) : null);
              if (mapped) slotName = mapped;
              const delta = triggerLabelToText(savedLabel!);
              setPreRecordMessage(t('bodystate.preRecordMsg', { slot: slotName, delta }));
              setShowPreRecordInfo(true);
            }
          } catch (queueErr) {
            console.error('[handleSaveRecord] queue delete error:', queueErr);
          }
        })();
      }

      // 2-3. 미리 시작해 둔 다음 예정 알림 조회 결과 — 표시는 onHidden 으로 미룬다.
      //   (2-1a 에서 저장 직후 병렬로 시작 → 여기선 이미 끝나 있다.)
      //   스피너 Modal 위에 NextNotifModal 을 적층하면 iOS 에서 멈추므로,
      //   조회 결과만 ref 에 담아두고 setSaving(false) 후 오버레이가 완전히 사라진 뒤 단독 present.
      const info: NextNotifInfo | null = nextNotifPromise ? await nextNotifPromise : null;

      // 2-4. 컨디션 측정 권유 조건 평가 — 표시도 onHidden 으로 인계(NextNotif 유무에 따라 분기).
      //   조건: 환자 본인 + 약효추적 알림 진입(notification) + 30m/2h 시점 + 레보도파 보유
      //   비노출: 보호자 / 게스트 / 비레보도파 단독 / 자율 입력
      const phase = labelToMedPhase(savedLabel);
      const measurePhase =
        MEASUREMENT_FEATURE_ENABLED &&
        phase &&
        userRole === 'patient' &&
        savedTriggeredBy === 'notification' &&
        hasLevodopaMed
          ? phase
          : null;

      pendingAfterSaveRef.current = { kind: 'next', info, measurePhase };
      } finally {
        // 저장/조회 성공·실패·예외 무관하게 스피너 해제 보장 → onHidden 에서 후속 모달 present.
        setSaving(false);
      }
    })().catch((e) => {
      console.error('[handleSaveRecord] save handling error:', e);
    });
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
        <TouchableOpacity style={styles.calBtn} onPress={() => setShowDatePicker(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
          
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 첫 로그인/미등록 유도 배너 — 활성 dose_slot 0개일 때만 노출(그룹 기준, 역할 무관) */}
        <SetupGuideBanner />

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
              // 게이팅(B차): 미등록(활성 슬롯 0)이면 보호자 확인 모달도 열지 않고 통합 등록 유도.
              if (!(await requireSetup(dialog))) return;
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
              <Text style={styles.mainButtonText}>{t('bodystate.mainButton')}</Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>{t('bodystate.noticeCaregiverNoPatient')}</Text>
          )}
          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>{t('bodystate.noticeCaregiverSeparate')}</Text>
          )}
          {!isToday && userRole !== 'caregiver_separate' && userRole !== 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>{t('bodystate.noticeNotToday')}</Text>
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
                  <Text style={styles.outlineButtonText}>{t('bodystate.measureNow')}</Text>
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
                  <Text style={styles.outlineButtonText}>{t('bodystate.measureRecords')}</Text>
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
                <Text style={[styles.outlineButtonText, !isToday && styles.outlineButtonTextDisabled]}>{t('bodystate.videoRecord')}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => navigation.navigate('VideoList')}
              activeOpacity={0.85}
            >
              <View style={styles.outlineButtonInner}>
                <Ionicons name="albums-outline" size={24} color={Colors.primary} />
                <Text style={styles.outlineButtonText}>{t('bodystate.videoList')}</Text>
              </View>
            </TouchableOpacity>
          </View>

        </View>

        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>{isToday ? t('bodystate.sectionTitleToday') : t('bodystate.sectionTitle')}</Text>
            <View style={styles.divider} />
          </View>
          {/* 광고: 오늘 기록 리스트 최상단(첫 슬롯 자리) — 해외+free 전용 */}
          <AdSlot placement="bodyState" />
          {!isToday && dateLogsLoading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : records.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="happy-outline" size={48} color={Colors.textSub} />
              <Text style={styles.emptyText}>{t('bodystate.empty')}</Text>
              <Text style={styles.emptySubText}>{t('bodystate.emptySub')}</Text>
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
        // 수면/변비 게이팅(hasSleepToday 등)이 신뢰 가능한 시점에만 단계 스냅샷을 뜨게 한다.
        //   수정 모드는 editTarget 값으로 결정(로그 불필요)이라 항상 ready.
        //   오늘 신규 입력은 오늘 로그 최소 1회 로드 후에만 ready(콜드스타트 알림 진입 시 중복 수면 방지).
        gatingReady={editTarget ? true : (isToday ? bodyLogsLoadedOnce : !dateLogsLoading)}
        showSleep={
          editTarget
            ? editTarget.sleepScore !== undefined
            : isDoseSlotPatient
              // dose_slot 환자: 그날 수면 미기록(!hasSleepToday) 상태에서, 이 기록의 약효추적 시점이
              //   "그날 첫(가장 이른) 약효추적 시점" 이상인 다음 약효추적 기록에서 수면 노출.
              //   [변경 이유] 기존엔 firstTrackingMin 과 '정확히 일치'할 때만 노출 → 아침 첫 약효추적
              //   알림을 껐거나 그 시점 진입을 놓치면 그날 수면을 남길 유일한 진입점이 사라졌다.
              //   미기록이면 "첫 시점 이후 첫 진입"에서 뜨도록 완화하고, hasSleepToday 로 하루 1회를 보장.
              ? (!hasSleepToday &&
                 currentTrackingMin !== null &&
                 trackingDayBounds.firstTrackingMin !== null &&
                 currentTrackingMin >= trackingDayBounds.firstTrackingMin)
              // legacy 환자: 그날 수면 미기록이면 노출(아침이 보통 첫 기록이라 자연히 아침 우선).
              //   미기록 조건이 곧 중복 방지 → 한 번 남기면 이후엔 안 뜬다(정확 일치 → 미기록 게이팅).
              : !hasSleepToday
        }
        showConstipation={
          editTarget
            ? editTarget.constipation !== undefined
            : isDoseSlotPatient
              // dose_slot 환자: 이 기록의 약효추적 시점이 "그날 마지막(가장 늦은) 약효추적 시점"과 일치할 때만.
              ? (currentTrackingMin !== null &&
                 trackingDayBounds.lastTrackingMin !== null &&
                 currentTrackingMin === trackingDayBounds.lastTrackingMin)
              // legacy 환자: 기존 meal_time 게이팅 유지(회귀 방지)
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
      <BrandProgressOverlay
        visible={saving}
        title={t('bodystate.savingTitle')}
        minVisibleMs={500}
        // 스피너 Modal이 완전히 사라진 뒤에만 후속 모달을 단독 present(두 Modal 적층 불가 → 멈춤 0).
        onHidden={() => {
          const p = pendingAfterSaveRef.current;
          pendingAfterSaveRef.current = null;
          if (!p) return;
          if (p.kind === 'alert') {
            dialog.alert({ title: p.title, message: p.message });
            return;
          }
          // kind === 'next' — 기존 표시 분기를 그대로 유지(언제만 onHidden 으로 미룸)
          const nextShown = !!p.info;
          if (p.info) {
            setNextNotifInfo(p.info);
            setShowNextNotifModal(true);
          }
          if (p.measurePhase) {
            // 다음 알림 모달이 떠있으면 그 닫힘 후 표시, 없으면 즉시 표시
            if (nextShown) {
              setPendingMeasureInvitePhase(p.measurePhase);
            } else {
              setMeasureInvitePhase(p.measurePhase);
              setShowMeasureInvite(true);
            }
          }
        }}
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
  const { t } = useTranslation();
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
        {/* 배지 + 시간 — 시간은 배지 바로 오른쪽에 붙임. flex:1 로 남는 폭을 차지하되
            영어 긴 트리거(예: "right after taking")면 배지가 줄고 텍스트는 …생략 → 우측 아이콘이 안 밀림. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
          <View style={{
            backgroundColor: badgeBg,
            borderRadius: 20,
            paddingHorizontal: 14,
            paddingVertical: 5,
            flexShrink: 1,
          }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: badgeText }}>
              {record.trigger}
            </Text>
          </View>
          <Text style={{ fontSize: 16, color: '#999', marginLeft: 10, flexShrink: 0 }}>{record.time}</Text>
        </View>
        {/* 수정/삭제 아이콘 — 오른쪽 유지(알림 설정과 동일 아이콘) */}
        {canCancel && (
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
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
        <Text style={[styles.scoreText, { color: scoreColor(record.bodyScore) }]}>
          {t('bodystate.scoreBody', { score: record.bodyScore })} {scoreEmoji(record.bodyScore)}
        </Text>
        {sep}
        <Text style={[styles.scoreText, { color: scoreColor(record.moodScore) }]}>
          {t('bodystate.scoreMood', { score: record.moodScore })} {scoreEmoji(record.moodScore)}
        </Text>
        {record.sleepScore !== undefined && (
          <>
            {sep}
            <Text style={[styles.scoreText, { color: scoreColor(record.sleepScore) }]}>
              {t('bodystate.scoreSleep', { score: record.sleepScore })} {scoreEmoji(record.sleepScore)}
            </Text>
          </>
        )}
        {record.constipation !== undefined && (
          <>
            {sep}
            <Text style={[styles.scoreText, { color: record.constipation ? '#B71C1C' : '#2E7D32' }]}>
              {record.constipation ? t('bodystate.constipationHas') : t('bodystate.constipationNone')}
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
  const { t } = useTranslation();
  // 색·아이콘은 시간대 키(period) 기준 유지, 표시 텍스트만 displayTitle
  const color = PERIOD_COLOR[period] ?? '#888';
  const iconTime = PERIOD_TIME[period] ?? '12:00';
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
      {/* 아이콘은 고정 폭 칼럼, 나머지(제목·효과추적·개수뱃지)는 그 오른쪽의 별도
          flexWrap 컨테이너에 넣는다 — 이렇게 해야 내용이 넘쳐 줄바뀜할 때 둘째 줄이
          아이콘 밑이 아니라 첫째 줄 텍스트가 시작한 위치에 맞춰 정렬된다(오너 지적, 2026-07-05). */}
      <View style={{
        backgroundColor: color,
        paddingHorizontal: 18,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
      }}>
        {/* 행은 flex-start(줄바꿈 정렬용)이라 아이콘은 첫 줄 높이(약 30)에 맞춰 세로 중앙 정렬.
            가로는 flex-start로 왼쪽 붙여 슬롯들끼리 아이콘 왼쪽선을 맞춘다. */}
        <View style={{ width: 34, height: 30, flexShrink: 0, justifyContent: 'center', alignItems: 'flex-start', marginRight: 8 }}>
          <SlotTimeIcon time={iconTime} size={28} color="#fff" />
        </View>
        {/* marginLeft(개별 여백) 대신 gap 사용 — marginLeft는 줄바뀜으로 그 항목이 새 줄
            맨 앞으로 가도 그대로 붙어있어 둘째 줄이 한 칸 밀려 보이는 원인이었다(오너 재지적, 2026-07-05).
            gap은 같은 줄 안의 항목 사이에만 여백을 주고, 새 줄 맨 앞 항목엔 안 붙는다. */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Text style={styles.hdrTitle}>{title}</Text>
          <Text style={styles.hdrEffect}>
            {t('bodystate.effectTracking')}
          </Text>
          <View style={{
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.25)',
          }}>
            <Text style={styles.hdrCount}>
              {t('bodystate.countUnit', { n: records.length })}
            </Text>
          </View>
        </View>
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

  // 시간대 섹션 헤더 텍스트 — StyleSheet 경유라 해외(en) 0.88 축소가 자동 적용된다(인라인이면 미적용).
  hdrTitle: { fontSize: 20, fontWeight: '700', color: '#fff', flexShrink: 1 },
  hdrEffect: { fontSize: 20, fontWeight: '700', color: '#fff' },
  hdrCount: { fontSize: 16, fontWeight: '700', color: '#fff' },
  scoreText: { fontSize: 18 },

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
    minHeight: 220,
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
    minHeight: 70,
    paddingVertical: 8,
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
  const { t } = useTranslation();
  const sheetBottomPad = useBottomSheetPadding(44, 24);
  if (!visible) return null;

  const now = new Date();
  const elapsedMin = medTime ? Math.round((now.getTime() - medTime.getTime()) / 60000) : null;
  const elapsedText = elapsedMin !== null
    ? elapsedMin < 60
      ? t('bodystate.elapsedUnderHour', { min: elapsedMin })
      : t('bodystate.elapsedOverHour', { h: Math.floor(elapsedMin / 60), m: elapsedMin % 60 })
    : null;

  // 이 시트는 '오늘 같은 시간대 기록이 이미 있을 때(중복)'에만 열린다.
  // 처음 선택된 시간대(selected) 라벨로 어느 시간대가 이미 기록됐는지 구체적으로 안내한다.
  const selectedLabel = selected
    ? options.find((o) => o.labelKey === selected)?.labelDisplay ?? null
    : null;
  const dupeText = selectedLabel
    ? t('bodystate.dupeWithLabel', { label: selectedLabel })
    : t('bodystate.dupeGeneric');

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={tsStyles.overlay}>
        <TouchableOpacity style={tsStyles.backdrop} activeOpacity={1} onPress={onDismiss} />
        <View style={[tsStyles.sheet, { paddingBottom: sheetBottomPad }]}>
          <View style={tsStyles.header}>
            <Text style={tsStyles.title}>{t('bodystate.triggerSelectTitle')}</Text>
            <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={26} color={Colors.textSub} />
            </TouchableOpacity>
          </View>

          <View style={tsStyles.medInfo}>
            <Text style={tsStyles.medTimeText}>{dupeText}</Text>
            {medTime && (
              <Text style={tsStyles.elapsedText}>
                {t('bodystate.medTakenLine', {
                  time: formatTime(medTime.toISOString()),
                  suffix: elapsedText ? ` · ${elapsedText}` : '',
                })}
              </Text>
            )}
          </View>

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
            <Text style={tsStyles.confirmBtnText}>{t('bodystate.triggerConfirm')}</Text>
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

const formatTimeHHMM_BS = formatClock;

const bsIntervalLabel = intervalAfterLabel;

const bsEffectTrackingLabel = effectTrackingLabel;

const bsNextDoseLabelLoc = nextDoseLabelLoc;


async function fetchNextNotifMessage(
  patientId: string,
  // 방금 "복용 직후"(triggerMinutes=0)로 기록한 복용의 약효추적 시점을 결정적으로 후보에 넣기 위한 정보.
  //  - 큐(effect_tracking_queue) 적재는 takeMedication 의 백그라운드 edge-function invoke 라,
  //    복용 직후 이 함수가 도는 시점엔 그 복용의 30분/2시간 후 약효추적이 아직 큐에 없을 수 있다(경합).
  //    그 결과 가장 가까운 약효추적이 누락되어 더 먼 "다음 복용/운동"이 최근접으로 잘못 선택된다.
  //  - 따라서 큐 도착을 기다리지 않고 takenAt + 슬롯 track_intervals(분) 시각을 직접 계산해 후보에 추가한다.
  //  - 복용 직후 진입에 한함: takenAt≈now 가 정확. 30분/2시간 알림 진입은 큐가 이미(복용 시점에) 적재돼
  //    있어 경합이 없으므로 전달하지 않는다(불필요한 변경 회피).
  justTaken?: { takenAt: Date; doseSlotId: string } | null,
): Promise<NextNotifInfo | null> {
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
        // DB 라벨은 비어 있다 — 슬롯 키/시각에서 표시명을 만든다.
        mealKo = qSlot ? slotDisplayName(null, qSlot.legacyKey, qSlot.time) : mealTimeToKorean(row.meal_time);
      } else {
        mealKo = mealTimeToKorean(row.meal_time);
      }

      const intervalLabel = bsIntervalLabel(intervalMin);
      const label = bsEffectTrackingLabel(mealKo, intervalLabel);
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

    // 0) 방금 "복용 직후" 기록한 복용의 약효추적 후보(결정적). 큐 적재 여부와 무관하게 항상 포함.
    //    슬롯 track_intervals 로 takenAt + 각 interval 시각을 직접 계산한다.
    //    (활성 슬롯 doseSlots 에서 trackEnabled/track_intervals 를 읽으므로 in-memory 스테일 영향 없음.)
    //    0(복용 직후)은 이미 지난 시점이라 제외하고, 미래 시점(예: 30분/2시간 후)만 후보로.
    if (justTaken) {
      const jSlot = doseSlots.find((s) => s.id === justTaken.doseSlotId);
      if (jSlot && jSlot.trackEnabled && jSlot.trackIntervals.length > 0) {
        const mealKo = slotDisplayName(null, jSlot.legacyKey, jSlot.time);
        for (const intervalMin of jSlot.trackIntervals) {
          if (!intervalMin || intervalMin <= 0) continue; // 0=복용직후(과거) 제외
          const sendAt = new Date(justTaken.takenAt.getTime() + intervalMin * 60000);
          if (sendAt <= now) continue; // 미래만
          const minutesLeft = Math.round((sendAt.getTime() - now.getTime()) / 60000);
          const intervalLabel = bsIntervalLabel(intervalMin);
          const label = bsEffectTrackingLabel(mealKo, intervalLabel);
          candidates.push({ minutesLeft, label, sendAt });
        }
      }
    }

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
          label: bsNextDoseLabelLoc(slot.legacyKey, slot.label, slot.time),
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
        const baseLabel = bsNextDoseLabelLoc(first.legacyKey, first.label, first.time);
        const tomorrowText = tomorrowLabel(baseLabel.replace(/^다음 /, ''));
        candidates.push({
          minutesLeft,
          label: tomorrowText,
          sendAt: tomorrowFirst,
        });
      }
    }

    // 3) 운동 알림 (exercise_notif_prefs) — 오늘 이후 가장 가까운 운동 알림 시간
    const exercisePrefs = userData?.exercise_notif_prefs as Array<{
      id: string; ampm: AmPm; hour: number; minute: number; enabled: boolean;
    }> | null;
    if (exercisePrefs && exercisePrefs.length > 0) {
      for (const ep of exercisePrefs) {
        if (!ep.enabled) continue;
        let hour = ep.hour;
        if (ep.ampm === 'pm' && hour !== 12) hour += 12;
        if (ep.ampm === 'am' && hour === 12) hour = 0;
        const scheduled = new Date(now);
        scheduled.setHours(hour, ep.minute, 0, 0);
        if (scheduled > now) {
          const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
          candidates.push({ minutesLeft, label: exerciseReminderLabel(), sendAt: scheduled });
        }
      }
    }

    // 최후 폴백: candidates가 비어있으면 내일 아침 08:00
    if (candidates.length === 0) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      return {
        label: tomorrowMorningDoseLabel(),
        timeStr: formatTimeHHMM_BS(tomorrow),
        minutesLeft: Math.round((tomorrow.getTime() - now.getTime()) / 60000),
      };
    }

    // dedup: 같은 분(minute)에 발송되는 중복 후보 제거.
    //   결정적 약효추적 후보(0번 섹션)와 큐 후보(1번 섹션)가 같은 시각(예: 복용 30분 후)을
    //   가리킬 수 있다. 큐 후보가 배열 앞에 있으므로 그쪽을 유지한다(라벨 동일).
    {
      const seen = new Set<number>();
      candidates = candidates.filter((c) => {
        const key = Math.floor(c.sendAt.getTime() / 60000);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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
  const { t } = useTranslation();
  // ⚠️ visible 로는 언마운트하지 않는다(info 만 가드). 닫힐 때 Modal 을 애니 도중 언마운트하면
  //    iOS 에서 모달 뷰가 남아 다음 팝업/버튼 터치를 막는다. Modal 은 항상 마운트, visible 로만 토글.
  if (!info) return null;

  const minutesText = formatDurationKo(info.minutesLeft);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={nnStyles.overlay}>
        <View style={nnStyles.card}>
          <Text style={nnStyles.icon}>🔔</Text>
          <Text style={nnStyles.title}>{t('bodystate.nextNotifTitle')}</Text>

          {/* 알림 종류 — 오렌지 배경 pill */}
          <View style={nnStyles.labelPill}>
            <Text style={nnStyles.labelPillText}>{info.label}</Text>
          </View>

          {/* 구체적 시간 — 크게 */}
          <Text style={nnStyles.timeText}>{info.timeStr}</Text>

          {/* 서브텍스트 */}
          <Text style={nnStyles.subText}>
            {t('bodystate.nextNotifSub', { minutes: minutesText })}
          </Text>

          <TouchableOpacity style={nnStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={nnStyles.closeBtnText}>{t('common.confirm')}</Text>
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
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={piStyles.overlay}>
        <View style={piStyles.card}>
          <Text style={piStyles.icon}>🔕</Text>
          <Text style={piStyles.title}>{t('bodystate.preRecordTitle')}</Text>
          <Text style={piStyles.message}>{message}</Text>
          <TouchableOpacity style={piStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={piStyles.closeBtnText}>{t('common.close')}</Text>
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
