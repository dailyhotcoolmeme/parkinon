import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useExercise } from '../../hooks/useExercise';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

type Nav = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseDuration'>;
type RouteProps = NativeStackScreenProps<ExerciseStackParamList, 'ExerciseDuration'>['route'];

const DURATION_GROUPS = [
  { label: '짧게', items: [10, 20, 30] },
  { label: '보통', items: [40, 50, 60] },
  { label: '길게', items: [90, 120, 150, 180] },
];

function formatDuration(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

// ─── NextNotifInfo 타입 (ExerciseDurationScreen 전용) ───────────────────────

interface ExNextNotifInfo {
  label: string;
  timeStr: string;
  minutesLeft: number;
}

function exFormatTimeHHMM(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour}:${m.toString().padStart(2, '0')}`;
}

const EX_MEAL_TIME_KO: Record<string, string> = {
  morning: '아침약', lunch: '점심약', dinner: '저녁약', bedtime: '취침약',
};
const EX_DEFAULT_MEAL_TIMES: Record<string, string> = {
  morning: '08:00', lunch: '12:00', dinner: '18:00', bedtime: '22:00',
};

async function fetchExerciseNextNotif(patientId: string): Promise<ExNextNotifInfo | null> {
  try {
    const now = new Date();
    let candidates: Array<{ minutesLeft: number; label: string; sendAt: Date }> = [];

    // 1) 약효추적 큐
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
      const mealKo = row.meal_time ? (EX_MEAL_TIME_KO[row.meal_time] ?? '') : '';
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

    // 2) meal_schedules + exercise_notif_prefs
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('meal_schedules, exercise_notif_prefs')
      .eq('id', patientId)
      .single();

    if (userError) console.error('[fetchExerciseNextNotif] userData error:', userError);

    const mealSchedules: Record<string, string> = (userData?.meal_schedules as Record<string, string>) ?? EX_DEFAULT_MEAL_TIMES;
    const MEAL_LABELS: Record<string, string> = {
      morning: '다음 아침약 복용', lunch: '다음 점심약 복용',
      dinner: '다음 저녁약 복용', bedtime: '다음 취침약 복용',
    };
    let foundMeal = false;
    for (const key of ['morning', 'lunch', 'dinner', 'bedtime']) {
      const timeStr = mealSchedules[key] ?? EX_DEFAULT_MEAL_TIMES[key];
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
      const morningStr = mealSchedules['morning'] ?? EX_DEFAULT_MEAL_TIMES['morning'];
      const [mh, mm] = morningStr.split(':').map(Number);
      tomorrowMorning.setHours(mh, mm, 0, 0);
      const minutesLeft = Math.round((tomorrowMorning.getTime() - now.getTime()) / 60000);
      candidates.push({ minutesLeft, label: '내일 아침약 복용', sendAt: tomorrowMorning });
    }

    // 3) 운동 알림 (exercise_notif_prefs)
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
        timeStr: exFormatTimeHHMM(tomorrow),
        minutesLeft: Math.round((tomorrow.getTime() - now.getTime()) / 60000),
      };
    }

    candidates.sort((a, b) => a.minutesLeft - b.minutesLeft);
    const best = candidates[0];
    if (best.minutesLeft < 1) return null;
    return { label: best.label, timeStr: exFormatTimeHHMM(best.sendAt), minutesLeft: best.minutesLeft };
  } catch (e) {
    console.error('[fetchExerciseNextNotif] error:', e);
    return null;
  }
}

export function ExerciseDurationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const { exerciseName } = route.params;
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { saveExercise } = useExercise();
  const { unreadCount } = useNotificationBadge();
  const { user } = useAuth();
  const [showNextNotifModal, setShowNextNotifModal] = useState(false);
  const [nextNotifInfo, setNextNotifInfo] = useState<ExNextNotifInfo | null>(null);
  const [savedExerciseName, setSavedExerciseName] = useState('');
  const [savedDuration, setSavedDuration] = useState(0);

  const handleSave = async () => {
    if (!selected) {
      Alert.alert('시간 선택', '운동 시간을 선택해주세요.');
      return;
    }
    setSaving(true);
    // 저장과 다음 알림 조회를 병렬 실행 (서로 독립적)
    const patientId = user?.role === 'patient' ? user?.id : null;
    const [success, info] = await Promise.all([
      saveExercise(exerciseName, selected),
      patientId ? fetchExerciseNextNotif(patientId) : Promise.resolve(null),
    ]);
    setSaving(false);
    if (success) {
      setSavedExerciseName(exerciseName);
      setSavedDuration(selected);
      if (info) {
        setNextNotifInfo(info);
        setShowNextNotifModal(true);
        return;
      }
      // 알림 없으면 바로 완료 알림
      Alert.alert(
        '저장 완료',
        `${exerciseName} ${formatDuration(selected)}을 기록했어요! 👏`,
        [{ text: '확인', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'ExerciseMain' }] }) }],
      );
    } else {
      Alert.alert('오류', '기록 저장에 실패했어요. 다시 시도해주세요.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar
        title="운동 시간"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.question}>얼마나 하셨나요?</Text>
        <Text style={styles.exerciseName}>{exerciseName}</Text>

        {DURATION_GROUPS.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={styles.row}>
              {group.items.map((dur) => (
                <TouchableOpacity
                  key={dur}
                  style={[styles.durBtn, selected === dur && styles.durBtnSelected]}
                  onPress={() => setSelected(dur)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.durText, selected === dur && styles.durTextSelected]}>
                    {formatDuration(dur)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottom}>
        <PrimaryButton title={saving ? '저장 중...' : '저장하기'} onPress={handleSave} disabled={!selected || saving} />
      </View>

      <ExNextNotifModal
        visible={showNextNotifModal}
        info={nextNotifInfo}
        exerciseName={savedExerciseName}
        duration={savedDuration}
        onClose={() => {
          setShowNextNotifModal(false);
          navigation.reset({ index: 0, routes: [{ name: 'ExerciseMain' }] });
        }}
      />
    </SafeAreaView>
  );
}

// ─── ExNextNotifModal ─────────────────────────────────────────────────────────

function ExNextNotifModal({
  visible, info, exerciseName, duration, onClose,
}: {
  visible: boolean;
  info: ExNextNotifInfo | null;
  exerciseName: string;
  duration: number;
  onClose: () => void;
}) {
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
      <View style={exNnStyles.overlay}>
        <View style={exNnStyles.card}>
          <Text style={exNnStyles.saveIcon}>👏</Text>
          <Text style={exNnStyles.saveText}>
            {exerciseName} {formatDuration(duration)} 기록 완료!
          </Text>

          <View style={exNnStyles.divider} />

          <Text style={exNnStyles.icon}>🔔</Text>
          <Text style={exNnStyles.title}>다음 알림 예고</Text>

          <View style={exNnStyles.labelPill}>
            <Text style={exNnStyles.labelPillText}>{info.label}</Text>
          </View>

          <Text style={exNnStyles.timeText}>{info.timeStr}</Text>

          <Text style={exNnStyles.subText}>
            지금부터 약 {minutesText} 후에{'\n'}알림을 보내드릴게요
          </Text>

          <TouchableOpacity style={exNnStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={exNnStyles.closeBtnText}>확인</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const exNnStyles = StyleSheet.create({
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
  saveIcon: { fontSize: 36, marginBottom: 8 },
  saveText: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 16, textAlign: 'center' },
  divider: { width: '100%', height: 1, backgroundColor: Colors.border, marginBottom: 20 },
  icon: { fontSize: 36, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 16 },
  labelPill: {
    backgroundColor: '#FF6B00',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 14,
  },
  labelPillText: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' },
  timeText: { fontSize: 28, fontWeight: '800', color: '#FF6B00', marginBottom: 14 },
  subText: { fontSize: 17, color: Colors.textSub, lineHeight: 26, textAlign: 'center', marginBottom: 24 },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 24 },
  question: { fontSize: 26, fontWeight: '800', color: Colors.text, marginBottom: 6, marginTop: 4 },
  exerciseName: { fontSize: 18, color: Colors.primary, fontWeight: '700', marginBottom: 28 },

  group: { marginBottom: 20 },
  groupLabel: { fontSize: 15, fontWeight: '700', color: Colors.textSub, marginBottom: 10, letterSpacing: 0.3 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },

  durBtn: {
    flex: 1, minWidth: '28%', minHeight: 72,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  durBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.light },
  durText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  durTextSelected: { color: Colors.dark, fontWeight: '800' },

  bottom: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, backgroundColor: Colors.background },
});
