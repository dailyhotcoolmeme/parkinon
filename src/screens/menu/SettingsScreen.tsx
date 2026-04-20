import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  Animated,
  Dimensions,
  Linking,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useSettings, MedNotif, ExerciseNotif } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { minutesToLabel } from '../../utils/medUtils';
import { supabase } from '../../lib/supabase';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { MenuStackParamList } from '../../navigation/MenuNavigator';
import {
  requestPermissionsAndSaveToken,
  scheduleMedicationReminders,
  scheduleExerciseReminders,
} from '../../utils/notifications';

interface CaregiverNotif {
  id: string;
  label: string;
  enabled: boolean;
}

const DEFAULT_CAREGIVER_NOTIFS: CaregiverNotif[] = [
  { id: 'med_taken', label: '약 복용 기록 시', enabled: true },
  { id: 'med_missed', label: '약 미복용 알림 (20분 후)', enabled: true },
  { id: 'body_state', label: '몸상태 기록 시', enabled: true },
  { id: 'mood', label: '기분 기록 시', enabled: true },
  { id: 'exercise', label: '운동 기록 시', enabled: true },
  { id: 'sleep', label: '수면 기록 시', enabled: false },
  { id: 'constipation', label: '변비 기록 시', enabled: false },
];

const STORAGE_KEY_CAREGIVER = 'settings_caregiver_notifs';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Data model ───────────────────────────────────────────────────────────────

const MED_TIME_OPTIONS = [0, 10, 30, 60, 90, 120, 180, 240];
const EXERCISE_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EXERCISE_MINUTES = [0, 10, 20, 30, 40, 50];

// ─── Component ────────────────────────────────────────────────────────────────

const MED_TIME_SLOTS = [
  { key: 'morning', label: '아침' },
  { key: 'lunch',   label: '점심' },
  { key: 'dinner',  label: '저녁' },
  { key: 'bedtime', label: '취침' },
] as const;

type MedTimeSlotKey = 'morning' | 'lunch' | 'dinner' | 'bedtime';

