import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Animated,
  Dimensions,
  Linking,
  AppState,
  InteractionManager,
  Platform,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useSettings, MedNotif, ExerciseNotif } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useDialog } from '../../context/DialogContext';
import { minutesToLabel } from '../../utils/medUtils';
import {
  ampmToHHMM,
  timeChangeImmediatePopup,
  turnOnImmediatePopup,
  turnOffImmediatePopup,
  deleteImmediatePopup,
} from '../../utils/notifActionFeedback';
import { ensureNotGuest } from '../../utils/guestGuard';
import { markMedNotifUserEdited } from '../../utils/medNotifRecommendationMeta';
import { supabase } from '../../lib/supabase';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { MenuStackParamList } from '../../navigation/MenuNavigator';
import {
  requestPermissionsAndSaveToken,
  scheduleMedicationReminders,
  scheduleExerciseReminders,
} from '../../utils/notifications';
import { provisionForUser } from '../../lib/alarmSound';
import { AlarmSoundPickerRow, AlarmSoundOption } from '../../components/common/AlarmSoundPickerRow';
import { ensurePatientDoseSlots } from '../../hooks/useDoseSlots';
import { MEASUREMENT_FEATURE_ENABLED } from '../../constants/featureFlags';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { isOverseasLocale } from '../../i18n/detectLocale';

interface CaregiverNotif {
  id: string;
  label: string;
  sub?: string;
  enabled: boolean;
}

const DEFAULT_CAREGIVER_NOTIFS: CaregiverNotif[] = [
  // 기본 OFF (오너 결정 2026-07-15): 보호자 알림은 전부 꺼진 채로 시작(저장값 없을 때 표시 기본값도 off).
  { id: 'med_taken', label: i18n.t('settings.notifMedTakenLabel'), sub: i18n.t('settings.notifMedTakenSub'), enabled: false },
  { id: 'med_missed', label: i18n.t('settings.notifMedMissedLabel'), sub: i18n.t('settings.notifMedMissedSub'), enabled: false },
  // 라벨 앞 '환자 ' 접두 → pt() 가 연동 환자 이름으로 치환("{환자명}님 몸상태·기분 기록 시").
  // 미연동 시엔 "환자"로 표시(fallback). 몸상태~변비 항목(운동 포함)만 접두.
  // 몸상태·기분은 환자가 항상 한 번에 기록 → 보호자 알림도 1개 → 토글 통합.
  // id는 발송부(useBodyState) 호환 위해 body_state 유지. 저장 시 mood도 같은 값으로 동기화.
  { id: 'body_state', label: i18n.t('settings.notifBodyStateLabel'), sub: i18n.t('settings.notifBodyStateSub'), enabled: false },
  { id: 'exercise', label: i18n.t('settings.notifExerciseLabel'), enabled: false },
  // 컨디션 측정 기능 숨김 시 측정 완료 알림도 비노출.
  ...(MEASUREMENT_FEATURE_ENABLED
    ? [{ id: 'measurement_completed', label: i18n.t('settings.notifMeasurementLabel'), sub: i18n.t('settings.notifMeasurementSub'), enabled: false }]
    : []),
  { id: 'sleep', label: i18n.t('settings.notifSleepLabel'), enabled: false },
  { id: 'constipation', label: i18n.t('settings.notifConstipationLabel'), enabled: false },
];

const STORAGE_KEY_CAREGIVER = 'settings_caregiver_notifs';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Data model ───────────────────────────────────────────────────────────────

const SLOT_ORDER: MedTimeSlotKey[] = ['morning', 'lunch', 'dinner', 'bedtime'];
// 갭 충돌 확인 다이얼로그(checkMealGapConflict)에만 쓰이는 표시용 문자열 — 로케일 분기 필요.
const SLOT_LABELS_KO: Record<string, string> = { morning: '아침', lunch: '점심', dinner: '저녁', bedtime: '취침' };
const SLOT_LABELS_EN: Record<string, string> = { morning: 'Morning', lunch: 'Lunch', dinner: 'Dinner', bedtime: 'Bedtime' };
const slotLabel = (key: string): string => (isOverseasLocale() ? SLOT_LABELS_EN : SLOT_LABELS_KO)[key];

function timeHHMMtoMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function checkMealGapConflict(
  minutes: number,
  slotTimes: Record<string, string>,
  activeSlots: MedTimeSlotKey[],
): { conflict: boolean; minGap: number; conflictPair: string } {
  const ordered = SLOT_ORDER.filter(s => activeSlots.includes(s));
  if (ordered.length < 2) return { conflict: false, minGap: Infinity, conflictPair: '' };

  let minGap = Infinity;
  let conflictPair = '';

  for (let i = 0; i < ordered.length - 1; i++) {
    const curr = ordered[i];
    const next = ordered[i + 1];
    const gap = timeHHMMtoMinutes(slotTimes[next] ?? '12:00') - timeHHMMtoMinutes(slotTimes[curr] ?? '08:00');
    if (gap > 0 && gap < minGap) {
      minGap = gap;
      conflictPair = `${slotLabel(curr)}(${slotTimes[curr]})~${slotLabel(next)}(${slotTimes[next]})`;
    }
  }

  return { conflict: minutes >= minGap, minGap, conflictPair };
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const sep = isOverseasLocale() ? ' ' : ''; // "2 Hour 30 Minute" vs "2시간 30분"
  const hourUnit = i18n.t('settings.hourUnit');
  const minuteUnit = i18n.t('settings.minuteUnit');
  if (h > 0 && m > 0) return `${h}${sep}${hourUnit} ${m}${sep}${minuteUnit}`;
  if (h > 0) return `${h}${sep}${hourUnit}`;
  return `${m}${sep}${minuteUnit}`;
}

