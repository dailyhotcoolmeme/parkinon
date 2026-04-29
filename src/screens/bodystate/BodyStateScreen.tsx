import React, { useState, useEffect, useCallback } from 'react';
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
import { navigateTo } from '../../navigation/navigationRef';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useSettings } from '../../context/SettingsContext';
import { HistoryTimeline } from '../../components/common/HistoryTimeline';

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

function labelToMinutes(label: string): number | null {
  if (label === 'after_medication') return 0;
  const match = label.match(/^(\d+)min_after$/);
  if (match) return parseInt(match[1], 10);
  return null;
}

function labelToDeltaText(label: string): string {
  if (label === 'after_medication') return '직후';
  const match = label.match(/^(\d+)min_after$/);
  if (match) {
    const min = parseInt(match[1], 10);
    if (min < 60) return `+${min}분`;
    const h = Math.floor(min / 60);
    const rem = min % 60;
    return rem === 0 ? `+${h}시간` : `+${h}시간 ${rem}분`;
  }
  return label;
}

// 식사 구분 → 한국어 (실제 med_logs meal_time 기반)
const MEAL_KO: Record<string, string> = {
  morning: '아침', lunch: '점심', dinner: '저녁', bedtime: '취침',
};

// 기본 라벨 (동적 생성 실패 시 폴백용)
const DEFAULT_TRIGGER_LABEL: Record<string, string> = {
  after_medication: '복용 직후',
  '30min_after': '복용 30분 후',
  '2hour_after': '복용 2시간 후',
};

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