export function SettingsScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<StackNavigationProp<MenuStackParamList>>();
  const isCaregiver = user?.role === 'caregiver';

  // Settings context (shared with Records screens)
  const {
    medNotifs, setMedNotifs,
    exerciseNotifs, setExerciseNotifs,
    notificationEnabled, setNotificationEnabled, setNotificationEnabledOnly,
    systemPermissionGranted, recheckSystemPermission,
    syncGlobalFromIndividual,
  } = useSettings();

  // 약 복용 시간 알림 per-slot 설정
  const [medTimePrefs, setMedTimePrefs] = useState<Record<MedTimeSlotKey, boolean>>({
    morning: true, lunch: true, dinner: true, bedtime: true,
  });
  const [medSlotTimes, setMedSlotTimes] = useState<Record<MedTimeSlotKey, string>>({
    morning: '08:00', lunch: '12:00', dinner: '18:00', bedtime: '22:00',
  });
  const [activeMedSlots, setActiveMedSlots] = useState<MedTimeSlotKey[]>([]);

  // 환자 알림 수정 (보호자용)
  const [showPatientNotifs, setShowPatientNotifs] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientMedTimePrefs, setPatientMedTimePrefs] = useState<Record<MedTimeSlotKey, boolean>>({
    morning: true, lunch: true, dinner: true, bedtime: true,
  });
  const [patientActiveMedSlots, setPatientActiveMedSlots] = useState<MedTimeSlotKey[]>([]);
  const [patientMedSlotTimes, setPatientMedSlotTimes] = useState<Record<MedTimeSlotKey, string>>({
    morning: '08:00', lunch: '12:00', dinner: '18:00', bedtime: '22:00',
  });
  const [patientMedNotifs, setPatientMedNotifs] = useState<MedNotif[]>([]);
  const [patientExerciseNotifs, setPatientExerciseNotifs] = useState<ExerciseNotif[]>([]);

  // 약 복용 시간 알림 설정 로드 + 약 관리에서 설정한 실제 시간 조회
  const loadMedTimePrefs = React.useCallback(async () => {
    if (!user || isCaregiver) return;
    try {
      const { data } = await supabase
        .from('users')
        .select('med_time_notif_prefs')
        .eq('id', user.id)
        .single();
      if (data?.med_time_notif_prefs) {
        setMedTimePrefs(prev => ({ ...prev, ...data.med_time_notif_prefs }));
      }
      // 약 관리에서 설정한 실제 복용 시간 조회 (슬롯별 가장 이른 시간)
      const { data: meds } = await supabase
        .from('medications')
        .select('meal_times, meal_schedules')
        .eq('patient_id', user.id)
        .eq('is_active', true);
      if (meds?.length) {
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
      } else {
        setActiveMedSlots([]);
      }
    } catch {}
  }, [user, isCaregiver]);

  const toggleMedTimeSlot = async (slot: MedTimeSlotKey) => {
    const next = { ...medTimePrefs, [slot]: !medTimePrefs[slot] };
    setMedTimePrefs(next);
    try {
      await supabase.from('users').update({ med_time_notif_prefs: next }).eq('id', user!.id);
    } catch {}
  };

  const loadPatientNotifPrefs = React.useCallback(async () => {
    if (!user || !isCaregiver || !user.patient_group_id) return;
    try {
      // 1. 환자 ID 조회
      const { data: memberData } = await supabase
        .from('patient_group_members')
        .select('user_id')
        .eq('group_id', user.patient_group_id)
        .eq('role', 'patient')
        .single();
      const pid = memberData?.user_id;
      if (!pid) return;
      setPatientId(pid);

      // 2. 환자의 알림 설정 (med_time_notif_prefs + med_notif_prefs + exercise_notif_prefs)
      const { data: patientUser } = await supabase
        .from('users')
        .select('med_time_notif_prefs, med_notif_prefs, exercise_notif_prefs')
        .eq('id', pid)
        .single();
      if (patientUser?.med_time_notif_prefs) {
        setPatientMedTimePrefs(prev => ({ ...prev, ...patientUser.med_time_notif_prefs }));
      }
      if (patientUser?.med_notif_prefs) {
        setPatientMedNotifs((patientUser.med_notif_prefs as MedNotif[]).filter(n => n.minutes !== 0));
      }
      if (patientUser?.exercise_notif_prefs) {
        setPatientExerciseNotifs(patientUser.exercise_notif_prefs as ExerciseNotif[]);
      }

      // 3. 환자의 활성 약 슬롯 + 복용 시간
      const { data: meds } = await supabase
        .from('medications')
        .select('meal_times, meal_schedules')
        .eq('patient_id', pid)
        .eq('is_active', true);
      if (meds?.length) {
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
        setPatientActiveMedSlots([]);
      }
    } catch {}
  }, [user, isCaregiver]);

  const togglePatientMedTimeSlot = async (slot: MedTimeSlotKey) => {
    if (!patientId) return;
    const next = { ...patientMedTimePrefs, [slot]: !patientMedTimePrefs[slot] };
    setPatientMedTimePrefs(next);
    try {
      await supabase.from('users').update({ med_time_notif_prefs: next }).eq('id', patientId);
    } catch {}
  };

  // 보호자 알림 설정
  const [caregiverNotifs, setCaregiverNotifs] = useState<CaregiverNotif[]>(DEFAULT_CAREGIVER_NOTIFS);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_CAREGIVER).then(raw => {
      if (raw) setCaregiverNotifs(JSON.parse(raw));
    }).catch(() => {});
  }, []);

  const toggleCaregiverNotif = (id: string) => {
    setCaregiverNotifs(prev => {
      const next = prev.map(n => n.id === id ? { ...n, enabled: !n.enabled } : n);
      AsyncStorage.setItem(STORAGE_KEY_CAREGIVER, JSON.stringify(next)).catch(() => {});
      // DB에도 동기화
      const prefs: Record<string, boolean> = {};
      next.forEach(n => { prefs[n.id] = n.enabled; });
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user) return;
        supabase.from('users')
          .update({ caregiver_notif_prefs: prefs })
          .eq('id', session.user.id)
          .then(({ error }) => {
            if (error) console.error('[SettingsScreen] caregiver_notif_prefs 저장 오류:', error.message);
          });
      });
      return next;
    });
  };

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
  const [pickerType, setPickerType] = useState<'med' | 'exercise'>('med');
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [selectedMinutes, setSelectedMinutes] = useState(0);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [pickerExTime, setPickerExTime] = useState<{ ampm: '오전' | '오후'; hour: number; minute: number }>({
    ampm: '오후',
    hour: 2,
    minute: 0,
  });

  // 화면 포커스 시 시스템 알림 권한 + DB에서 notification_enabled + caregiver_notif_prefs 재로드
  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        try {
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

            if (isCaregiver && userRow.caregiver_notif_prefs) {
              const prefs = userRow.caregiver_notif_prefs as Record<string, boolean>;
              setCaregiverNotifs(prev => prev.map(n => ({
                ...n,
                enabled: prefs[n.id] !== undefined ? prefs[n.id] : n.enabled,
              })));
            }
          }
          // 3. 약 복용 시간 알림 설정 로드
          await loadMedTimePrefs();
          // 4. 환자 알림 설정 로드 (보호자만)
          await loadPatientNotifPrefs();
        } catch (e) {
          console.warn('[SettingsScreen] 설정 로드 오류:', e);
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
          await scheduleMedicationReminders();
          await scheduleExerciseReminders(exerciseNotifs);
        }
        // denied면 그대로 유지 (바텀시트 열린 채)
      }
    });
    return () => subscription.remove();
  }, [showPermissionSheet, setNotificationEnabled, exerciseNotifs]);

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

  const closePatientPicker = () => {
    Animated.parallel([
      Animated.timing(patientFadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(patientSlideAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => setPatientPickerVisible(false));
  };

  const savePatientMedTime = async () => {
    if (!patientId) return;
    const next = editingPatientMedId
      ? patientMedNotifs.map(n => n.id === editingPatientMedId ? { ...n, minutes: patientSelectedMinutes } : n)
      : [...patientMedNotifs, { id: Date.now().toString(), minutes: patientSelectedMinutes, enabled: true }];
    setPatientMedNotifs(next);
    await supabase.from('users').update({ med_notif_prefs: next }).eq('id', patientId);
    closePatientPicker();
  };

  const savePatientExerciseTime = async () => {
    if (!patientId) return;
    const next = editingPatientExerciseId
      ? patientExerciseNotifs.map(n => n.id === editingPatientExerciseId ? { ...n, ...patientPickerExTime } : n)
      : [...patientExerciseNotifs, { id: Date.now().toString(), ...patientPickerExTime, enabled: true }];
    setPatientExerciseNotifs(next);
    await supabase.from('users').update({ exercise_notif_prefs: next }).eq('id', patientId);
    closePatientPicker();
  };

  const togglePatientMedNotif = async (id: string) => {
    if (!patientId) return;
    const next = patientMedNotifs.map(n => n.id === id ? { ...n, enabled: !n.enabled } : n);
    setPatientMedNotifs(next);
    await supabase.from('users').update({ med_notif_prefs: next }).eq('id', patientId);
  };

  const togglePatientExerciseNotif = async (id: string) => {
    if (!patientId) return;
    const next = patientExerciseNotifs.map(n => n.id === id ? { ...n, enabled: !n.enabled } : n);
    setPatientExerciseNotifs(next);
    await supabase.from('users').update({ exercise_notif_prefs: next }).eq('id', patientId);
  };

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const toggleMed = (id: string) => {
    setMedNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n))
    );
    // 상태 반영 후 전체 알림 토글 자동 동기화
    setTimeout(syncGlobalFromIndividual, 0);
  };

  const deleteMed = (id: string) => {
    Alert.alert('알림 삭제', '이 알림을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () =>
          setMedNotifs((prev) => prev.filter((n) => n.id !== id)),
      },
    ]);
  };

  const saveMedTime = () => {
    if (editingMedId) {
      setMedNotifs((prev) =>
        prev.map((n) =>
          n.id === editingMedId ? { ...n, minutes: selectedMinutes } : n
        )
      );
    } else {
      setMedNotifs((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          minutes: selectedMinutes,
          enabled: true,
        },
      ]);
    }
    closePicker();
  };

  const toggleExercise = (id: string) => {
    setExerciseNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n))
    );
    // 상태 반영 후 전체 알림 토글 자동 동기화
    setTimeout(syncGlobalFromIndividual, 0);
  };

  const deleteExercise = (id: string) => {
    Alert.alert('알림 삭제', '이 알림을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () =>
          setExerciseNotifs((prev) => prev.filter((n) => n.id !== id)),
      },
    ]);
  };

  const saveExerciseTime = () => {
    if (editingExerciseId) {
      setExerciseNotifs((prev) =>
        prev.map((n) =>
          n.id === editingExerciseId ? { ...n, ...pickerExTime } : n
        )
      );
    } else {
      setExerciseNotifs((prev) => [
        ...prev,
        { id: Date.now().toString(), ...pickerExTime, enabled: true },
      ]);
    }
    closePicker();
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const formatExerciseNotif = (n: ExerciseNotif) =>
    `${n.ampm} ${n.hour}:${String(n.minute).padStart(2, '0')}`;

  const optionButtonWidth = (SCREEN_WIDTH - 72) / 2;
  const hourButtonWidth = (SCREEN_WIDTH - 88) / 4;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <TopBar title="알림 설정" showBack />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Card 0: 전체 알림 ON/OFF ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons
              name="notifications-circle-outline"
              size={24}
              color={Colors.primary}
              style={styles.cardHeaderIcon}
            />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardHeaderTitle}>전체 알림</Text>
              <Text style={styles.cardHeaderSub}>
                모든 알림을 켜거나 끌 수 있어요
              </Text>
            </View>
            <Switch
              value={pendingOn || notificationEnabled}
              onValueChange={async (v) => {
                if (v) {
                  // ── OFF → ON 시도: 시스템 권한 상태 먼저 확인 ──────────────
                  const { status } = await Notifications.getPermissionsAsync();

                  if (status === 'granted') {
                    // 시스템 이미 허용 → 바로 ON
                    await setNotificationEnabled(true);
                    await scheduleMedicationReminders();
                    await scheduleExerciseReminders(exerciseNotifs);

                  } else if (status === 'undetermined') {
                    // 아직 한 번도 요청 안 함 → 시스템 팝업
                    const { status: newStatus } = await Notifications.requestPermissionsAsync();
                    if (newStatus === 'granted') {
                      await setNotificationEnabled(true);
                      if (user?.id) {
                        const { data: { session } } = await supabase.auth.getSession();
                        requestPermissionsAndSaveToken(user.id, session?.access_token ?? undefined).catch(console.error);
                      }
                      await scheduleMedicationReminders();
                      await scheduleExerciseReminders(exerciseNotifs);
                    } else {
                      // 거부 → 앱도 OFF 유지 (상태 변경 없음)
                      // 아무것도 안 함
                    }

                  } else {
                    // denied → 시스템 팝업 불가, 바텀시트로 안내 + 토글 시각적 ON 유지
                    setPendingOn(true);
                    setShowPermissionSheet(true);
                    // setNotificationEnabled 호출 없음
                  }
                  return;
                }
                // OFF 처리
                await setNotificationEnabled(false);
              }}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>
          {/* 시스템에서 알림이 차단된 경우 안내 배너 */}
          {!systemPermissionGranted && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.permissionBanner}
              onPress={() => Linking.openSettings()}
            >
              <Ionicons name="warning-outline" size={20} color="#B45309" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.permissionBannerTitle}>시스템 알림이 차단되어 있어요</Text>
                <Text style={styles.permissionBannerSub}>탭하여 설정에서 파킨온 알림을 허용해주세요</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#B45309" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Card 1: 약 복용 시간 알림 (환자만) ── */}
        {!isCaregiver && <View style={[styles.card, styles.cardMarginTop]}>
          <View style={styles.cardHeader}>
            <Ionicons name="alarm-outline" size={24} color={Colors.primary} style={styles.cardHeaderIcon} />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardHeaderTitle}>약 복용 시간 알림</Text>
              <Text style={styles.cardHeaderSub}>정해진 시간에 약 드실 시간을 알려드려요</Text>
            </View>
          </View>
          {MED_TIME_SLOTS.filter(slot => activeMedSlots.includes(slot.key as MedTimeSlotKey)).map((slot) => {
            const slotKey = slot.key as MedTimeSlotKey;
            const rawTime = medSlotTimes[slotKey]; // e.g. "08:00"
            // HH:MM → 오전/오후 H:MM 형식으로 변환
            const formatTime = (t: string) => {
              const [hStr, mStr] = t.split(':');
              const h = parseInt(hStr, 10);
              const m = mStr;
              if (h === 0) return `오전 12:${m}`;
              if (h < 12) return `오전 ${h}:${m}`;
              if (h === 12) return `오후 12:${m}`;
              return `오후 ${h - 12}:${m}`;
            };
            const displayTime = formatTime(rawTime);
            const isOn = medTimePrefs[slotKey] && notificationEnabled;
            return (
              <View key={slot.key} style={styles.notifRow}>
                <View style={styles.notifLeft}>
                  <Text style={styles.notifTitle}>{slot.label}  {displayTime}</Text>
                  <Text style={styles.notifSub}>
                    매일 {displayTime}에 복용 알림을 보내요
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Switch
                    value={isOn}
                    onValueChange={() => toggleMedTimeSlot(slotKey)}
                    disabled={!notificationEnabled}
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.white}
                  />
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('MedicationManage', { openSlot: slotKey })}
                    style={{ paddingVertical: 8, paddingHorizontal: 8 }}
                  >
                    <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>}

        {/* ── Card 2: 약효 추적 알림 (환자만) ── */}
        {!isCaregiver && <View style={[styles.card, styles.cardMarginTop]}>
          <View style={styles.cardHeader}>
            <Ionicons
              name="notifications-outline"
              size={24}
              color={Colors.primary}
              style={styles.cardHeaderIcon}
            />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardHeaderTitle}>약효 추적 알림</Text>
              <Text style={styles.cardHeaderSub}>
                약 복용 후 컨디션을 기록해요
              </Text>
            </View>
          </View>

          {medNotifs.map((notif) => (
            <View key={notif.id} style={styles.notifRow}>
              <View style={styles.notifLeft}>
                <Text style={styles.notifTitle}>
                  {minutesToLabel(notif.minutes)}
                </Text>
                <Text style={styles.notifSub}>
                  약 복용 후 {minutesToLabel(notif.minutes)}에 알림을 보내요
                </Text>
              </View>
              <View style={styles.notifRight}>
                <Switch
                  value={notif.enabled && notificationEnabled}
                  onValueChange={() => toggleMed(notif.id)}
                  disabled={!notificationEnabled}
                  trackColor={{
                    false: Colors.border,
                    true: Colors.primary,
                  }}
                  thumbColor={Colors.white}
                />
                <TouchableOpacity
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.iconBtn}
                  onPress={() => openPicker('med', notif.id)}
                >
                  <Ionicons
                    name="create-outline"
                    size={22}
                    color={Colors.textSub}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.iconBtn, styles.iconBtnDelete]}
                  onPress={() => deleteMed(notif.id)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={22}
                    color={Colors.danger}
                  />
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.addRow}
            onPress={() => openPicker('med', null)}
          >
            <Ionicons
              name="add-circle-outline"
              size={22}
              color={Colors.accent}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.addLabel}>알림 추가하기</Text>
          </TouchableOpacity>
        </View>}

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
              <Text style={styles.cardHeaderTitle}>운동 알림</Text>
              <Text style={styles.cardHeaderSub}>매일 운동을 권장해드려요</Text>
            </View>
          </View>

          {exerciseNotifs.map((notif) => (
            <View key={notif.id} style={styles.notifRow}>
              <View style={styles.notifLeft}>
                <Text style={styles.notifTitle}>{formatExerciseNotif(notif)}</Text>
                <Text style={styles.notifSub}>
                  매일 {formatExerciseNotif(notif)}에 운동 알림을 보내요
                </Text>
              </View>
              <View style={styles.notifRight}>
                <Switch
                  value={notif.enabled && notificationEnabled}
                  onValueChange={() => toggleExercise(notif.id)}
                  disabled={!notificationEnabled}
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
            <Text style={styles.addLabel}>알림 추가하기</Text>
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
                <Text style={styles.cardHeaderTitle}>보호자 알림</Text>
                <Text style={styles.cardHeaderSub}>
                  환자가 기록할 때 알림을 받아요
                </Text>
              </View>
            </View>
            {caregiverNotifs.map((notif) => (
              <View key={notif.id} style={styles.notifRow}>
                <View style={styles.notifLeft}>
                  <Text style={styles.notifTitle}>{notif.label}</Text>
                  <Text style={styles.notifSub}>
                    환자 {notif.label} 알림을 받아요
                  </Text>
                </View>
                <Switch
                  value={notif.enabled && notificationEnabled}
                  onValueChange={() => toggleCaregiverNotif(notif.id)}
                  disabled={!notificationEnabled}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.white}
                />
              </View>
            ))}
          </View>
        )}

        {/* ── Card: 환자 알림 수정 (보호자만) ── */}
        {isCaregiver && (
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
                <Text style={styles.cardHeaderTitle}>환자 알림 수정</Text>
                <Text style={styles.cardHeaderSub}>환자 대신 알림 설정을 변경해요</Text>
              </View>
              <Ionicons
                name={showPatientNotifs ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={Colors.textSub}
              />
            </TouchableOpacity>

            {showPatientNotifs && (
              <>
                {/* ── 섹션 1: 약 복용 시간 알림 ── */}
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>약 복용 시간 알림</Text>
                </View>
                {patientActiveMedSlots.length === 0 ? (
                  <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
                    <Text style={{ fontSize: 16, color: Colors.textSub }}>등록된 약이 없어요</Text>
                  </View>
                ) : (
                  MED_TIME_SLOTS.filter(slot => patientActiveMedSlots.includes(slot.key as MedTimeSlotKey)).map((slot) => {
                    const slotKey = slot.key as MedTimeSlotKey;
                    const rawTime = patientMedSlotTimes[slotKey];
                    const formatTime = (t: string) => {
                      const [hStr, mStr] = t.split(':');
                      const h = parseInt(hStr, 10);
                      if (h === 0) return `오전 12:${mStr}`;
                      if (h < 12) return `오전 ${h}:${mStr}`;
                      if (h === 12) return `오후 12:${mStr}`;
                      return `오후 ${h - 12}:${mStr}`;
                    };
                    const displayTime = formatTime(rawTime);
                    const isOn = patientMedTimePrefs[slotKey] && notificationEnabled;
                    return (
                      <View key={slotKey} style={styles.notifRow}>
                        <View style={styles.notifLeft}>
                          <Text style={styles.notifTitle}>{slot.label}  {displayTime}</Text>
                          <Text style={styles.notifSub}>매일 {displayTime}에 복용 알림을 보내요</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Switch
                            value={isOn}
                            onValueChange={() => togglePatientMedTimeSlot(slotKey)}
                            disabled={!notificationEnabled}
                            trackColor={{ false: Colors.border, true: Colors.primary }}
                            thumbColor={Colors.white}
                          />
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => navigation.navigate('MedicationManage', { openSlot: slotKey })}
                            style={{ paddingVertical: 8, paddingHorizontal: 8 }}
                          >
                            <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}

                {/* ── 섹션 2: 약효 추적 알림 ── */}
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4, borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 8 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>약효 추적 알림</Text>
                </View>
                {patientMedNotifs.length === 0 ? (
                  <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
                    <Text style={{ fontSize: 16, color: Colors.textSub }}>설정된 알림이 없어요</Text>
                  </View>
                ) : (
                  patientMedNotifs.map((notif) => (
                    <View key={notif.id} style={styles.notifRow}>
                      <View style={styles.notifLeft}>
                        <Text style={styles.notifTitle}>{minutesToLabel(notif.minutes)}</Text>
                        <Text style={styles.notifSub}>약 복용 후 {minutesToLabel(notif.minutes)}에 알림</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Switch
                          value={notif.enabled && notificationEnabled}
                          onValueChange={() => togglePatientMedNotif(notif.id)}
                          disabled={!notificationEnabled}
                          trackColor={{ false: Colors.border, true: Colors.primary }}
                          thumbColor={Colors.white}
                        />
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => openPatientPicker('med', notif.id)}
                          style={{ paddingVertical: 8, paddingHorizontal: 8 }}
                        >
                          <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}

                {/* ── 섹션 3: 운동 알림 ── */}
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4, borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 8 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>운동 알림</Text>
                </View>
                {patientExerciseNotifs.length === 0 ? (
                  <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
                    <Text style={{ fontSize: 16, color: Colors.textSub }}>설정된 알림이 없어요</Text>
                  </View>
                ) : (
                  patientExerciseNotifs.map((notif) => (
                    <View key={notif.id} style={styles.notifRow}>
                      <View style={styles.notifLeft}>
                        <Text style={styles.notifTitle}>{formatExerciseNotif(notif)}</Text>
                        <Text style={styles.notifSub}>매일 {formatExerciseNotif(notif)}에 운동 알림</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Switch
                          value={notif.enabled && notificationEnabled}
                          onValueChange={() => togglePatientExerciseNotif(notif.id)}
                          disabled={!notificationEnabled}
                          trackColor={{ false: Colors.border, true: Colors.primary }}
                          thumbColor={Colors.white}
                        />
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => openPatientPicker('exercise', notif.id)}
                          style={{ paddingVertical: 8, paddingHorizontal: 8 }}
                        >
                          <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
                <View style={{ height: 8 }} />
              </>
            )}
          </View>
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
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Handle bar */}
            <View style={styles.handle} />

            {pickerType === 'med' ? (
              /* ── Med time picker ── */
              <>
                <Text style={styles.pickerTitle}>알림 시간 선택</Text>

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
                  <Text style={styles.saveBtnText}>저장하기</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={closePicker}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>닫기</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ── Exercise time picker ── */
              <>
                <Text style={styles.pickerTitle}>운동 알림 시간</Text>

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
                          {ap}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Hour label */}
                <Text style={styles.unitLabel}>시</Text>

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
                <Text style={[styles.unitLabel, { marginTop: 16 }]}>분</Text>

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
                  <Text style={styles.saveBtnText}>저장하기</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={closePicker}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>닫기</Text>
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
        onRequestClose={closePatientPicker}
      >
        <Animated.View style={[styles.backdrop, { opacity: patientFadeAnim }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closePatientPicker}
          />
          <Animated.View
            style={[
              styles.sheet,
              { transform: [{ translateY: patientSlideAnim }] },
            ]}
          >
            {/* Handle bar */}
            <View style={styles.handle} />

            {patientPickerType === 'med' ? (
              /* ── 환자 Med time picker ── */
              <>
                <Text style={styles.pickerTitle}>알림 시간 선택</Text>

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
                  <Text style={styles.saveBtnText}>저장하기</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={closePatientPicker}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>닫기</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ── 환자 Exercise time picker ── */
              <>
                <Text style={styles.pickerTitle}>운동 알림 시간</Text>

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
                          {ap}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Hour label */}
                <Text style={styles.unitLabel}>시</Text>

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
                <Text style={[styles.unitLabel, { marginTop: 16 }]}>분</Text>

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
                  <Text style={styles.saveBtnText}>저장하기</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.cancelLink}
                  onPress={closePatientPicker}
                >
                  <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                  <Text style={styles.cancelLinkText}>닫기</Text>
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
            알림이 꺼져 있어요
          </Text>

          {/* 본문 */}
          <Text style={{ fontSize: 18, color: '#444444', textAlign: 'center', lineHeight: 28, marginTop: 10, marginBottom: 28 }}>
            {'약 복용 알림을 받으려면\n스마트폰 설정에서\n파킨온 알림을 켜주세요.'}
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
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#FFFFFF' }}>설정 열기</Text>
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
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#666666' }}>나중에</Text>
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

  // ── Card ──
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
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
  medTimeNote: {
    fontSize: 14,
    color: Colors.textHint,
    marginTop: 12,
    lineHeight: 20,
    paddingHorizontal: 4,
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
    borderTopWidth: 1,
    borderTopColor: '#FDE68A',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  permissionBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#92400E',
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
});