const MED_TIME_OPTIONS = [0, 10, 30, 60, 90, 120, 180, 240];
const EXERCISE_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EXERCISE_MINUTES = [0, 10, 20, 30, 40, 50];

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// supabase-js .update()는 New Architecture에서 hang됨 → fetch API 직접 사용
async function patchUser(userId: string, accessToken: string, body: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

// 보호자가 "환자"의 알림 설정 컬럼을 수정할 때 사용.
// users UPDATE RLS는 본인 행만 허용하므로, 같은 그룹 검증 + 알림 컬럼만 갱신하는
// SECURITY DEFINER RPC(update_patient_notif_prefs)를 호출한다. body는 patchUser와 동일한
// 형태({ med_time_notif_prefs / med_notif_prefs / exercise_notif_prefs / meal_schedules })를 받는다.
async function patchPatientUser(patientId: string, accessToken: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_patient_notif_prefs`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_patient_id: patientId, p_prefs: body }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`환자 알림 설정 저장 실패 (HTTP ${res.status}): ${txt}`);
  }
  return res;
}

// ─── 전체 알림(마스터) 계산 ─────────────────────────────────────────────────────
// 전체 알림 표시 = 개별이 "전부 ON"일 때만 ON (select-all).
// notification_enabled(발송 게이트) = "하나라도 ON" — 켠 개별 알림은 실제 발송되도록.
function relevantMedTimeSlots(activeSlots: string[]): string[] {
  return activeSlots.length > 0 ? [...activeSlots, 'missed_first', 'missed_second'] : [];
}
function computeAnyNotifOn(
  medTime: Record<string, boolean>, activeSlots: string[],
  medN: { enabled: boolean }[], exN: { enabled: boolean }[],
): boolean {
  const slots = relevantMedTimeSlots(activeSlots);
  return slots.some(s => !!medTime[s]) || medN.some(n => n.enabled) || exN.some(n => n.enabled);
}
// ─── Component ────────────────────────────────────────────────────────────────

// label은 legacy 시간대 삭제 확인 다이얼로그(deleteMedSlot)에만 쓰이는 표시용 문자열이라
// 로케일 분기 필요 — 해외에서 한글 라벨이 영문 문장에 섞여 나오던 버그(2026-07).
const MED_TIME_SLOTS = [
  { key: 'morning', label: isOverseasLocale() ? 'Morning' : '아침' },
  { key: 'lunch',   label: isOverseasLocale() ? 'Lunch' : '점심' },
  { key: 'dinner',  label: isOverseasLocale() ? 'Dinner' : '저녁' },
  { key: 'bedtime', label: isOverseasLocale() ? 'Bedtime' : '취침' },
] as const;

type MedTimeSlotKey = 'morning' | 'lunch' | 'dinner' | 'bedtime';

// 매 렌더 새 객체가 생기지 않도록 trackColor를 모듈 상수로 고정 (Fabric 재커밋 방지)
const SWITCH_TRACK_COLOR = { false: Colors.border, true: Colors.primary };

/**
 * New Architecture(Fabric)에서 거대한 화면이 한 프레임에 리렌더되지 못하면 컨트롤드 Switch가
 * value prop을 늦게 받아 "옛값으로 잠깐 튀었다가" 새값으로 가는 문제가 있다.
 * 스위치 값을 작은 래퍼의 로컬 state로 분리해, 탭 즉시 가볍게 리렌더 → 네이티브에 곧바로 반영되게 한다.
 * 부모 value가 실제로 바뀌면(원격/로드) 동기화한다.
 */
function OptimisticSwitch({ value, onValueChange, style }: { value: boolean; onValueChange: (v: boolean) => void; style?: StyleProp<ViewStyle> }) {
  const [shown, setShown] = useState(value);
  useEffect(() => { setShown(value); }, [value]);
  return (
    <Switch
      style={style}
      value={shown}
      onValueChange={(v) => { setShown(v); onValueChange(v); }}
      trackColor={SWITCH_TRACK_COLOR}
      thumbColor={Colors.white}
    />
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const navigation = useNavigation<StackNavigationProp<MenuStackParamList>>();
  const insets = useSafeAreaInsets();
  const isCaregiver = user?.role === 'caregiver';
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();
  const route = useRoute<RouteProp<MenuStackParamList, 'Settings'>>();

  // 온보딩 직후 강제 진입(guideCaregiverNotif) 시 1회 안내 팝업 — 여기서 보호자 알림 켜기 안내.
  const caregiverGuideShownRef = useRef(false);
  useEffect(() => {
    if (route.params?.guideCaregiverNotif && !caregiverGuideShownRef.current) {
      caregiverGuideShownRef.current = true;
      setTimeout(() => {
        dialog.alert({ title: t('settings.caregiverGuideTitle'), message: t('settings.caregiverGuideMsg') });
      }, 350);
    }
  }, [route.params?.guideCaregiverNotif]);

  // Settings context (shared with Records screens)
  const {
    medNotifs, setMedNotifs,
    exerciseNotifs, setExerciseNotifs,
    notificationEnabled, setNotificationEnabled, setNotificationEnabledOnly,
    systemPermissionGranted, recheckSystemPermission,
    syncGlobalFromIndividual,
    applyRemoteNotifPrefs,
  } = useSettings();

  // 약 복용 시간 알림 per-slot 설정
  const [medTimePrefs, setMedTimePrefs] = useState<Record<string, boolean>>({
    morning: true, lunch: true, dinner: true, bedtime: true,
    missed_first: true, missed_second: true,
  });
  // ⚠️ 옛 5초 가드 ref(medTimeLocalWriteAtRef / notifPrefsLocalWriteAtRef /
  //    patientPrefsLocalWriteAtRef)는 제거했다. users 가 REPLICA IDENTITY FULL +
  //    realtime publication 이라 payload.new 가 항상 커밋된 최신값 → 가드 없이도
  //    되돌아가지 않는다(dose_slots 와 동일 원리).
  // 미복용 알림음 선택 행(무거운 expo-av 컴포넌트)을 토글과 같은 프레임에 mount/unmount하면
  // 네이티브 Switch 애니메이션이 튄다 → 표시 여부를 한 틱 늦춰 스위치 전환을 먼저 끝낸다.
  const [showMissedSound, setShowMissedSound] = useState({ first: false, second: false });
  const [medSlotTimes, setMedSlotTimes] = useState<Record<MedTimeSlotKey, string>>({
    morning: '08:00', lunch: '12:00', dinner: '18:00', bedtime: '22:00',
  });
  const [activeMedSlots, setActiveMedSlots] = useState<MedTimeSlotKey[]>([]);
  // 약 미복용 알림 카드 노출 여부 — activeMedSlots(레거시 meal_times 4슬롯 기준)와는 별도.
  // dose_slots(새 유연한 시간대) 기반으로 복용을 등록한 환자(해외판 등)는 medications.meal_times가
  // 항상 []로 저장돼 activeMedSlots가 비어버려 카드가 안 보이는 문제가 있었다 — dose_slots 개수도
  // 함께 확인해 "어떤 방식으로든 복용 시간이 설정돼 있으면" 노출되게 한다.
  const [hasAnyDoseSetup, setHasAnyDoseSetup] = useState(false);
  // 약 시간 슬롯별 목소리 (slot → custom_sound_id | null). 없으면 기본 목소리
  const [medTimeSounds, setMedTimeSounds] = useState<Record<string, string | null>>({});
  // 약 미복용 알림 전용 알림음 (1차/2차 각각). null=기본음
  const [missedMedSounds, setMissedMedSounds] = useState<{ first: string | null; second: string | null }>({
    first: null, second: null,
  });
  const [hasMedicationRegistered, setHasMedicationRegistered] = useState(false);

  // 환자 알림 수정 (보호자용)
  const [showPatientNotifs, setShowPatientNotifs] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);
  // 보호자 환자 로드 완료 여부 — 로딩 중(false)과 "연동 환자 없음(true+patientId null)"을 구분.
  // 깜빡임/오판 방지: 이 값이 true가 되기 전엔 환자/미연동 어느 쪽도 단정하지 않음.
  const [patientLoadDone, setPatientLoadDone] = useState(false);
  const [linkedPatientName, setLinkedPatientName] = useState<string | null>(null);
  // 실제 연동 환자 id가 해석됐는지로 판정 (역할만 보지 않음). 로딩 끝(patientLoadDone) +
  // patientId non-null 일 때만 환자용 항목 노출. 로딩 중에는 어느 쪽도 단정 안 함(깜빡임 방지).
  const hasLinkedPatient = isCaregiver && patientLoadDone && patientId != null;
  const showCaregiverEmptyLink = isCaregiver && patientLoadDone && patientId == null;
  const [patientMedTimePrefs, setPatientMedTimePrefs] = useState<Record<string, boolean>>({
    morning: true, lunch: true, dinner: true, bedtime: true,
    missed_first: true, missed_second: true,
  });
  const [patientActiveMedSlots, setPatientActiveMedSlots] = useState<MedTimeSlotKey[]>([]);
  const [patientMedSlotTimes, setPatientMedSlotTimes] = useState<Record<MedTimeSlotKey, string>>({
    morning: '08:00', lunch: '12:00', dinner: '18:00', bedtime: '22:00',
  });
  const [patientMedNotifs, setPatientMedNotifs] = useState<MedNotif[]>([]);
  const [patientExerciseNotifs, setPatientExerciseNotifs] = useState<ExerciseNotif[]>([]);
  // 환자의 약 미복용 1차/2차 알림음 (보호자가 대신 설정). null=기본음
  const [patientMissedMedSounds, setPatientMissedMedSounds] = useState<{ first: string | null; second: string | null }>({
    first: null, second: null,
  });
  // 그룹 녹음 목록 (알림별 소리 선택용)
  const [alarmSounds, setAlarmSounds] = useState<AlarmSoundOption[]>([]);
  // 환자의 전체 알림(마스터) 상태 — '환자 알림 수정' 토글 게이팅에 사용.
  // (보호자 자신의 notificationEnabled가 아니라 환자 값으로 표시해야 일치함)
  const [patientNotificationEnabled, setPatientNotificationEnabled] = useState(true);

  // 약 복용 시간 알림 설정 로드 + 약 관리에서 설정한 실제 시간 조회
  const loadMedTimePrefs = React.useCallback(async () => {
    if (!user || isCaregiver) return;
    try {
      // 서로 의존하지 않는 4개 조회를 병렬화(users / missed_med_sound_prefs / medications /
      // dose_slots count). 각 조회는 개별 가드 — 하나가 실패해도 나머지는 진행.
      // ensure(dose_slots 부트스트랩)만 users.data 에 의존하므로 뒤에서 순차 처리한다.
      const [usersRes, missedRes, medsRes, slotCountRes] = await Promise.all([
        supabase
          .from('users')
          .select('med_time_notif_prefs, med_time_sound_prefs, meal_schedules')
          .eq('id', user.id)
          .single(),
        supabase
          .from('missed_med_sound_prefs' as any)
          .select('first_sound_id, second_sound_id')
          .eq('user_id', user.id)
          .maybeSingle()
          .then((r: any) => r, () => ({ data: null })),
        supabase
          .from('medications')
          .select('meal_times, meal_schedules')
          .eq('patient_id', user.id)
          .eq('is_active', true),
        supabase
          .from('dose_slots')
          .select('id', { count: 'exact', head: true })
          .eq('patient_id', user.id)
          .eq('is_active', true)
          .then((r: any) => r, () => ({ count: null })),
      ]);
      const data = usersRes.data;
      // 약 미복용(missed_first/second)·복용시간 토글은 med_time_notif_prefs 블롭에 저장된다.
      // 초기 진입 시 1회 로드(이 select)로 채우고, 이후 변경은 realtime payload.new 가 반영한다.
      // (read-after-write 로 방금 토글한 값을 덮을 수 있어 5초 가드를 두던 것을 제거 —
      //  realtime 이 최신값을 주므로 가드 없이도 되돌아가지 않는다. dose_slots 와 동일 원리.)
      if (data?.med_time_notif_prefs) {
        setMedTimePrefs(prev => ({ ...prev, ...((data.med_time_notif_prefs as Record<string, boolean>) ?? {}) }));
      }
      if (data?.med_time_sound_prefs) {
        setMedTimeSounds((data.med_time_sound_prefs as Record<string, string | null>) ?? {});
      }
      // 약 미복용 알림 전용 알림음 (1차/2차)
      const missed = (missedRes as any)?.data;
      setMissedMedSounds({
        first: (missed as any)?.first_sound_id ?? null,
        second: (missed as any)?.second_sound_id ?? null,
      });
      // 약 관리에서 설정한 실제 복용 시간 (슬롯별 가장 이른 시간)
      const meds = (medsRes as any)?.data;
      let legacySlotsFound = true; // meds 없으면 기본 4슬롯이 채워지므로 true가 기존 동작과 동일.
      if (meds?.length) {
        setHasMedicationRegistered(true);
        const earliest: Record<string, string> = {};
        const activeSlots = new Set<string>();
        for (const med of meds) {
          const sched = (med.meal_schedules ?? {}) as Record<string, string>;
          for (const slot of (med.meal_times ?? []) as string[]) {
            const t = sched[slot];
            if (t) {
              activeSlots.add(slot);
              if (!earliest[slot] || t < earliest[slot]) earliest[slot] = t;
            }
          }
        }
        setMedSlotTimes(prev => ({ ...prev, ...earliest }));
        setActiveMedSlots(Array.from(activeSlots) as MedTimeSlotKey[]);
        legacySlotsFound = activeSlots.size > 0;
      } else {
        setHasMedicationRegistered(false);
        // 약 등록 없으면 users.meal_schedules에서 시간 가져오기, 기본 4개 슬롯 활성화
        const userMealSchedules = (data?.meal_schedules ?? {}) as Record<string, string>;
        const defaultTimes = {
          morning: userMealSchedules.morning || '08:00',
          lunch: userMealSchedules.lunch || '12:00',
          dinner: userMealSchedules.dinner || '18:00',
          bedtime: userMealSchedules.bedtime || '22:00',
        };
        setMedSlotTimes(defaultTimes);
        setActiveMedSlots(['morning', 'lunch', 'dinner', 'bedtime']);
      }

      // 약 미복용 알림 카드 노출 게이트 — legacy meal_times 4슬롯이 비어 있어도(예: dose_slots
      // 기반으로 약을 등록한 해외판 환자라 medications.meal_times가 항상 []인 경우)
      // dose_slots 개수가 있으면 "복용 시간이 설정돼 있다"로 본다.
      const doseSlotCount = (slotCountRes as any)?.count ?? 0;
      setHasAnyDoseSetup(legacySlotsFound || doseSlotCount > 0);

      // ── 세트카드용 dose_slots 부트스트랩 ────────────────────────────────────
      // 미이관/온보딩 직후라 dose_slots 가 0개인 환자만 legacy meal_schedules 기준으로
      // 4슬롯을 생성한다. 이미 dose_slots 가 있으면 건드리지 않는다(6단계에서 직접 수정하므로
      // ensure 의 멱등 update 가 사용자가 세트카드에서 바꾼 값을 되돌리지 않게).
      try {
        const count = (slotCountRes as any)?.count;
        if (!count || count === 0) {
          const enabledMin = (medNotifs ?? [])
            .filter(n => n.enabled && n.minutes > 0)
            .map(n => n.minutes);
          await ensurePatientDoseSlots(
            user.id,
            (data?.meal_schedules ?? null) as any,
            (data?.med_time_notif_prefs ?? null) as any,
            enabledMin.length > 0 ? enabledMin : null,
          );
        }
      } catch (e) {
        console.warn('[SettingsScreen] dose_slots 부트스트랩 실패(계속):', e);
      }
    } catch {}
  }, [user, isCaregiver, medNotifs]);

  const toggleMedTimeSlot = async (slot: string) => {
    const prev = medTimePrefs;
    const willEnable = !prev[slot];
    const next = { ...prev, [slot]: willEnable };
    setMedTimePrefs(next);
    // 발송 게이트(notification_enabled) = "하나라도 ON" (전체 토글 표시는 별도로 select-all)
    const anyOn = computeAnyNotifOn(next, activeMedSlots, medNotifs, exerciseNotifs);
    if (anyOn !== notificationEnabled) setNotificationEnabledOnly(anyOn);
    try {
      // fetch API 직접 사용 (supabase-js New Architecture hang 우회)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('세션이 만료되었어요');
      await patchUser(user!.id, session.access_token, { med_time_notif_prefs: next });
      // 결과 안내: 약 미복용 알림은 즉시형. (missed_first/second 토글만 호출됨)
      await dialog.alert(
        willEnable
          ? {
              title: t('settings.turnedOnMissedTitle'),
              message: t('settings.turnedOnMissedMsg'),
            }
          : {
              title: t('settings.turnedOffMissedTitle'),
              message: t('settings.turnedOffMissedMsg'),
            },
      );
    } catch (e) {
      console.error('[SettingsScreen] toggleMedTimeSlot 저장 실패:', e);
      setMedTimePrefs(prev);
      await dialog.alert({ title: t('settings.saveFailTitle'), message: t('settings.saveNotifFailMsg') });
    }
  };

  // supabase-js New Architecture hang 방지용 timeout 유틸
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`supabase query timeout after ${ms}ms`)), ms)
      ),
    ]);
  }

  const loadPatientNotifPrefs = React.useCallback(async (externalToken?: string) => {
    // 그룹 자체가 없는 보호자 → 즉시 "로드 완료, 연동 환자 없음" 확정
    if (!user || !isCaregiver || !user.patient_group_id) {
      if (isCaregiver) { setPatientId(null); setPatientLoadDone(true); }
      return;
    }
    try {
      // supabase-js New Architecture hang 방지 → raw fetch 사용
      // externalToken: useFocusEffect에서 이미 getSession()을 호출했으면 그 토큰을 그대로 사용
      let accessToken = externalToken ?? '';
      if (!accessToken) {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token ?? '';
      }
      const headers: Record<string, string> = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      };

      // 1. 환자 ID 조회 (raw fetch)
      const pgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/patient_group_members?group_id=eq.${user.patient_group_id}&role=eq.patient&select=user_id&limit=1`,
        { headers }
      );
      const pgData = await pgRes.json();
      const pid = pgData[0]?.user_id;
      if (!pid) {
        console.warn('[SettingsScreen] 환자 ID 없음, pgData:', pgData);
        // 그룹은 있으나 환자 멤버가 없음 → 미연동으로 확정
        setPatientId(null);
        setPatientLoadDone(true);
        return;
      }
      setPatientId(pid);
      setPatientLoadDone(true);

      // 2~3. pid 에만 의존하고 서로 독립인 3개 조회를 병렬로 시작
      //   (users / 환자 미복용 알림음 RPC / medications). 결과는 아래에서 순서대로 처리.
      const userResP = fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${pid}&select=med_time_notif_prefs,med_notif_prefs,exercise_notif_prefs,meal_schedules,name,notification_enabled&limit=1`,
        { headers }
      );
      const missedResP = fetch(`${SUPABASE_URL}/rest/v1/rpc/get_patient_missed_med_sound`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_patient_id: pid }),
      }).catch(() => null);
      const medsResP = fetch(
        `${SUPABASE_URL}/rest/v1/medications?patient_id=eq.${pid}&is_active=eq.true&select=meal_times,meal_schedules`,
        { headers }
      );

      // 2. 환자의 알림 설정 + 이름
      const userRes = await userResP;
      const userData = await userRes.json();
      const patientUser = userData[0];

      if (patientUser?.name) {
        setLinkedPatientName(patientUser.name);
      } else {
        // 보안: 환자 user 객체(이름·역할·그룹 등 PII)는 로그에 남기지 않음
        console.warn('[SettingsScreen] 환자 name이 없음');
      }
      // 환자의 전체 알림(마스터) 상태 — '환자 알림 수정' 토글 게이팅용
      setPatientNotificationEnabled(patientUser?.notification_enabled ?? true);
      if (patientUser?.med_time_notif_prefs) {
        setPatientMedTimePrefs(prev => ({ ...prev, ...patientUser.med_time_notif_prefs }));
      }
      if (patientUser?.med_notif_prefs) {
        setPatientMedNotifs((patientUser.med_notif_prefs as MedNotif[]).filter(n => n.minutes !== 0));
      } else {
        setPatientMedNotifs([
          { id: '2', minutes: 30, enabled: true },
          { id: '3', minutes: 120, enabled: true },
        ]);
      }
      if (patientUser?.exercise_notif_prefs) {
        setPatientExerciseNotifs(patientUser.exercise_notif_prefs as ExerciseNotif[]);
      } else {
        setPatientExerciseNotifs([
          { id: '1', ampm: '오후', hour: 2, minute: 0, enabled: true },
        ]);
      }

      // 2-1. 환자의 약 미복용 1차/2차 알림음 (own-only RLS → SECURITY DEFINER RPC 경유)
      try {
        const msRes = await missedResP;
        if (msRes && msRes.ok) {
          const msData = await msRes.json();
          const row = Array.isArray(msData) ? msData[0] : msData;
          setPatientMissedMedSounds({
            first: row?.first_sound_id ?? null,
            second: row?.second_sound_id ?? null,
          });
        }
      } catch (e) {
        console.warn('[SettingsScreen] 환자 미복용 알림음 로드 실패(계속):', e);
      }

      // 3. 환자의 활성 약 슬롯 + 복용 시간 (위에서 병렬로 시작한 medsResP 결과 사용)
      const medsRes = await medsResP;
      const meds = await medsRes.json();

      if (Array.isArray(meds) && meds.length > 0) {
        const earliest: Record<string, string> = {};
        const activeSlots = new Set<string>();
        for (const med of meds) {
          const sched = (med.meal_schedules ?? {}) as Record<string, string>;
          for (const slot of (med.meal_times ?? []) as string[]) {
            const t = sched[slot];
            if (t) {
              activeSlots.add(slot);
              if (!earliest[slot] || t < earliest[slot]) earliest[slot] = t;
            }
          }
        }
        setPatientMedSlotTimes(prev => ({ ...prev, ...earliest }));
        setPatientActiveMedSlots(Array.from(activeSlots) as MedTimeSlotKey[]);
      } else {
        // 약 등록 없으면 users.meal_schedules에서 시간 가져오기, 기본 4개 슬롯 활성화
        const userMealSchedules = (patientUser?.meal_schedules ?? {}) as Record<string, string>;
        const defaultTimes = {
          morning: userMealSchedules.morning || '08:00',
          lunch: userMealSchedules.lunch || '12:00',
          dinner: userMealSchedules.dinner || '18:00',
          bedtime: userMealSchedules.bedtime || '22:00',
        };
        setPatientMedSlotTimes(defaultTimes);
        setPatientActiveMedSlots(['morning', 'lunch', 'dinner', 'bedtime']);
      }
    } catch (e) {
      console.error('[SettingsScreen] 환자 정보 로드 오류:', e);
    }
  }, [user, isCaregiver]);

  const togglePatientMedTimeSlot = async (slot: string) => {
    if (!patientId) return;
    const prev = patientMedTimePrefs;
    const prevMaster = patientNotificationEnabled;
    const next = { ...prev, [slot]: !prev[slot] };
    setPatientMedTimePrefs(next);
    // 발송 게이트 = "하나라도 ON" (전체 토글 표시는 별도로 select-all)
    const anyOn = computeAnyNotifOn(next, patientActiveMedSlots, patientMedNotifs, patientExerciseNotifs);
    setPatientNotificationEnabled(anyOn);
    try {
      // fetch API 직접 사용 (supabase-js New Architecture hang 우회)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('세션이 만료되었어요');
      await patchPatientUser(patientId, session.access_token, { med_time_notif_prefs: next, notification_enabled: anyOn });
    } catch (e) {
      console.error('[SettingsScreen] togglePatientMedTimeSlot 저장 실패:', e);
      setPatientMedTimePrefs(prev);
      setPatientNotificationEnabled(prevMaster);
      await dialog.alert({ title: t('settings.saveFailTitle'), message: t('settings.savePatientNotifFailMsg') });
    }
  };

  // 보호자 알림 설정
  const [caregiverNotifs, setCaregiverNotifs] = useState<CaregiverNotif[]>(DEFAULT_CAREGIVER_NOTIFS);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_CAREGIVER).then(raw => {
      if (raw) {
        const saved: CaregiverNotif[] = JSON.parse(raw);
        setCaregiverNotifs(prev => prev.map(n => {
          const found = saved.find(s => s.id === n.id);
          return found ? { ...n, enabled: found.enabled } : n;
        }));
      }
    }).catch(() => {});
  }, []);

  // 미복용 알림음 행 표시를 토글 프레임에서 분리 (스위치 애니메이션 먼저 끝낸 뒤 mount/unmount)
  useEffect(() => {
    const first = !!medTimePrefs['missed_first'];
    const second = !!medTimePrefs['missed_second'];
    const task = InteractionManager.runAfterInteractions(() => {
      setShowMissedSound((prev) =>
        prev.first === first && prev.second === second ? prev : { first, second },
      );
    });
    return () => task.cancel();
  }, [medTimePrefs]);

  // 보호자 알림 토글 저장의 신뢰성 가드.
  // - 저장이 setState 업데이터 내부의 fire-and-forget이던 기존 구조는
  //   ① 실패해도 UI엔 반영/ DB엔 미반영 ② 포커스 리로드가 DB(낡은 값)로 로컬을 덮어씀
  //   → OFF가 DB에 안 남고 ON으로 되돌아가는 버그가 있었음.
  // - caregiverWriteSeq: 저장 진행 중 포커스 리로드가 stale 값으로 덮지 못하게 막는 시퀀스.
  const caregiverWriteSeq = useRef(0);
  // 포커스 리로드 중복 가드: 동시/연속 포커스 이벤트로 같은 로더가 겹쳐 도는 것을 막는다.
  //  - focusLoadInFlight: 진행 중이면 새 포커스 로드를 스킵(설정 변경 반영은 realtime 이 담당).
  //  - lastFocusLoadAt: 직전 로드 후 짧은 창(1.5초) 안의 재포커스는 과도 재조회만 줄이려 스킵.
  const focusLoadInFlight = useRef(false);
  const lastFocusLoadAt = useRef(0);

  const toggleCaregiverNotif = async (id: string) => {
    const prevNotifs = caregiverNotifs;
    const next = prevNotifs.map(n => n.id === id ? { ...n, enabled: !n.enabled } : n);
    const prefs: Record<string, boolean> = {};
    next.forEach(n => { prefs[n.id] = n.enabled; });
    // 몸상태·기분 토글 통합: UI엔 body_state 하나뿐이라 mood 키가 누락/stale 될 수 있어
    // 발송부(useBodyState) 호환을 위해 mood를 body_state와 같은 값으로 동기 저장.
    prefs.mood = prefs.body_state;
    // 발송 게이트(notification_enabled) = 보호자 알림이 "하나라도 ON"
    const masterAnyOn = next.some(n => n.enabled);

    // 낙관적 UI 반영 + 로컬 변경 표시(리로드 가드)
    const seq = ++caregiverWriteSeq.current;
    setCaregiverNotifs(next);
    await AsyncStorage.setItem(STORAGE_KEY_CAREGIVER, JSON.stringify(next)).catch(() => {});

    // DB에 신뢰성 있게 저장 (supabase 클라이언트가 토큰 자동 갱신 → 401 silent fail 방지)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('세션 없음');
      const { error } = await supabase
        .from('users')
        .update({ caregiver_notif_prefs: prefs, notification_enabled: masterAnyOn })
        .eq('id', session.user.id);
      if (error) throw error;
    } catch (e) {
      console.error('[SettingsScreen] caregiver_notif_prefs 저장 실패:', e);
      // 저장 실패 → 그 사이 다른 토글이 없었다면 UI/AsyncStorage 롤백 + 사용자 안내
      if (caregiverWriteSeq.current === seq) {
        setCaregiverNotifs(prevNotifs);
        await AsyncStorage.setItem(STORAGE_KEY_CAREGIVER, JSON.stringify(prevNotifs)).catch(() => {});
        await dialog.alert({
          title: t('settings.saveFailTitle'),
          message: t('settings.saveNotifFailMsg'),
        });
      }
    }
  };

  // 전체 알림 토글 → 현재 사용자 역할의 개별 알림 일괄 반영 (DB까지 저장).
  // - 보호자: 보호자 개별 알림(caregiver_notif_prefs) 전체 ON/OFF
  // - 환자: 약 복용 시간/미복용(med_time_notif_prefs) 전체 ON/OFF
  //   (약효 추적/운동은 SettingsContext.setNotificationEnabled에서 함께 처리)
  const cascadeMasterToIndividual = React.useCallback(async (enabled: boolean) => {
    if (isCaregiver) {
      const next = caregiverNotifs.map(n => ({ ...n, enabled }));
      caregiverWriteSeq.current += 1; // 포커스 리로드 클로버 방지
      setCaregiverNotifs(next);
      const prefs: Record<string, boolean> = {};
      next.forEach(n => { prefs[n.id] = n.enabled; });
      // 몸상태·기분 토글 통합 → mood를 body_state와 동기 저장(발송부 호환).
      prefs.mood = prefs.body_state;
      await AsyncStorage.setItem(STORAGE_KEY_CAREGIVER, JSON.stringify(next)).catch(() => {});
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { error } = await supabase
            .from('users')
            .update({ caregiver_notif_prefs: prefs })
            .eq('id', session.user.id);
          if (error) throw error;
        }
      } catch (e) {
        console.error('[SettingsScreen] 전체→보호자 개별 일괄 저장 실패:', e);
      }
    } else {
      const SLOT_KEYS = ['morning', 'lunch', 'dinner', 'bedtime', 'missed_first', 'missed_second'];
      const next: Record<string, boolean> = { ...medTimePrefs };
      Object.keys(next).forEach(k => { next[k] = enabled; });
      SLOT_KEYS.forEach(k => { next[k] = enabled; });
      setMedTimePrefs(next);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token && user) {
          await patchUser(user.id, session.access_token, { med_time_notif_prefs: next });
        }
      } catch (e) {
        console.error('[SettingsScreen] 전체→환자 시간알림 일괄 저장 실패:', e);
      }
    }
  }, [isCaregiver, caregiverNotifs, medTimePrefs, user]);

  const handleRefreshPushToken = async () => {
    // 게스트(테스트로 둘러보기) 차단 — Supabase 세션 자체가 없음
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    try {
      // 진행 표시는 흐름을 막지 않도록 토스트로(원래 Alert도 비차단)
      dialog.alert({ message: '알림 설정을 다시 등록하고 있어요…', toast: true });

      // 1. Expo Push Token 획득
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await dialog.alert({ title: '알림 권한 없음', message: '기기 설정에서 알림 권한을 허용해주세요.' });
        return;
      }

      const token = await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId,
      });

      if (!token?.data) {
        await dialog.alert({ title: '실패', message: '토큰 획득 실패' });
        return;
      }

      // 2. DB에 저장 (fetch 사용, supabase-js 절대 사용 금지)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        await dialog.alert({ title: '실패', message: '로그인 세션 없음' });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        await dialog.alert({ title: '실패', message: '사용자 정보 없음' });
        return;
      }

      const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

      const response = await fetch(`${SUPA_URL}/rest/v1/users?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ push_token: token.data, push_platform: Platform.OS }),
      });

      if (!response.ok) {
        const error = await response.text();
        await dialog.alert({ title: '실패', message: `DB 저장 실패: ${response.status}\n${error}` });
        return;
      }

      await dialog.alert({ title: '성공', message: `알림 토큰이 등록되었습니다!\n\n토큰: ${token.data.substring(0, 30)}...` });
    } catch (error: any) {
      await dialog.alert({ title: '오류', message: error.message });
    }
  };

  // 배터리 최적화 안내 모달

  // 알림 차단 상태 바텀시트
  const [showPermissionSheet, setShowPermissionSheet] = useState(false);
  const [pendingOn, setPendingOn] = useState(false); // 토글 시각적 ON 유지용

  // 환자용 picker state
  const [patientPickerVisible, setPatientPickerVisible] = useState(false);
  const [patientPickerType, setPatientPickerType] = useState<'med' | 'exercise'>('med');
  const [editingPatientMedId, setEditingPatientMedId] = useState<string | null>(null);
  const [patientSelectedMinutes, setPatientSelectedMinutes] = useState(30);
  const [editingPatientExerciseId, setEditingPatientExerciseId] = useState<string | null>(null);
  const [patientPickerExTime, setPatientPickerExTime] = useState<{ ampm: '오전' | '오후'; hour: number; minute: number }>({
    ampm: '오후', hour: 2, minute: 0,
  });
  const patientFadeAnim = useRef(new Animated.Value(0)).current;
  const patientSlideAnim = useRef(new Animated.Value(300)).current;

  // Modal / picker state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerType, setPickerType] = useState<'med' | 'exercise' | 'medSlot'>('med');
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [selectedMinutes, setSelectedMinutes] = useState(0);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editingMedSlotKey, setEditingMedSlotKey] = useState<MedTimeSlotKey | null>(null);
  const [pickerExTime, setPickerExTime] = useState<{ ampm: '오전' | '오후'; hour: number; minute: number }>({
    ampm: '오후',
    hour: 2,
    minute: 0,
  });

  // 화면 포커스 시 시스템 알림 권한 + DB에서 notification_enabled + caregiver_notif_prefs 재로드
  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        // 중복 가드: 이미 로드 중이거나 직전 1.5초 내 로드했다면 스킵(과도 재조회 방지).
        // 설정 변경 반영은 realtime payload.new 가 담당하므로 stale 위험 없음.
        if (focusLoadInFlight.current) return;
        if (Date.now() - lastFocusLoadAt.current < 1500) return;
        focusLoadInFlight.current = true;
        try {
          // 보호자 토글이 저장 중일 때 이 리로드가 끝나면, 그 사이 저장이 있었는지 비교해
          // stale DB 값으로 로컬을 덮어쓰지 않도록 시퀀스를 스냅샷한다.
          const caregiverSeqAtStart = caregiverWriteSeq.current;
          // 1. 시스템 알림 권한 상태 먼저 재확인 (설정에서 차단/허용 후 돌아왔을 때 반영)
          await recheckSystemPermission();

          // 2. DB에서 설정 로드
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) return;
          const { data: userRow } = await supabase
            .from('users')
            .select('notification_enabled, caregiver_notif_prefs')
            .eq('id', session.user.id)
            .single();
          if (userRow != null) {
            // 시스템 권한 상태를 최종 확인해서 연동
            const { status } = await Notifications.getPermissionsAsync();
            const dbEnabled = userRow.notification_enabled ?? true;
            // 'granted'가 아닌 경우 false로 강제 설정 (denied, blocked 등 모든 비허용 상태)
            // 단, 'undetermined'는 아직 팝업 미표시 상태 → DB 값 그대로 유지
            // setNotificationEnabledOnly: 개별 알림 state를 건드리지 않고 전체 토글만 동기화
            const forceOff = status !== 'granted' && status !== 'undetermined';
            await setNotificationEnabledOnly(forceOff ? false : dbEnabled);

            // 리로드 도중 사용자가 토글했다면(시퀀스 변동) DB 값으로 덮지 않는다.
            if (isCaregiver && userRow.caregiver_notif_prefs && caregiverWriteSeq.current === caregiverSeqAtStart) {
              const prefs = userRow.caregiver_notif_prefs as Record<string, boolean>;
              setCaregiverNotifs(prev => prev.map(n => ({
                ...n,
                enabled: prefs[n.id] !== undefined ? prefs[n.id] : n.enabled,
              })));
            }
          }
          // 3. 약 복용 시간 알림 설정 로드
          await loadMedTimePrefs();
          // 4. 환자 알림 설정 로드 (보호자만) - 이미 얻은 session 토큰 재사용
          await loadPatientNotifPrefs(session?.access_token);
          // ⚠️ 환자(본인)의 med_notif_prefs/exercise_notif_prefs 는 포커스마다 재조회하지
          //    않는다. 초기값은 SettingsContext 마운트 로드가, 보호자가 바꾼 cross-user
          //    갱신은 realtime payload.new 가 책임진다(dose_slots 와 동일 원리). 포커스
          //    재조회는 방금 쓴 값을 read-after-write 로 덮어쓰는 stale-read 원인이라 제거.
          //    (이 제거로 notifPrefsLocalWriteAtRef 5초 가드도 불필요해졌다.)
        } catch (e) {
          console.warn('[SettingsScreen] 설정 로드 오류:', e);
        } finally {
          focusLoadInFlight.current = false;
          lastFocusLoadAt.current = Date.now();
        }
      })();
    }, [setNotificationEnabledOnly, isCaregiver, recheckSystemPermission, loadMedTimePrefs, loadPatientNotifPrefs])
  );


  // AppState 리스너: 설정 앱에서 복귀 시 권한 재확인
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active' && showPermissionSheet) {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted') {
          setShowPermissionSheet(false);
          setPendingOn(false);
          await setNotificationEnabled(true);
          await cascadeMasterToIndividual(true);
          await scheduleMedicationReminders();
          // 운동 알림은 서버 푸시(send-medication-reminders 섹션4) 전담.
          // 로컬 잔여 알림 정리만 수행 (인자 미사용).
          await scheduleExerciseReminders([]);
        }
        // denied면 그대로 유지 (바텀시트 열린 채)
      }
    });
    return () => subscription.remove();
  }, [showPermissionSheet, setNotificationEnabled, cascadeMasterToIndividual]);

  // ─── 실시간 동기화 (환자 ↔ 보호자) ────────────────────────────────────────────
  // - 환자: 자기 user 행 구독 → 보호자가 바꾸면 즉시 반영 (로컬 state만, DB 재쓰기 X → 에코 방지)
  // - 보호자: 연동 환자 user 행 구독 → 환자가 바꾸면 '환자 알림 수정' 섹션 즉시 갱신
  useEffect(() => {
    if (!user) return;
    const targetId = isCaregiver ? patientId : user.id;
    if (!targetId) return; // 보호자: patientId 확정 후 구독

    const topic = `settings-sync-${targetId}`;
    // 같은 topic 의 잔존 채널 제거(재진입 시 이미 subscribe() 된 채널 재사용 →
    // .on() 추가 시도 크래시 방지).
    supabase
      .getChannels()
      .filter((c) => c.topic === `realtime:${topic}` || c.topic === topic)
      .forEach((c) => { supabase.removeChannel(c); });

    const channel = supabase.channel(topic);
    channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${targetId}` },
        (payload) => {
          const row = payload.new as Record<string, any>;
          // ⚠️ dose_slots 와 동일한 원리: users 테이블은 REPLICA IDENTITY FULL + realtime
          //    publication 포함이라 payload.new 는 "방금 커밋된 최신 행 전체"다.
          //    (자기 쓰기든 상대 쓰기든) 항상 최신값이므로 복제 지연 race 가 없다 →
          //    payload.new 를 그대로 로컬 state 에 반영한다. 옛 5초 가드/재조회 땜질 제거.
          if (isCaregiver) {
            // 환자가 바꾼 값을 '환자 알림 수정' 섹션에 즉시 반영 (로컬 state만, DB 재쓰기 X).
            if (typeof row.notification_enabled === 'boolean') {
              setPatientNotificationEnabled(row.notification_enabled);
            }
            if (row.med_time_notif_prefs) {
              setPatientMedTimePrefs(prev => ({ ...prev, ...row.med_time_notif_prefs }));
            }
            if (row.med_notif_prefs) {
              setPatientMedNotifs((row.med_notif_prefs as MedNotif[]).filter(n => n.minutes !== 0));
            }
            if (row.exercise_notif_prefs) {
              setPatientExerciseNotifs(row.exercise_notif_prefs as ExerciseNotif[]);
            }
          } else {
            // 보호자가 바꾼 내 설정을 내 화면에 즉시 반영 (DB 재쓰기 없는 적용).
            applyRemoteNotifPrefs(row);
            if (row.med_time_notif_prefs) {
              setMedTimePrefs(prev => ({ ...prev, ...row.med_time_notif_prefs }));
            }
          }
        },
      )
      // ⚠️ 미복용 알림음(missed_med_sound_prefs)도 dose_slots 와 동일 구조로 동기화.
      //    이 테이블은 REPLICA IDENTITY FULL + realtime publication 포함(마이그레이션)이라
      //    payload.new 가 커밋된 최신 행이다. INSERT/UPDATE(upsert) 모두 잡도록 event:'*'.
      //    보호자는 group-read RLS(is_same_patient_group)로 환자 행을 받고, 환자는 own-row 로 받는다.
      //    → 자기/상대 쓰기 모두 payload.new 직접 반영(가드/재조회 없음) → 되돌아감 0.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'missed_med_sound_prefs', filter: `user_id=eq.${targetId}` },
        (payload) => {
          const row = payload.new as Record<string, any> | null;
          if (!row) return;
          const next = {
            first: (row.first_sound_id ?? null) as string | null,
            second: (row.second_sound_id ?? null) as string | null,
          };
          if (isCaregiver) {
            setPatientMissedMedSounds(next);
          } else {
            setMissedMedSounds(next);
          }
          // 알림음 채널 재프로비저닝(상대가 바꾼 소리로 즉시 채널 갱신).
          provisionForUser(targetId, user.patient_group_id ?? null).catch(() => {});
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, isCaregiver, patientId, applyRemoteNotifPrefs]);

  // ─── Animation refs ─────────────────────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(300)).current;

  // ─── Picker open/close ──────────────────────────────────────────────────────
  const openPicker = (type: 'med' | 'exercise', medId?: string | null) => {
    setPickerType(type);

    if (type === 'med') {
      const id = medId ?? null;
      setEditingMedId(id);
      if (id) {
        const existing = medNotifs.find((n) => n.id === id);
        setSelectedMinutes(existing ? existing.minutes : 30);
      } else {
        setSelectedMinutes(30);
      }
    } else {
      const exId = medId ?? null;
      setEditingExerciseId(exId);
      if (exId) {
        const existing = exerciseNotifs.find((n) => n.id === exId);
        setPickerExTime(existing
          ? { ampm: existing.ampm, hour: existing.hour, minute: existing.minute }
          : { ampm: '오전', hour: 8, minute: 0 });
      } else {
        setPickerExTime({ ampm: '오전', hour: 8, minute: 0 });
      }
    }

    setPickerVisible(true);
    fadeAnim.setValue(0);
    slideAnim.setValue(300);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
      }),
    ]).start();
  };

  const closePicker = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setPickerVisible(false);
    });
  };

  // ─── 환자용 Picker 함수 ──────────────────────────────────────────────────────
  const openPatientPicker = (type: 'med' | 'exercise', id?: string | null) => {
    setPatientPickerType(type);
    if (type === 'med') {
      setEditingPatientMedId(id ?? null);
      if (id) {
        const existing = patientMedNotifs.find(n => n.id === id);
        setPatientSelectedMinutes(existing ? existing.minutes : 30);
      } else {
        setPatientSelectedMinutes(30);
      }
    } else {
      setEditingPatientExerciseId(id ?? null);
      if (id) {
        const existing = patientExerciseNotifs.find(n => n.id === id);
        setPatientPickerExTime(existing
          ? { ampm: existing.ampm, hour: existing.hour, minute: existing.minute }
          : { ampm: '오후', hour: 2, minute: 0 });
      } else {
        setPatientPickerExTime({ ampm: '오후', hour: 2, minute: 0 });
      }
    }
    setPatientPickerVisible(true);
    patientFadeAnim.setValue(0);
    patientSlideAnim.setValue(300);
    Animated.parallel([
      Animated.timing(patientFadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(patientSlideAnim, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
    ]).start();
  };

  // onClosed: 피커 Modal이 완전히 닫힌 뒤 실행. iOS에서 Modal 중첩(피커+경고 dialog)으로
  // 화면이 멈추는 문제를 막기 위해, 경고/다음 Modal은 반드시 이 콜백에서 띄운다.
  const closePatientPicker = (onClosed?: () => void) => {
    Animated.parallel([
      Animated.timing(patientFadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(patientSlideAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setPatientPickerVisible(false);
      if (onClosed) setTimeout(onClosed, 50); // Modal 해제가 네이티브에 반영될 여유
    });
  };

  // 환자 알림 설정 DB 저장(보호자용). 피커 Modal을 먼저 닫은 뒤 경고/저장을 처리해
  // iOS Modal 중첩 멈춤을 피한다.
  const persistPatientPrefs = async (body: Record<string, unknown>, prevSnapshot: () => void) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('세션이 만료되었어요');
      await patchPatientUser(patientId!, session.access_token, body);
    } catch (e) {
      console.error('[SettingsScreen] 환자 알림 설정 저장 실패:', e);
      prevSnapshot(); // 실패 시 롤백
      dialog.alert({ title: t('settings.saveFailTitle'), message: t('settings.savePatientNotifFailMsg') });
    }
  };

  const savePatientMedTime = async () => {
    if (!patientId) return;
    const isDuplicate = editingPatientMedId
      ? patientMedNotifs.some(n => n.id !== editingPatientMedId && n.minutes === patientSelectedMinutes)
      : patientMedNotifs.some(n => n.minutes === patientSelectedMinutes);
    if (isDuplicate) {
      closePatientPicker(() => dialog.alert({ title: t('settings.duplicateNotifTitle'), message: t('settings.duplicateNotifMsg') }));
      return;
    }
    const { conflict, minGap, conflictPair } = checkMealGapConflict(patientSelectedMinutes, patientMedSlotTimes, patientActiveMedSlots);
    if (conflict) {
      closePatientPicker(() => dialog.alert({
        title: t('settings.mealGapConflictTitle'),
        message: t('settings.mealGapConflictMsg', { pair: conflictPair, gap: formatMinutes(minGap), maxGap: formatMinutes(minGap - 1) }),
      }));
      return;
    }
    const prev = patientMedNotifs;
    const next = editingPatientMedId
      ? [...patientMedNotifs.map(n => n.id === editingPatientMedId ? { ...n, minutes: patientSelectedMinutes } : n)]
          .sort((a, b) => a.minutes - b.minutes)
      : [...patientMedNotifs, { id: Date.now().toString(), minutes: patientSelectedMinutes, enabled: true }]
          .sort((a, b) => a.minutes - b.minutes);
    setPatientMedNotifs(next);
    closePatientPicker();
    await persistPatientPrefs({ med_notif_prefs: next }, () => setPatientMedNotifs(prev));
  };

  const savePatientExerciseTime = async () => {
    if (!patientId) return;
    const newTotal = toTotal24hMinutes(patientPickerExTime);
    const isDuplicate = editingPatientExerciseId
      ? patientExerciseNotifs.some(n => n.id !== editingPatientExerciseId && toTotal24hMinutes(n) === newTotal)
      : patientExerciseNotifs.some(n => toTotal24hMinutes(n) === newTotal);
    if (isDuplicate) {
      closePatientPicker(() => dialog.alert({ title: t('settings.duplicateNotifTitle'), message: t('settings.duplicateNotifMsg') }));
      return;
    }
    const prev = patientExerciseNotifs;
    const next = editingPatientExerciseId
      ? [...patientExerciseNotifs.map(n => n.id === editingPatientExerciseId ? { ...n, ...patientPickerExTime } : n)]
          .sort((a, b) => toTotal24hMinutes(a) - toTotal24hMinutes(b))
      : [...patientExerciseNotifs, { id: Date.now().toString(), ...patientPickerExTime, enabled: true }]
          .sort((a, b) => toTotal24hMinutes(a) - toTotal24hMinutes(b));
    setPatientExerciseNotifs(next);
    closePatientPicker();
    await persistPatientPrefs({ exercise_notif_prefs: next }, () => setPatientExerciseNotifs(prev));
  };

  const togglePatientMedNotif = async (id: string) => {
    if (!patientId) return;
    const next = patientMedNotifs.map(n => n.id === id ? { ...n, enabled: !n.enabled } : n);
    setPatientMedNotifs(next);
    // 발송 게이트 = "하나라도 ON"
    const anyOn = computeAnyNotifOn(patientMedTimePrefs, patientActiveMedSlots, next, patientExerciseNotifs);
    setPatientNotificationEnabled(anyOn);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) await patchPatientUser(patientId, session.access_token, { med_notif_prefs: next, notification_enabled: anyOn });
  };

  const togglePatientExerciseNotif = async (id: string) => {
    if (!patientId) return;
    const next = patientExerciseNotifs.map(n => n.id === id ? { ...n, enabled: !n.enabled } : n);
    setPatientExerciseNotifs(next);
    // 발송 게이트 = "하나라도 ON"
    const anyOn = computeAnyNotifOn(patientMedTimePrefs, patientActiveMedSlots, patientMedNotifs, next);
    setPatientNotificationEnabled(anyOn);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) await patchPatientUser(patientId, session.access_token, { exercise_notif_prefs: next, notification_enabled: anyOn });
  };

  const deletePatientMedNotif = async (id: string) => {
    if (!patientId) return;
    const ok = await dialog.confirm({
      title: t('settings.deleteNotifTitle'),
      message: t('settings.deleteNotifMsg'),
      confirmText: t('settings.deleteNotifConfirm'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    const next = patientMedNotifs.filter(n => n.id !== id);
    setPatientMedNotifs(next);
    // fetch API 직접 사용 (supabase-js New Architecture hang 우회)
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) await patchPatientUser(patientId!, session.access_token, { med_notif_prefs: next });
  };

  const deletePatientExerciseNotif = async (id: string) => {
    if (!patientId) return;
    const ok = await dialog.confirm({
      title: t('settings.deleteNotifTitle'),
      message: t('settings.deleteNotifMsg'),
      confirmText: t('settings.deleteNotifConfirm'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    const next = patientExerciseNotifs.filter(n => n.id !== id);
    setPatientExerciseNotifs(next);
    // fetch API 직접 사용 (supabase-js New Architecture hang 우회)
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) await patchPatientUser(patientId!, session.access_token, { exercise_notif_prefs: next });
  };

  // 환자 운동 알림 항목의 알림음 변경(보호자) → exercise_notif_prefs[].soundId 저장(기존 RPC).
  // 환자 본인 setExerciseSound 와 동일 구조(soundId 필드). 환자 채널 재프로비저닝은 환자 기기에서 처리.
  const setPatientExerciseSound = async (id: string, soundId: string | null) => {
    if (!patientId) return;
    const prev = patientExerciseNotifs;
    const next = patientExerciseNotifs.map(n => (n.id === id ? { ...n, soundId } : n));
    setPatientExerciseNotifs(next);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('세션이 만료되었어요');
      await patchPatientUser(patientId, session.access_token, { exercise_notif_prefs: next });
      provisionForUser(patientId, user?.patient_group_id ?? null).catch(() => {});
    } catch (e) {
      console.error('[SettingsScreen] 환자 운동 알림음 저장 실패:', e);
      setPatientExerciseNotifs(prev);
      dialog.alert({ title: t('settings.saveFailTitle'), message: t('settings.savePatientSoundFailMsg') });
    }
  };

  // 환자 약 미복용 1차/2차 알림음 변경(보호자) → own-only RLS 우회 RPC.
  const setPatientMissedMedSound = async (phase: 'first' | 'second', soundId: string | null) => {
    if (!patientId) return;
    const prev = patientMissedMedSounds;
    setPatientMissedMedSounds(p => ({ ...p, [phase]: soundId }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('세션이 만료되었어요');
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_patient_missed_med_sound`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_patient_id: patientId, p_phase: phase, p_sound_id: soundId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      provisionForUser(patientId, user?.patient_group_id ?? null).catch(() => {});
    } catch (e) {
      console.error('[SettingsScreen] 환자 미복용 알림음 저장 실패:', e);
      setPatientMissedMedSounds(prev);
      dialog.alert({ title: t('settings.saveFailTitle'), message: t('settings.savePatientSoundFailMsg') });
    }
  };

  // ─── Sort helpers ───────────────────────────────────────────────────────────
  const toTotal24hMinutes = (n: { ampm: '오전' | '오후'; hour: number; minute: number }) => {
    const h24 = n.ampm === '오후' ? (n.hour === 12 ? 12 : n.hour + 12) : (n.hour === 12 ? 0 : n.hour);
    return h24 * 60 + n.minute;
  };

  // ─── Handlers ───────────────────────────────────────────────────────────────

  // 그룹 녹음 목록 로드 (알림별 소리 선택용)
  useEffect(() => {
    if (!user?.patient_group_id) { setAlarmSounds([]); return; }
    supabase
      .from('custom_sounds' as any)
      .select('id, label, public_url')
      .eq('group_id', user.patient_group_id)
      .order('created_at', { ascending: false })
      .then(({ data }: any) => {
        setAlarmSounds(
          ((data as any[]) ?? []).map((s) => ({
            id: s.id,
            label: s.label?.trim() || t('settings.myRecording'),
            previewUrl: s.public_url ?? null,
          })),
        );
      });
  }, [user?.patient_group_id]);

  // 약효 알림 항목의 소리 변경 → 저장 + 채널 재프로비저닝
  const setMedSound = (id: string, soundId: string | null) => {
    setMedNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, soundId } : n)));
    if (user) provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
  };
  // 운동 알림 항목의 소리 변경 → exercise_notif_prefs[].soundId 저장(context setExerciseNotifs가 DB persist)
  const setExerciseSound = (id: string, soundId: string | null) => {
    setExerciseNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, soundId } : n)));
    if (user) provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
  };
  // 약 시간 슬롯(아침/점심/저녁/취침) 목소리 변경 → DB 저장 + 재프로비저닝
  const setMedTimeSound = (slot: string, soundId: string | null) => {
    setMedTimeSounds((prev) => {
      const next = { ...prev, [slot]: soundId };
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) patchUser(session.user.id, session.access_token, { med_time_sound_prefs: next });
      }).catch(() => {});
      return next;
    });
    if (user) provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
  };
  // 약 미복용 알림 전용 알림음 변경 (1차/2차) → DB upsert + 재프로비저닝
  const setMissedMedSound = (phase: 'first' | 'second', soundId: string | null) => {
    setMissedMedSounds((prev) => ({ ...prev, [phase]: soundId }));
    if (!user) return;
    const column = phase === 'first' ? 'first_sound_id' : 'second_sound_id';
    supabase
      .from('missed_med_sound_prefs' as any)
      .upsert({ user_id: user.id, [column]: soundId, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) console.error('[SettingsScreen] 미복용 알림음 저장 실패:', error);
      });
    provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
  };

  const toggleMed = (id: string) => {
    const next = medNotifs.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n));
    setMedNotifs(next);
    // 사용자 수동 수정 — 추천 보존 플래그 잠금 (§13-6)
    markMedNotifUserEdited();
    // 발송 게이트(notification_enabled) = "하나라도 ON" (전체 토글은 별도로 select-all 표시)
    const anyOn = computeAnyNotifOn(medTimePrefs, activeMedSlots, next, exerciseNotifs);
    if (anyOn !== notificationEnabled) setNotificationEnabledOnly(anyOn);
  };

  const deleteMed = async (id: string) => {
    const ok = await dialog.confirm({
      title: t('settings.deleteNotifTitle'),
      message: t('settings.deleteNotifMsg'),
      confirmText: t('settings.deleteNotifConfirm'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setMedNotifs((prev) => prev.filter((n) => n.id !== id));
    // 사용자 수동 수정 — 추천 보존 플래그 잠금 (§13-6)
    markMedNotifUserEdited();
  };

  const saveMedTime = () => {
    const isDuplicate = editingMedId
      ? medNotifs.some(n => n.id !== editingMedId && n.minutes === selectedMinutes)
      : medNotifs.some(n => n.minutes === selectedMinutes);
    if (isDuplicate) {
      dialog.alert({ title: t('settings.duplicateNotifTitle'), message: t('settings.duplicateNotifMsg') });
      return;
    }
    const { conflict, minGap, conflictPair } = checkMealGapConflict(selectedMinutes, medSlotTimes, activeMedSlots);
    if (conflict) {
      dialog.alert({
        title: t('settings.mealGapConflictTitle'),
        message: t('settings.mealGapConflictMsg', { pair: conflictPair, gap: formatMinutes(minGap), maxGap: formatMinutes(minGap - 1) }),
      });
      return;
    }
    if (editingMedId) {
      setMedNotifs((prev) =>
        [...prev.map((n) => n.id === editingMedId ? { ...n, minutes: selectedMinutes } : n)]
          .sort((a, b) => a.minutes - b.minutes)
      );
    } else {
      setMedNotifs((prev) =>
        [...prev, { id: Date.now().toString(), minutes: selectedMinutes, enabled: true }]
          .sort((a, b) => a.minutes - b.minutes)
      );
    }
    // 사용자 수동 수정(추가/시간변경) — 추천 보존 플래그 잠금 (§13-6)
    markMedNotifUserEdited();
    closePicker();
  };

  const toggleExercise = (id: string) => {
    const target = exerciseNotifs.find((n) => n.id === id);
    const willEnable = target ? !target.enabled : true;
    const next = exerciseNotifs.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n));
    setExerciseNotifs(next);
    // 발송 게이트(notification_enabled) = "하나라도 ON"
    const anyOn = computeAnyNotifOn(medTimePrefs, activeMedSlots, medNotifs, next);
    if (anyOn !== notificationEnabled) setNotificationEnabledOnly(anyOn);
    // 결과 안내: 운동 알림은 즉시형(켜기=시각 지났는지 / 끄기=즉시 중단).
    if (target) {
      dialog.alert(
        willEnable ? turnOnImmediatePopup(ampmToHHMM(target)) : turnOffImmediatePopup(),
      );
    }
  };

  const deleteExercise = async (id: string) => {
    const ok = await dialog.confirm({
      title: t('settings.deleteNotifTitle'),
      message: t('settings.deleteNotifMsg'),
      confirmText: t('settings.deleteNotifConfirm'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setExerciseNotifs((prev) => prev.filter((n) => n.id !== id));
    dialog.alert(deleteImmediatePopup());
  };

  const saveExerciseTime = () => {
    const newTotal = toTotal24hMinutes(pickerExTime);
    const isDuplicate = editingExerciseId
      ? exerciseNotifs.some(n => n.id !== editingExerciseId && toTotal24hMinutes(n) === newTotal)
      : exerciseNotifs.some(n => toTotal24hMinutes(n) === newTotal);
    if (isDuplicate) {
      dialog.alert({ title: t('settings.duplicateNotifTitle'), message: t('settings.duplicateNotifMsg') });
      return;
    }
    if (editingExerciseId) {
      setExerciseNotifs((prev) =>
        [...prev.map((n) => n.id === editingExerciseId ? { ...n, ...pickerExTime } : n)]
          .sort((a, b) => toTotal24hMinutes(a) - toTotal24hMinutes(b))
      );
    } else {
      setExerciseNotifs((prev) =>
        [...prev, { id: Date.now().toString(), ...pickerExTime, enabled: true }]
          .sort((a, b) => toTotal24hMinutes(a) - toTotal24hMinutes(b))
      );
    }
    closePicker();
    // 결과 안내: 운동 알림 시간 변경/추가는 즉시형(시각 지났는지).
    dialog.alert(timeChangeImmediatePopup(ampmToHHMM(pickerExTime)));
  };

  const openMedSlotPicker = (slotKey: MedTimeSlotKey) => {
    setPickerType('medSlot');
    setEditingMedSlotKey(slotKey);

    // 현재 시간을 HH:MM → { ampm, hour, minute } 형태로 변환
    const currentTime = medSlotTimes[slotKey];
    const [hStr, mStr] = currentTime.split(':');
    const h24 = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);

    let ampm: '오전' | '오후';
    let hour: number;

    if (h24 === 0) {
      ampm = '오전';
      hour = 12;
    } else if (h24 < 12) {
      ampm = '오전';
      hour = h24;
    } else if (h24 === 12) {
      ampm = '오후';
      hour = 12;
    } else {
      ampm = '오후';
      hour = h24 - 12;
    }

    setPickerExTime({ ampm, hour, minute });
    setPickerVisible(true);
    fadeAnim.setValue(0);
    slideAnim.setValue(300);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
      }),
    ]).start();
  };

  const saveMedSlotTime = async () => {
    if (!editingMedSlotKey) return;

    // { ampm, hour, minute } → HH:MM 24시간 형식으로 변환
    let h24: number;
    if (pickerExTime.ampm === '오전') {
      h24 = pickerExTime.hour === 12 ? 0 : pickerExTime.hour;
    } else {
      h24 = pickerExTime.hour === 12 ? 12 : pickerExTime.hour + 12;
    }
    const newTime = `${String(h24).padStart(2, '0')}:${String(pickerExTime.minute).padStart(2, '0')}`;

    // 로컬 상태 업데이트
    setMedSlotTimes(prev => ({ ...prev, [editingMedSlotKey]: newTime }));

    // DB 업데이트 (users.meal_schedules)
    try {
      const session = await supabase.auth.getSession();
      if (session?.data.session?.access_token) {
        const updatedSchedules = { ...medSlotTimes, [editingMedSlotKey]: newTime };
        await patchUser(user!.id, session.data.session.access_token, { meal_schedules: updatedSchedules });
      }
    } catch (error) {
      console.error('Failed to update meal_schedules:', error);
    }

    closePicker();
  };

  const deleteMedSlot = async (slotKey: MedTimeSlotKey) => {
    const ok = await dialog.confirm({
      title: t('settings.deleteNotifTitle'),
      message: t('settings.deleteMedSlotMsg', { slot: MED_TIME_SLOTS.find(s => s.key === slotKey)?.label }),
      confirmText: t('settings.deleteNotifConfirm'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    // 1. 해당 시간대 비활성화 (med_time_notif_prefs)
    const nextPrefs = { ...medTimePrefs, [slotKey]: false };
    setMedTimePrefs(nextPrefs);

    // 2. activeMedSlots에서 제거
    setActiveMedSlots(prev => prev.filter(k => k !== slotKey));

    // 3. DB 업데이트
    try {
      const session = await supabase.auth.getSession();
      if (session?.data.session?.access_token) {
        await patchUser(user!.id, session.data.session.access_token, { med_time_notif_prefs: nextPrefs });
      }
    } catch (error) {
      console.error('Failed to delete med slot:', error);
    }
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const formatExerciseNotif = (n: ExerciseNotif) =>
    `${n.ampm} ${n.hour}:${String(n.minute).padStart(2, '0')}`;

  const optionButtonWidth = (SCREEN_WIDTH - 72) / 2;
  const hourButtonWidth = (SCREEN_WIDTH - 88) / 4;

  // 연결된 환자 이름으로 텍스트 내 "환자" 치환 (미연결 시 원문 그대로)
  // 환자명 뒤에는 항상 "님"을 붙이고, 뒤따르는 조사(가/이/은/는/을/를/에게 등)는 제거해
  // "최성철가" 같은 비문 대신 "최성철님" 형태로 통일한다.
  const pt = (text: string) => {
    if (!linkedPatientName) return text;
    if (isOverseasLocale()) {
      return text.replace(/\bpatient\b/gi, linkedPatientName);
    }
    return text.replace(
      /환자(이|가|은|는|을|를|의|와|과|랑|이랑|에게|에게서|도|만|보다|처럼|로서|으로|로)?/g,
      `${linkedPatientName}님`,
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <TopBar
        title={isCaregiver ? t('settings.caregiverTitle') : t('settings.patientOtherTitle')}
        showBack
        rightComponent={
          <TouchableOpacity
            onPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ position: 'relative' }}
          >
            <Ionicons name="notifications-outline" size={26} color="#666666" />
            {unreadCount > 0 && (
              <View style={{
                position: 'absolute',
                top: -4,
                right: -6,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: '#E53935',
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 3,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>
                  {unreadCount > 99 ? '99+' : String(unreadCount)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Card 0: 시스템 알림 차단 안내 (문제 있을 때만 노출) ── */}
        {!systemPermissionGranted && (
          <View style={[styles.card, { overflow: 'hidden' }]}>
          {/* 시스템에서 알림이 차단된 경우 안내 배너 */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.permissionBanner}
              onPress={() => Linking.openSettings()}
            >
              <Ionicons name="warning-outline" size={22} color="#E65100" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.permissionBannerTitle}>{t('settings.systemBlockedTitle')}</Text>
                <Text style={styles.permissionBannerSub}>{t('settings.systemBlockedSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#E65100" />
            </TouchableOpacity>
          </View>
        )}

        {/* 복용 시각별 세트카드(슬롯 시각·복용 알림·약효추적)는 "복용 시간·알림" 메뉴로 이관됨. */}

        {/* ── 약 미복용 알림 (환자만 · 시각별 아님 · 환자 전역) ── */}
        {!isCaregiver && hasAnyDoseSetup && (
          <View style={[styles.card, styles.cardMarginTop]}>
            <View style={styles.cardHeader}>
              <Ionicons name="alarm-outline" size={24} color={Colors.primary} style={styles.cardHeaderIcon} />
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardHeaderTitle}>{t('settings.missedNotifTitle')}</Text>
                <Text style={styles.cardHeaderSub}>{t('settings.missedNotifSub')}</Text>
              </View>
            </View>
            <View style={[styles.notifRow, styles.notifRowTop]}>
              <View style={styles.notifLeft}>
                <Text style={styles.notifTitle}>{t('settings.missedNotif1Title')}</Text>
                <Text style={styles.notifSub}>{t('settings.missedNotif1Sub')}</Text>
              </View>
              <OptimisticSwitch
                style={styles.notifSwitch}
                value={!!medTimePrefs['missed_first']}
                onValueChange={() => toggleMedTimeSlot('missed_first')}
              />
            </View>
            {showMissedSound.first && (
              <View style={styles.missedSoundIndent}>
                <AlarmSoundPickerRow
                  soundId={missedMedSounds.first}
                  sounds={alarmSounds}
                  onSelect={(sid) => setMissedMedSound('first', sid)}
                  backgroundColor={Colors.white}
                />
              </View>
            )}
            <View style={[styles.notifRow, styles.notifRowTop]}>
              <View style={styles.notifLeft}>
                <Text style={styles.notifTitle}>{t('settings.missedNotif2Title')}</Text>
                <Text style={styles.notifSub}>{t('settings.missedNotif2Sub')}</Text>
              </View>
              <OptimisticSwitch
                style={styles.notifSwitch}
                value={!!medTimePrefs['missed_second']}
                onValueChange={() => toggleMedTimeSlot('missed_second')}
              />
            </View>
            {showMissedSound.second && (
              <View style={styles.missedSoundIndent}>
                <AlarmSoundPickerRow
                  soundId={missedMedSounds.second}
                  sounds={alarmSounds}
                  onSelect={(sid) => setMissedMedSound('second', sid)}
                  backgroundColor={Colors.white}
                />
              </View>
            )}
          </View>
        )}

        {/* ── Card 2: 운동 알림 (환자만) ── */}
        {!isCaregiver && <View style={[styles.card, styles.cardMarginTop]}>
          <View style={styles.cardHeader}>
            <Ionicons
              name="fitness-outline"
              size={24}
              color={Colors.primary}
              style={styles.cardHeaderIcon}
            />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardHeaderTitle}>{t('settings.exerciseNotifTitle')}</Text>
              <Text style={styles.cardHeaderSub}>{t('settings.exerciseNotifSub')}</Text>
            </View>
          </View>

          {exerciseNotifs.map((notif) => (
            <View key={notif.id} style={styles.notifItemWrap}>
              <View style={styles.notifRowInner}>
              <View style={styles.notifLeft}>
                <Text style={styles.notifTitle}>{formatExerciseNotif(notif)}</Text>
                <Text style={styles.notifSub}>
                  {t('settings.exerciseNotifDaily', { time: formatExerciseNotif(notif) })}
                </Text>
              </View>
              <View style={styles.notifRight}>
                <Switch
                  value={notif.enabled}
                  onValueChange={() => toggleExercise(notif.id)}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.white}
                />
                <TouchableOpacity
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.iconBtn}
                  onPress={() => openPicker('exercise', notif.id)}
                >
                  <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.iconBtn, styles.iconBtnDelete]}
                  onPress={() => deleteExercise(notif.id)}
                >
                  <Ionicons name="trash-outline" size={22} color={Colors.danger} />
                </TouchableOpacity>
              </View>
              </View>
              {notif.enabled && (
                <AlarmSoundPickerRow
                  soundId={notif.soundId}
                  sounds={alarmSounds}
                  onSelect={(sid) => setExerciseSound(notif.id, sid)}
                  backgroundColor={Colors.white}
                />
              )}
            </View>
          ))}

          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.addRow}
            onPress={() => openPicker('exercise', null)}
          >
            <Ionicons
              name="add-circle-outline"
              size={22}
              color={Colors.accent}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.addLabel}>{t('settings.addNotifBtn')}</Text>
          </TouchableOpacity>
        </View>}

        {/* ── Card 3: 보호자 알림 (보호자만) ── */}
        {isCaregiver && (
          <View style={[styles.card, styles.cardMarginTop]}>
            <View style={styles.cardHeader}>
              <Ionicons
                name="people-outline"
                size={24}
                color={Colors.primary}
                style={styles.cardHeaderIcon}
              />
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardHeaderTitle}>{t('settings.caregiverNotifTitle')}</Text>
                <Text style={styles.cardHeaderSub}>
                  {pt(t('settings.caregiverNotifSub'))}
                </Text>
              </View>
            </View>
            {caregiverNotifs.map((notif) => (
              <View key={notif.id} style={[styles.notifRow, styles.notifRowTop]}>
                <View style={styles.notifLeft}>
                  <Text style={styles.notifTitle}>{pt(notif.label)}</Text>
                  <Text style={styles.notifSub}>
                    {/* label 이 '환자 ' 로 시작하면 fallback sub 에서 중복되지 않게 한 번만 붙인다. */}
                    {pt(notif.sub ?? t('settings.notifGenericSub', { label: notif.label }))}
                  </Text>
                </View>
                <Switch
                  style={styles.notifSwitch}
                  value={notif.enabled}
                  onValueChange={() => toggleCaregiverNotif(notif.id)}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.white}
                />
              </View>
            ))}
          </View>
        )}

        {/* ── 미연동 보호자 안내 카드: 연동 환자가 없으면 환자용 항목 대신 안내만 노출 ── */}
        {showCaregiverEmptyLink && (
          <>
          <View style={styles.caregiverDivider} />
          <View style={[styles.card, styles.cardMarginTop]}>
            <View style={styles.cardHeader}>
              <Ionicons
                name="people-outline"
                size={24}
                color={Colors.primary}
                style={styles.cardHeaderIcon}
              />
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardHeaderTitle}>{t('settings.noLinkedPatientTitle')}</Text>
                <Text style={styles.cardHeaderSub}>
                  {t('settings.noLinkedPatientSub')}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.linkFamilyTextBtn}
              onPress={() => navigation.navigate('FamilyLink')}
            >
              <Text style={styles.linkFamilyTextBtnText}>{t('settings.linkFamilyBtn')}</Text>
            </TouchableOpacity>
          </View>
          </>
        )}

        {/* ── 환자 알림 수정 (보호자만, 연동 환자 있을 때만) — 위에 구분선으로 섹션 구분, 카드는 환자와 동일 전체폭 ── */}
        {hasLinkedPatient && (
          <>
          <View style={styles.caregiverDivider} />
          <View style={styles.caregiverNote}>
            <Ionicons name="information-circle" size={20} color={Colors.primary} style={{ marginTop: 1 }} />
            <Text style={styles.caregiverNoteText}>
              {t('settings.patientSyncNote', { name: linkedPatientName || t('settings.patientFallback') })}
            </Text>
          </View>
          <View style={[styles.card, styles.cardMarginTop]}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.cardHeader}
              onPress={() => {
                if (!showPatientNotifs) loadPatientNotifPrefs();
                setShowPatientNotifs(v => !v);
              }}
            >
              <Ionicons
                name="person-circle-outline"
                size={24}
                color={Colors.primary}
                style={styles.cardHeaderIcon}
              />
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardHeaderTitle}>{pt(t('settings.editPatientNotifTitle'))}</Text>
                <Text style={styles.cardHeaderSub}>{pt(t('settings.editPatientNotifSub'))}</Text>
              </View>
              <Ionicons
                name={showPatientNotifs ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={Colors.textSub}
              />
            </TouchableOpacity>
          </View>

            {showPatientNotifs && (
                <>
                  {/* ── 복용 시간 알림 (주황, 시각별 세트카드는 "복용시간 설정·알림" 메뉴로 이관됨) ──
                      보호자도 그 메뉴에서 환자 슬롯을 대신 편집함(MedicationManage=targetPatientId·DoseSlotSetList=usePatientId 기준).
                      여기서는 그 메뉴로 가는 진입점만 제공. */}
                  <View style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#FFE0B2' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', paddingHorizontal: 16, paddingVertical: 12 }}>
                      <Ionicons name="alarm-outline" size={20} color="#E65100" style={{ marginRight: 10 }} />
                      <Text style={{ fontSize: 17, fontWeight: '700', color: '#E65100' }}>{t('settings.medTimeNotifTitle')}</Text>
                    </View>
                    <View style={[styles.notifRow, styles.notifRowTop, { backgroundColor: Colors.white, minHeight: 64 }]}>
                      <View style={styles.notifLeft}>
                        <Text style={styles.notifSub}>
                          {t('settings.medTimeNotifDesc', { name: linkedPatientName || t('settings.patientFallback') })}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={[styles.addRow, { backgroundColor: Colors.white }]}
                      onPress={() => navigation.navigate('MedicationManage', { mode: 'slots' })}
                    >
                      <Ionicons name="settings-outline" size={22} color="#E65100" style={{ marginRight: 8 }} />
                      <Text style={[styles.addLabel, { color: '#E65100' }]}>{t('settings.medTimeNotifSetupBtn')}</Text>
                      <Ionicons name="chevron-forward" size={20} color="#E65100" style={{ marginLeft: 'auto' }} />
                    </TouchableOpacity>
                  </View>

                  {/* ── 약 미복용 알림 (환자 슬롯과 완전 동일: 색·보조문구·레이아웃) ── */}
                  {patientActiveMedSlots.length > 0 && (
                    <View style={[styles.card, styles.cardMarginTop]}>
                      <View style={styles.cardHeader}>
                        <Ionicons name="alarm-outline" size={24} color={Colors.primary} style={styles.cardHeaderIcon} />
                        <View style={styles.cardHeaderText}>
                          <Text style={styles.cardHeaderTitle}>{t('settings.missedNotifTitle')}</Text>
                          <Text style={styles.cardHeaderSub}>{t('settings.missedNotifSub')}</Text>
                        </View>
                      </View>
                      <View style={[styles.notifRow, styles.notifRowTop]}>
                        <View style={styles.notifLeft}>
                          <Text style={styles.notifTitle}>{t('settings.missedNotif1Title')}</Text>
                          <Text style={styles.notifSub}>{t('settings.missedNotif1Sub')}</Text>
                        </View>
                        <Switch
                          style={styles.notifSwitch}
                          value={!!patientMedTimePrefs['missed_first']}
                          onValueChange={() => togglePatientMedTimeSlot('missed_first')}
                          trackColor={{ false: Colors.border, true: Colors.primary }}
                          thumbColor={Colors.white}
                        />
                      </View>
                      {!!patientMedTimePrefs['missed_first'] && (
                        <View style={styles.missedSoundIndent}>
                          <AlarmSoundPickerRow
                            soundId={patientMissedMedSounds.first}
                            sounds={alarmSounds}
                            onSelect={(sid) => setPatientMissedMedSound('first', sid)}
                            backgroundColor={Colors.white}
                          />
                        </View>
                      )}
                      <View style={[styles.notifRow, styles.notifRowTop]}>
                        <View style={styles.notifLeft}>
                          <Text style={styles.notifTitle}>{t('settings.missedNotif2Title')}</Text>
                          <Text style={styles.notifSub}>{t('settings.missedNotif2Sub')}</Text>
                        </View>
                        <Switch
                          style={styles.notifSwitch}
                          value={!!patientMedTimePrefs['missed_second']}
                          onValueChange={() => togglePatientMedTimeSlot('missed_second')}
                          trackColor={{ false: Colors.border, true: Colors.primary }}
                          thumbColor={Colors.white}
                        />
                      </View>
                      {!!patientMedTimePrefs['missed_second'] && (
                        <View style={styles.missedSoundIndent}>
                          <AlarmSoundPickerRow
                            soundId={patientMissedMedSounds.second}
                            sounds={alarmSounds}
                            onSelect={(sid) => setPatientMissedMedSound('second', sid)}
                            backgroundColor={Colors.white}
                          />
                        </View>
                      )}
                    </View>
                  )}

                  {/* ── 운동 알림 (환자 슬롯과 완전 동일: 색·보조문구·레이아웃) ── */}
                  <View style={[styles.card, styles.cardMarginTop, { marginBottom: 12 }]}>
                    <View style={styles.cardHeader}>
                      <Ionicons
                        name="fitness-outline"
                        size={24}
                        color={Colors.primary}
                        style={styles.cardHeaderIcon}
                      />
                      <View style={styles.cardHeaderText}>
                        <Text style={styles.cardHeaderTitle}>{t('settings.exerciseNotifTitle')}</Text>
                        <Text style={styles.cardHeaderSub}>{t('settings.exerciseNotifSub')}</Text>
                      </View>
                    </View>
                    {patientExerciseNotifs.map((notif) => (
                      <View key={notif.id} style={styles.notifItemWrap}>
                        <View style={styles.notifRowInner}>
                          <View style={styles.notifLeft}>
                            <Text style={styles.notifTitle}>{formatExerciseNotif(notif)}</Text>
                            <Text style={styles.notifSub}>
                              {t('settings.exerciseNotifDaily', { time: formatExerciseNotif(notif) })}
                            </Text>
                          </View>
                          <View style={styles.notifRight}>
                            <Switch
                              value={notif.enabled}
                              onValueChange={() => togglePatientExerciseNotif(notif.id)}
                              trackColor={{ false: Colors.border, true: Colors.primary }}
                              thumbColor={Colors.white}
                            />
                            <TouchableOpacity
                              activeOpacity={0.7}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={styles.iconBtn}
                              onPress={() => openPatientPicker('exercise', notif.id)}
                            >
                              <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              activeOpacity={0.7}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={[styles.iconBtn, styles.iconBtnDelete]}
                              onPress={() => deletePatientExerciseNotif(notif.id)}
                            >
                              <Ionicons name="trash-outline" size={22} color={Colors.danger} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        {notif.enabled && (
                          <AlarmSoundPickerRow
                            soundId={notif.soundId}
                            sounds={alarmSounds}
                            onSelect={(sid) => setPatientExerciseSound(notif.id, sid)}
                            backgroundColor={Colors.white}
                          />
                        )}
                      </View>
                    ))}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.addRow}
                      onPress={() => openPatientPicker('exercise', null)}
                    >
                      <Ionicons
                        name="add-circle-outline"
                        size={22}
                        color={Colors.accent}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.addLabel}>{t('settings.addNotifBtn')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
            )}
          </>
        )}

      </ScrollView>

      {/* ── Bottom Sheet Modal ── */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="none"
        onRequestClose={closePicker}
      >
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closePicker}
          />
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: Math.max(32, insets.bottom + 16), transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Handle bar */}
            <View style={styles.handle} />

            {pickerType === 'med' ? (
              /* ── Med time picker ── */
              <>
                <Text style={styles.pickerTitle}>{t('settings.pickerTimeSelectTitle')}</Text>

                <View style={styles.optionGrid}>
                  {MED_TIME_OPTIONS.map((opt) => {
                    const active = selectedMinutes === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        activeOpacity={0.7}
                        onPress={() => setSelectedMinutes(opt)}
                        style={[
                          styles.optionBtn,
                          { width: optionButtonWidth },
                          active
                            ? styles.optionBtnActive
                            : styles.optionBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionBtnText,
                            active
                              ? styles.optionBtnTextActive
                              : styles.optionBtnTextInactive,
                          ]}
                        >
                          {minutesToLabel(opt)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.saveBtn}
                  onPress={saveMedTime}
                >
                  <Text style={styles.saveBtnText}>{t('settings.saveBtn')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={closePicker}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </>
            ) : pickerType === 'medSlot' ? (
              /* ── Med Slot time picker ── */
              <>
                <Text style={styles.pickerTitle}>{t('settings.pickerMedSlotTimeTitle')}</Text>

                {/* AM/PM row */}
                <View style={styles.ampmRow}>
                  {(['오전', '오후'] as const).map((ap) => {
                    const active = pickerExTime.ampm === ap;
                    return (
                      <TouchableOpacity
                        key={ap}
                        activeOpacity={0.7}
                        onPress={() =>
                          setPickerExTime((prev) => ({ ...prev, ampm: ap }))
                        }
                        style={[
                          styles.ampmBtn,
                          active
                            ? styles.ampmBtnActive
                            : styles.ampmBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.ampmBtnText,
                            active
                              ? styles.ampmBtnTextActive
                              : styles.ampmBtnTextInactive,
                          ]}
                        >
                          {ap === '오전' ? t('common.am') : t('common.pm')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Hour label */}
                <Text style={styles.unitLabel}>{t('settings.hourUnit')}</Text>

                {/* Hour grid */}
                <View style={styles.hourGrid}>
                  {EXERCISE_HOURS.map((h) => {
                    const active = pickerExTime.hour === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        activeOpacity={0.7}
                        onPress={() =>
                          setPickerExTime((prev) => ({ ...prev, hour: h }))
                        }
                        style={[
                          styles.hourBtn,
                          { width: hourButtonWidth },
                          active
                            ? styles.gridBtnActive
                            : styles.gridBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.gridBtnText,
                            active
                              ? styles.gridBtnTextActive
                              : styles.gridBtnTextInactive,
                          ]}
                        >
                          {h}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Minute label */}
                <Text style={[styles.unitLabel, { marginTop: 16 }]}>{t('settings.minuteUnit')}</Text>

                {/* Minute grid */}
                <View style={styles.minuteGrid}>
                  {EXERCISE_MINUTES.map((min) => {
                    const active = pickerExTime.minute === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        activeOpacity={0.7}
                        onPress={() =>
                          setPickerExTime((prev) => ({
                            ...prev,
                            minute: min,
                          }))
                        }
                        style={[
                          styles.minuteBtn,
                          active
                            ? styles.gridBtnActive
                            : styles.gridBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.gridBtnText,
                            active
                              ? styles.gridBtnTextActive
                              : styles.gridBtnTextInactive,
                          ]}
                        >
                          {String(min).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.saveBtn}
                  onPress={saveMedSlotTime}
                >
                  <Text style={styles.saveBtnText}>{t('settings.saveBtn')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={closePicker}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ── Exercise time picker ── */
              <>
                <Text style={styles.pickerTitle}>{t('settings.pickerExerciseTimeTitle')}</Text>

                {/* AM/PM row */}
                <View style={styles.ampmRow}>
                  {(['오전', '오후'] as const).map((ap) => {
                    const active = pickerExTime.ampm === ap;
                    return (
                      <TouchableOpacity
                        key={ap}
                        activeOpacity={0.7}
                        onPress={() =>
                          setPickerExTime((prev) => ({ ...prev, ampm: ap }))
                        }
                        style={[
                          styles.ampmBtn,
                          active
                            ? styles.ampmBtnActive
                            : styles.ampmBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.ampmBtnText,
                            active
                              ? styles.ampmBtnTextActive
                              : styles.ampmBtnTextInactive,
                          ]}
                        >
                          {ap === '오전' ? t('common.am') : t('common.pm')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Hour label */}
                <Text style={styles.unitLabel}>{t('settings.hourUnit')}</Text>

                {/* Hour grid */}
                <View style={styles.hourGrid}>
                  {EXERCISE_HOURS.map((h) => {
                    const active = pickerExTime.hour === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        activeOpacity={0.7}
                        onPress={() =>
                          setPickerExTime((prev) => ({ ...prev, hour: h }))
                        }
                        style={[
                          styles.hourBtn,
                          { width: hourButtonWidth },
                          active
                            ? styles.gridBtnActive
                            : styles.gridBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.gridBtnText,
                            active
                              ? styles.gridBtnTextActive
                              : styles.gridBtnTextInactive,
                          ]}
                        >
                          {h}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Minute label */}
                <Text style={[styles.unitLabel, { marginTop: 16 }]}>{t('settings.minuteUnit')}</Text>

                {/* Minute grid */}
                <View style={styles.minuteGrid}>
                  {EXERCISE_MINUTES.map((min) => {
                    const active = pickerExTime.minute === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        activeOpacity={0.7}
                        onPress={() =>
                          setPickerExTime((prev) => ({
                            ...prev,
                            minute: min,
                          }))
                        }
                        style={[
                          styles.minuteBtn,
                          active
                            ? styles.gridBtnActive
                            : styles.gridBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.gridBtnText,
                            active
                              ? styles.gridBtnTextActive
                              : styles.gridBtnTextInactive,
                          ]}
                        >
                          {String(min).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.saveBtn}
                  onPress={saveExerciseTime}
                >
                  <Text style={styles.saveBtnText}>{t('settings.saveBtn')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={closePicker}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </Animated.View>
      </Modal>
      {/* ── 환자용 Bottom Sheet Modal ── */}
      <Modal
        visible={patientPickerVisible}
        transparent
        animationType="none"
        onRequestClose={() => closePatientPicker()}
      >
        <Animated.View style={[styles.backdrop, { opacity: patientFadeAnim }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => closePatientPicker()}
          />
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: Math.max(32, insets.bottom + 16), transform: [{ translateY: patientSlideAnim }] },
            ]}
          >
            {/* Handle bar */}
            <View style={styles.handle} />

            {patientPickerType === 'med' ? (
              /* ── 환자 Med time picker ── */
              <>
                <Text style={styles.pickerTitle}>{t('settings.pickerTimeSelectTitle')}</Text>

                <View style={styles.optionGrid}>
                  {MED_TIME_OPTIONS.map((opt) => {
                    const active = patientSelectedMinutes === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        activeOpacity={0.7}
                        onPress={() => setPatientSelectedMinutes(opt)}
                        style={[
                          styles.optionBtn,
                          { width: optionButtonWidth },
                          active ? styles.optionBtnActive : styles.optionBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionBtnText,
                            active ? styles.optionBtnTextActive : styles.optionBtnTextInactive,
                          ]}
                        >
                          {minutesToLabel(opt)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.saveBtn}
                  onPress={savePatientMedTime}
                >
                  <Text style={styles.saveBtnText}>{t('settings.saveBtn')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={() => closePatientPicker()}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ── 환자 Exercise time picker ── */
              <>
                <Text style={styles.pickerTitle}>{t('settings.pickerExerciseTimeTitle')}</Text>

                {/* AM/PM row */}
                <View style={styles.ampmRow}>
                  {(['오전', '오후'] as const).map((ap) => {
                    const active = patientPickerExTime.ampm === ap;
                    return (
                      <TouchableOpacity
                        key={ap}
                        activeOpacity={0.7}
                        onPress={() => setPatientPickerExTime((prev) => ({ ...prev, ampm: ap }))}
                        style={[
                          styles.ampmBtn,
                          active ? styles.ampmBtnActive : styles.ampmBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.ampmBtnText,
                            active ? styles.ampmBtnTextActive : styles.ampmBtnTextInactive,
                          ]}
                        >
                          {ap === '오전' ? t('common.am') : t('common.pm')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Hour label */}
                <Text style={styles.unitLabel}>{t('settings.hourUnit')}</Text>

                {/* Hour grid */}
                <View style={styles.hourGrid}>
                  {EXERCISE_HOURS.map((h) => {
                    const active = patientPickerExTime.hour === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        activeOpacity={0.7}
                        onPress={() => setPatientPickerExTime((prev) => ({ ...prev, hour: h }))}
                        style={[
                          styles.hourBtn,
                          { width: hourButtonWidth },
                          active ? styles.gridBtnActive : styles.gridBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.gridBtnText,
                            active ? styles.gridBtnTextActive : styles.gridBtnTextInactive,
                          ]}
                        >
                          {h}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Minute label */}
                <Text style={[styles.unitLabel, { marginTop: 16 }]}>{t('settings.minuteUnit')}</Text>

                {/* Minute grid */}
                <View style={styles.minuteGrid}>
                  {EXERCISE_MINUTES.map((min) => {
                    const active = patientPickerExTime.minute === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        activeOpacity={0.7}
                        onPress={() => setPatientPickerExTime((prev) => ({ ...prev, minute: min }))}
                        style={[
                          styles.minuteBtn,
                          active ? styles.gridBtnActive : styles.gridBtnInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.gridBtnText,
                            active ? styles.gridBtnTextActive : styles.gridBtnTextInactive,
                          ]}
                        >
                          {String(min).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.saveBtn}
                  onPress={savePatientExerciseTime}
                >
                  <Text style={styles.saveBtnText}>{t('settings.saveBtn')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={() => closePatientPicker()}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* ── 알림 차단 안내 바텀시트 ── */}
      <Modal
        visible={showPermissionSheet}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowPermissionSheet(false);
          setPendingOn(false);
        }}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
          activeOpacity={1}
          onPress={() => {
            setShowPermissionSheet(false);
            setPendingOn(false);
          }}
        />
        <View style={{
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          paddingHorizontal: 24,
          paddingBottom: 40,
          paddingTop: 12,
          alignItems: 'center',
        }}>
          {/* 핸들바 */}
          <View style={{ width: 40, height: 4, backgroundColor: '#EEEEEE', borderRadius: 2, marginBottom: 24 }} />

          {/* 아이콘 */}
          <Ionicons name="notifications-off-circle-outline" size={56} color="#F44336" />

          {/* 제목 */}
          <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#111111', textAlign: 'center', marginTop: 16 }}>
            {t('settings.blockedSheetTitle')}
          </Text>

          {/* 본문 */}
          <Text style={{ fontSize: 18, color: '#444444', textAlign: 'center', lineHeight: 28, marginTop: 10, marginBottom: 28 }}>
            {t('settings.blockedSheetMsg')}
          </Text>

          {/* 설정 열기 버튼 */}
          <TouchableOpacity
            style={{
              backgroundColor: '#2E7D32',
              height: 60,
              borderRadius: 14,
              width: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
            onPress={() => Linking.openSettings()}
          >
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#FFFFFF' }}>{t('settings.openSettingsBtn')}</Text>
          </TouchableOpacity>

          {/* 나중에 버튼 */}
          <TouchableOpacity
            style={{
              backgroundColor: '#FFFFFF',
              height: 56,
              borderRadius: 14,
              width: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: '#EEEEEE',
            }}
            onPress={() => {
              setShowPermissionSheet(false);
              setPendingOn(false);
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#666666' }}>{t('settings.laterBtn')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 80,
  },

  // 보호자 '환자 알림 수정' 섹션 구분선 (위쪽 구분) — 확실히 보이게
  caregiverDivider: {
    height: 1,
    backgroundColor: '#B8C0CC',
    marginTop: 30,
    marginBottom: 12,
  },
  // 구분선 아래 안내 — 보호자 수정이 환자 휴대폰에도 반영됨을 알림
  caregiverNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'transparent',
    paddingHorizontal: 2,
    paddingVertical: 6,
    marginBottom: 4,
  },
  caregiverNoteText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.dark,
    fontWeight: '600',
  },

  // ── Card ──
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
  },
  cardMarginTop: {
    marginTop: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cardHeaderIcon: {
    marginRight: 12,
  },
  cardHeaderText: {
    flex: 1,
  },
  cardHeaderTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
  },
  cardHeaderSub: {
    fontSize: 15,
    color: Colors.textSub,
    marginTop: 2,
  },

  // ── Notif row ──
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 20,
  },
  // 알림 항목 + 소리 줄을 세로로 감싸는 카드
  notifItemWrap: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  // 미복용 알림 소리 줄: 운동 알림과 좌측 라인을 맞추기 위한 들여쓰기
  missedSoundIndent: {
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  notifRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
  },
  // 보호자 알림 행: 보조문구가 길어도 스위치가 제목 라인 중앙에 맞도록 상단 정렬한다.
  notifRowTop: {
    alignItems: 'flex-start',
  },
  // notifLeft 위쪽 패딩(14) + 제목 라인 높이(약 24)의 중앙에 스위치(높이 31)가 오도록 보정.
  notifSwitch: {
    marginTop: 11,
  },
  notifLeft: {
    flex: 1,
    paddingVertical: 14,
  },
  notifTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
  },
  notifSub: {
    fontSize: 15,
    color: Colors.textSub,
    marginTop: 3,
  },
  notifNotice: {
    fontSize: 15,
    color: Colors.danger,
    marginTop: 2,
  },
  medTimeNote: {
    fontSize: 14,
    color: Colors.textHint,
    marginTop: 12,
    lineHeight: 20,
    paddingHorizontal: 4,
  },
  // 약효 추적 디스클레이머 (NotificationSetupScreen disclaimerCard 톤 재사용)
  medTrackDisclaimer: {
    backgroundColor: '#FFF3E0',
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
  },
  medTrackDisclaimerText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 26,
    fontWeight: '600',
  },
  medTrackDisclaimerSub: {
    fontSize: 14,
    color: Colors.textSub,
    lineHeight: 20,
    marginTop: 8,
  },
  // 약 0개 차단 안내 (안심 톤)
  medTrackEmpty: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    alignItems: 'center',
  },
  medTrackEmptyText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 27,
    textAlign: 'center',
    marginBottom: 20,
  },
  medTrackEmptyBtn: {
    minHeight: 56,
    alignSelf: 'stretch',
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  medTrackEmptyBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.white,
  },
  notifRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    marginLeft: 12,
    padding: 4,
  },
  iconBtnDelete: {
    marginLeft: 8,
  },

  // ── Add row ──
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  linkFamilyTextBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  linkFamilyTextBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  addLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.accent,
  },

  // ── Exercise rows ──
  exerciseToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 20,
  },
  exerciseTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 20,
  },
  exerciseTimeRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseTimeValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.primary,
  },

  // ── Permission banner ──
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  permissionBannerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E65100',
  },
  permissionBannerSub: {
    fontSize: 14,
    color: '#B45309',
    marginTop: 2,
  },

  // ── Backdrop ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },

  // ── Sheet ──
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 32,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 14,
    marginBottom: 8,
  },

  // ── Picker shared ──
  pickerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 20,
    height: 60,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.white,
  },
  cancelLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  cancelLinkText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '700',
  },

  // ── Med time option grid ──
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
  },
  optionBtn: {
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBtnActive: {
    backgroundColor: Colors.primary,
  },
  optionBtnInactive: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  optionBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  optionBtnTextActive: {
    color: Colors.white,
  },
  optionBtnTextInactive: {
    color: Colors.text,
  },

  // ── AM/PM ──
  ampmRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  ampmBtn: {
    flex: 1,
    height: 60,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  ampmBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  ampmBtnInactive: {
    backgroundColor: Colors.white,
    borderColor: Colors.border,
  },
  ampmBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  ampmBtnTextActive: {
    color: Colors.white,
  },
  ampmBtnTextInactive: {
    color: Colors.textSub,
  },

  // ── Unit labels ──
  unitLabel: {
    fontSize: 16,
    color: Colors.textSub,
    marginLeft: 24,
    marginBottom: 8,
  },

  // ── Hour grid ──
  hourGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
  },
  hourBtn: {
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Minute grid ──
  minuteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
  },
  minuteBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Shared grid button states ──
  gridBtnActive: {
    backgroundColor: Colors.primary,
  },
  gridBtnInactive: {
    backgroundColor: Colors.background,
  },
  gridBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  gridBtnTextActive: {
    color: Colors.white,
  },
  gridBtnTextInactive: {
    color: Colors.text,
  },

  // ── Separator ──
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 20,
  },

  // ── Refresh Token Button ──
  refreshTokenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 12,
    margin: 16,
    marginTop: 0,
    backgroundColor: Colors.white,
  },
  refreshTokenButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
});