export function BodyStateScreen() {
  const { user } = useAuth();
  const { todayLogs, saveBodyState, fetchVideoLogs, getBodyStateLogs, refresh } = useBodyState();
  const [showFlow, setShowFlow] = useState(false);
  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [videoLogs, setVideoLogs] = useState<any[]>([]);
  const [dateLogs, setDateLogs] = useState<any[]>([]);
  const [pendingTriggerLabel, setPendingTriggerLabel] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [showTriggerSelect, setShowTriggerSelect] = useState(false);
  const [triggerMedTime, setTriggerMedTime] = useState<Date | null>(null);
  const [triggerModalSelected, setTriggerModalSelected] = useState<string | null>(null);
  const [pendingTriggeredBy, setPendingTriggeredBy] = useState<'notification' | 'manual'>('manual');
  const [showPreRecordInfo, setShowPreRecordInfo] = useState(false);
  const [preRecordMessage, setPreRecordMessage] = useState('');
  const [showNextNotifModal, setShowNextNotifModal] = useState(false);
  const [nextNotifInfo, setNextNotifInfo] = useState<NextNotifInfo | null>(null);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationBadge();
  const { medNotifs } = useSettings();

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

  // 알림 탭 진입 시 trigger_time_label 자동 설정
  useFocusEffect(
    React.useCallback(() => {
      const triggerMinutes = route.params?.triggerMinutes;
      if (triggerMinutes != null) {
        const label = minutesToLabel(triggerMinutes);
        // 알림 데이터에 meal_time이 있으면 우선 사용, 없으면 AsyncStorage 조회
        const paramMealTime = (route.params as any)?.triggerMealTime ?? null;
        setPendingTriggeredBy('notification');
        setPendingTriggerLabel(label);
        if (!showFlow) {
          if (paramMealTime) {
            openFlowWithDuplicateCheck(label, null, paramMealTime);
          } else {
            AsyncStorage.getItem('parkinon_last_medication')
              .then(raw => {
                if (!raw) { openFlowWithDuplicateCheck(label, null, null); return; }
                const parsed = JSON.parse(raw);
                const medTime = parsed.taken_at ? new Date(parsed.taken_at) : null;
                const mealTime = parsed.meal_time ?? null;
                openFlowWithDuplicateCheck(label, medTime, mealTime);
              })
              .catch(() => openFlowWithDuplicateCheck(label, null, null));
          }
        }
      }
    }, [route.params?.triggerMinutes, (route.params as any)?.triggerMealTime])
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

  const userRole: 'patient' | 'caregiver_no_patient' | 'caregiver_same' | 'caregiver_separate' =
    user?.role !== 'caregiver'
      ? 'patient'
      : !user.patient_group_id
      ? 'caregiver_no_patient'
      : user.residence_type === 'separate'
      ? 'caregiver_separate'
      : 'caregiver_same';

  const [patientName, setPatientName] = useState('환자');
  const [patientId, setPatientId] = useState<string | null>(null);

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

  // 표시할 로그: 오늘이면 todayLogs, 다른 날이면 dateLogs
  const activeLogs = isToday ? todayLogs : dateLogs;

  // medNotifs 기반 동적 라벨 생성
  const getTriggerLabel = (label: string): string => {
    if (!label) return '';
    if (DEFAULT_TRIGGER_LABEL[label]) return DEFAULT_TRIGGER_LABEL[label];
    if (label === 'after_medication') return '복용 직후';

    // "120min_after" 형식 — medNotifs 유무와 무관하게 변환
    const match = label.match(/^(\d+)min_after$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      if (minutes === 0) return '복용 직후';
      if (minutes < 60) return `복용 ${minutes}분 후`;
      const hours = Math.floor(minutes / 60);
      const rem = minutes % 60;
      return rem === 0 ? `복용 ${hours}시간 후` : `복용 ${hours}시간 ${rem}분 후`;
    }

    // "2hour_after" 형식 폴백
    const hourMatch = label.match(/^(\d+)hour_after$/);
    if (hourMatch) {
      return `복용 ${hourMatch[1]}시간 후`;
    }

    return '';
  };

  // 같은 시간대 배지가 오늘 이미 있으면 확인 후 팝업 오픈
  // mealTimeKey: 실제 med_logs.meal_time ('morning'|'lunch'|'dinner'|'bedtime')
  const openFlowWithDuplicateCheck = (labelKey: string, medTime: Date | null, mealTimeKey: string | null) => {
    // mealTimeKey가 있는 경우 — label + meal_time 모두 일치할 때만 중복으로 처리
    // (예: 점심약 복용 직후 기록이 있어도 저녁약 복용 직후 기록은 허용)
    const hasDuplicate = activeLogs.some((log: any) => {
      if (log.trigger_time_label !== labelKey) return false;
      // mealTimeKey가 지정된 경우 medication_meal_time도 일치해야 중복
      if (mealTimeKey && log.medication_meal_time && log.medication_meal_time !== mealTimeKey) return false;
      return true;
    });
    if (hasDuplicate) {
      const labelDisplay = getTriggerLabel(labelKey);
      const periodKo = mealTimeKey ? MEAL_KO[mealTimeKey] : (medTime ? getPeriod(medTime.toISOString()) : null);
      const periodText = periodKo ? `${periodKo}약 복용 ` : '';
      Alert.alert(
        '중복 기록 확인',
        `오늘 ${periodText}'${labelDisplay}' 기록이 이미 있어요.\n한 번 더 기록하시겠어요?`,
        [
          { text: '취소', style: 'cancel' },
          { text: '기록하기', onPress: () => setShowFlow(true) },
        ],
      );
    } else {
      setShowFlow(true);
    }
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

  // 버튼 탭 시 약 복용 시간 기반으로 트리거 라벨 자동 감지 or 모달 표시
  const handleOpenBodyState = async () => {
    setPendingTriggeredBy('manual');
    const intervals = getEnabledIntervals();
    let raw: string | null = null;
    try { raw = await AsyncStorage.getItem('parkinon_last_medication'); } catch {}

    if (!raw) {
      setTriggerMedTime(null);
      setTriggerModalSelected(intervals[0]?.labelKey ?? null);
      setShowTriggerSelect(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const { taken_at, meal_time: storedMealTime } = parsed;
      const medTime = new Date(taken_at);
      const elapsedMin = (Date.now() - medTime.getTime()) / 60000;

      let closest: typeof intervals[0] | null = null;
      let closestDiff = Infinity;
      for (const interval of intervals) {
        const diff = Math.abs(elapsedMin - interval.minutes);
        if (diff < closestDiff) { closestDiff = diff; closest = interval; }
      }

      if (closest && closestDiff <= 20) {
        // ±20분 이내 → 자동 배정
        setPendingTriggerLabel(closest.labelKey);
        openFlowWithDuplicateCheck(closest.labelKey, medTime, storedMealTime ?? null);
      } else {
        // 20분 초과 → 기록 불가 안내
        const periodKo = storedMealTime ? (MEAL_KO[storedMealTime] ?? getPeriod(medTime.toISOString())) : getPeriod(medTime.toISOString());
        const period = periodKo;
        const elapsedRound = Math.round(elapsedMin);
        let elapsedText: string;
        if (elapsedRound < 60) {
          elapsedText = `${elapsedRound}분`;
        } else {
          const h = Math.floor(elapsedRound / 60);
          const rem = elapsedRound % 60;
          elapsedText = rem === 0 ? `${h}시간` : `${h}시간 ${rem}분`;
        }

        // 다음 기록 가능 시간대 계산
        const futureIntervals = intervals
          .filter(iv => iv.minutes - elapsedMin > 20)
          .sort((a, b) => a.minutes - b.minutes);
        let nextMsg: string;
        if (futureIntervals.length > 0) {
          const next = futureIntervals[0];
          const minsLeft = Math.ceil(next.minutes - 20 - elapsedMin);
          nextMsg = `다음 기록 가능: ${next.labelDisplay} (약 ${minsLeft}분 후)`;
        } else {
          nextMsg = '오늘 기록 가능한 시간대가 모두 지났어요.';
        }

        Alert.alert(
          '지금은 기록할 수 없어요',
          `${period}약 복용 후 약 ${elapsedText}이 경과했어요.\n\n약효 추적 기록은 설정된 시간대의 ±20분 이내에만 기록할 수 있어요. 정확한 시간에 기록해야 의미 있는 데이터가 됩니다.\n\n${nextMsg}`,
          [{ text: '확인' }],
        );
      }
    } catch {
      setTriggerMedTime(null);
      setTriggerModalSelected(intervals[0]?.labelKey ?? null);
      setShowTriggerSelect(true);
    }
  };

  // DB 로그 → BodyRecord 변환
  const records: BodyRecord[] = activeLogs.map((log: any) => {
    const mealTimeKo = log.medication_meal_time ? MEAL_KO[log.medication_meal_time] : null;
    return {
      id: log.id,
      time: formatTime(log.logged_at),
      period: mealTimeKo ?? getPeriod(log.logged_at),
      trigger: (log.trigger_time_label && getTriggerLabel(log.trigger_time_label))
        || (log.triggered_by === 'notification' ? '알림' : '직접 입력'),
      triggeredBy: log.triggered_by ?? 'manual',
      bodyScore: log.body_state ?? 3,
      moodScore: log.mood ?? 3,
      sleepScore: log.sleep_quality ?? undefined,
      constipation: log.constipation ?? undefined,
    };
  });

  const handleSaveRecord = async (record: { bodyScore: number; moodScore: number; sleepScore?: number; constipation?: boolean }) => {
    // AsyncStorage에서 meal_time 읽기
    let medicationMealTime: string | undefined;
    try {
      const raw = await AsyncStorage.getItem('parkinon_last_medication');
      if (raw) {
        const { meal_time } = JSON.parse(raw);
        if (meal_time) medicationMealTime = meal_time;
      }
    } catch {}

    const success = await saveBodyState({
      body_state: record.bodyScore,
      mood: record.moodScore,
      sleep_quality: record.sleepScore,
      constipation: record.constipation,
      trigger_time_label: pendingTriggerLabel ?? undefined,
      medication_meal_time: medicationMealTime,
    }, pendingTriggeredBy);
    if (success) {
      const savedLabel = pendingTriggerLabel; // state 초기화 전 캡처
      setPendingTriggerLabel(null);
      setPendingTriggeredBy('manual');
      setHistoryRefreshKey(k => k + 1);
      if (route.params?.triggerMinutes != null) {
        navigation.setParams({ triggerMinutes: null });
      }
      setShowFlow(false);

      // 다음 예정 알림 조회 후 팝업 표시
      if (patientId) {
        fetchNextNotifMessage(patientId).then((info) => {
          if (info) {
            setNextNotifInfo(info);
            setShowNextNotifModal(true);
          }
        });
      }

      // 사전 기록 시 예약 알림 큐 취소 (0분 즉시 알림은 이미 발송됐을 가능성 높아 제외)
      const intervalMin = savedLabel ? labelToMinutes(savedLabel) : null;
      if (intervalMin != null && intervalMin > 0 && patientId) {
        try {
          let query = supabase
            .from('effect_tracking_queue')
            .select('id')
            .eq('patient_id', patientId)
            .eq('interval_minutes', intervalMin)
            .is('sent_at', null);
          // meal_time이 있으면 같은 식사 알림만 취소 (다른 식사 추적 보존)
          if (medicationMealTime) query = (query as any).eq('meal_time', medicationMealTime);
          const { data: queueItems } = await query;
          if (queueItems && queueItems.length > 0) {
            await supabase
              .from('effect_tracking_queue')
              .delete()
              .in('id', queueItems.map((q: any) => q.id));
            let periodKo = getPeriod(new Date().toISOString());
            try {
              const raw = await AsyncStorage.getItem('parkinon_last_medication');
              if (raw) {
                const { meal_time } = JSON.parse(raw);
                if (meal_time && MEAL_KO[meal_time]) periodKo = MEAL_KO[meal_time];
              }
            } catch {}
            const delta = labelToDeltaText(savedLabel!);
            setPreRecordMessage(
              `${periodKo}약 복용 ${delta} 후 몸상태 기록을 미리 남기셨어요.\n\n사전에 설정된 알림은 보내지 않을게요.`
            );
            setShowPreRecordInfo(true);
          }
        } catch {}
      }
    } else {
      Alert.alert('저장 실패', '몸상태 기록 저장에 실패했어요. 다시 시도해주세요.');
    }
  };

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
              (userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate') && styles.mainButtonDisabled,
            ]}
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

          <View style={styles.videoButtonRow}>
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
            ['취침', '저녁', '점심', '아침'].map(period => {
              const periodRecords = records.filter(r => r.period === period);
              if (periodRecords.length === 0) return null;
              return (
                <MealSectionCard key={period} period={period} records={periodRecords} />
              );
            })
          )}
        </View>

        {/* 과거 기록 보기 타임라인 */}
        <HistoryTimeline type="bodystate" patientId={patientId} refreshKey={historyRefreshKey} />
      </ScrollView>

      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={patientName}
        onConfirm={() => { setShowCaregiverConfirm(false); handleOpenBodyState(); }}
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
      <PreRecordInfoModal
        visible={showPreRecordInfo}
        message={preRecordMessage}
        onClose={() => setShowPreRecordInfo(false)}
      />
      <NextNotifModal
        visible={showNextNotifModal}
        info={nextNotifInfo}
        onClose={() => setShowNextNotifModal(false)}
      />
      <TriggerSelectModal
        visible={showTriggerSelect}
        medTime={triggerMedTime}
        options={getEnabledIntervals()}
        selected={triggerModalSelected}
        onSelect={setTriggerModalSelected}
        onConfirm={() => {
          if (!triggerModalSelected) return;
          setPendingTriggerLabel(triggerModalSelected);
          setShowTriggerSelect(false);
          openFlowWithDuplicateCheck(triggerModalSelected, triggerMedTime, null);
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

function RecordRow({ record, isLast }: { record: BodyRecord; isLast: boolean }) {
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
      {/* 트리거 배지 + 시간 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
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
        <Text style={{ fontSize: 16, color: '#999' }}>{record.time}</Text>
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

function MealSectionCard({ period, records }: { period: string; records: BodyRecord[] }) {
  const color = PERIOD_COLOR[period] ?? '#888';
  const icon = PERIOD_ICON[period] ?? '🕐';

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
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#fff' }}>{period}</Text>
        <Text style={{ fontSize: 16, color: 'rgba(255,255,255,0.85)', marginLeft: 8 }}>
          {records.length}개 기록
        </Text>
      </View>

      {/* 기록 행들 */}
      {records.map((rec, idx) => (
        <RecordRow key={rec.id} record={rec} isLast={idx === records.length - 1} />
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
  outlineButtonInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  outlineButtonText: { fontSize: 18, fontWeight: '700', color: Colors.primary },

  records: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, paddingHorizontal: 4 },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  emptySubText: { fontSize: 17, color: Colors.textHint, textAlign: 'center', lineHeight: 26 },
  caregiverNotice: {
    marginTop: 14,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
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
        <View style={tsStyles.sheet}>
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

const DEFAULT_MEAL_TIMES_BS: Record<string, string> = {
  morning: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  bedtime: '22:00',
};

function formatTimeHHMM_BS(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour}:${m.toString().padStart(2, '0')}`;
}

const MEAL_TIME_KO_BS: Record<string, string> = {
  morning: '아침약',
  lunch: '점심약',
  dinner: '저녁약',
  bedtime: '취침약',
};

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
      const mealKo = row.meal_time ? (MEAL_TIME_KO_BS[row.meal_time] ?? '') : '';

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

    const mealSchedules: Record<string, string> = (userData?.meal_schedules as Record<string, string>) ?? DEFAULT_MEAL_TIMES_BS;

    const MEAL_LABELS: Record<string, string> = {
      morning: '다음 아침약 복용',
      lunch: '다음 점심약 복용',
      dinner: '다음 저녁약 복용',
      bedtime: '다음 취침약 복용',
    };

    let foundMeal = false;
    for (const key of ['morning', 'lunch', 'dinner', 'bedtime']) {
      const timeStr = mealSchedules[key] ?? DEFAULT_MEAL_TIMES_BS[key];
      const [h, m] = timeStr.split(':').map(Number);
      const scheduled = new Date(now);
      scheduled.setHours(h, m, 0, 0);
      if (scheduled > now) {
        const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
        candidates.push({ minutesLeft, label: MEAL_LABELS[key], sendAt: scheduled });
        foundMeal = true;
        break;
      }
    }

    // 오늘 식사 시간이 모두 지난 경우 내일 아침 폴백
    if (!foundMeal) {
      const tomorrowMorning = new Date(now);
      tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
      const morningStr = mealSchedules['morning'] ?? DEFAULT_MEAL_TIMES_BS['morning'];
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
