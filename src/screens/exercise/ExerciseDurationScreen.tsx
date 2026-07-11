import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useExercise } from '../../hooks/useExercise';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useDialog } from '../../context/DialogContext';
import { fetchPatientDoseSlots, resolveDisplaySlots } from '../../hooks/useDoseSlots';
import { nextDoseLabel, slotSortValue, translateRawSlotLabel } from '../../constants/doseSlots';
import { mealTimeToKorean } from '../../utils/medUtils';

// NotificationHistory 등 루트 스택 라우트로도 이동하므로 부모(Root) 네비게이션 타입과 합성한다.
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseDuration'>,
  StackNavigationProp<RootStackParamList>
>;
type RouteProps = NativeStackScreenProps<ExerciseStackParamList, 'ExerciseDuration'>['route'];

// 현재 언어가 영어권인지. 한국어(ko)일 때는 아래 라벨/시간을 기존과 100% 동일하게 유지한다.
function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

const DURATION_GROUPS = [
  { labelKey: 'exercise.durShort', items: [10, 20, 30] },
  { labelKey: 'exercise.durMedium', items: [40, 50, 60] },
  { labelKey: 'exercise.durLong', items: [90, 120, 150, 180] },
];

function formatDuration(min: number): string {
  // 영문은 시:분 분해 대신 기록 리스트(exercise.recordLabel 등)와 동일하게
  // 항상 "{min} min"으로 표기(한 줄 고정 + 저장 후 기록 표시와의 일관성).
  if (isEnLocale()) return `${min} min`;
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
  const hour = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  if (isEnLocale()) return `${hour}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${hour}:${mm}`;
}

// 약효추적 interval(분) → 라벨. ko는 기존과 100% 동일.
function exIntervalLabel(intervalMin: number): string {
  if (isEnLocale()) {
    if (intervalMin === 0) return 'right after taking';
    if (intervalMin < 60) return `${intervalMin} min after taking`;
    const h = Math.floor(intervalMin / 60);
    const rem = intervalMin % 60;
    return rem === 0 ? `${h} hr after taking` : `${h} hr ${rem} min after taking`;
  }
  if (intervalMin === 0) return '복용 직후';
  if (intervalMin < 60) return `복용 ${intervalMin}분 후`;
  const h = Math.floor(intervalMin / 60);
  const rem = intervalMin % 60;
  return rem === 0 ? `복용 ${h}시간 후` : `복용 ${h}시간 ${rem}분 후`;
}

// "{시간대} {interval} 약효추적" 라벨. ko는 기존과 100% 동일.
function exEffectTrackingLabel(mealKo: string | null, intervalLabel: string): string {
  if (isEnLocale()) {
    return mealKo ? `${mealKo} effect tracking, ${intervalLabel}` : `Effect tracking, ${intervalLabel}`;
  }
  return mealKo ? `${mealKo} ${intervalLabel} 약효추적` : `${intervalLabel} 약효추적`;
}

// nextDoseLabel(공용 유틸·한국어 고정)의 로케일 대응 래퍼. ko는 그대로 위임(회귀 0).
function exNextDoseLabelLoc(
  legacyKey: Parameters<typeof nextDoseLabel>[0],
  label: string | null | undefined,
  time: string | null | undefined,
): string {
  if (!isEnLocale()) return nextDoseLabel(legacyKey, label, time);
  if (legacyKey) return `Next ${mealTimeToKorean(legacyKey)}`;
  const trimmed = (label ?? '').trim();
  if (trimmed) return `Next ${trimmed}`;
  return time ? `Next dose (${time})` : 'Next dose';
}

async function fetchExerciseNextNotif(patientId: string): Promise<ExNextNotifInfo | null> {
  try {
    const now = new Date();
    let candidates: Array<{ minutesLeft: number; label: string; sendAt: Date }> = [];

    // 1) 약효추적 큐
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
        mealKo = translateRawSlotLabel(qSlot?.label) ?? mealTimeToKorean(row.meal_time);
      } else {
        mealKo = mealTimeToKorean(row.meal_time);
      }
      const intervalLabel = exIntervalLabel(intervalMin);
      const label = exEffectTrackingLabel(mealKo, intervalLabel);
      candidates.push({ minutesLeft, label, sendAt });
    }

    // 2) 다음 복용 안내 — dose_slots 순회(없으면 meal_schedules legacy 폴백) + exercise_notif_prefs
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('meal_schedules, exercise_notif_prefs')
      .eq('id', patientId)
      .single();

    if (userError) console.error('[fetchExerciseNextNotif] userData error:', userError);

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
          label: exNextDoseLabelLoc(slot.legacyKey, slot.label, slot.time),
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
        const baseLabel = exNextDoseLabelLoc(first.legacyKey, first.label, first.time);
        const tomorrowLabel = isEnLocale()
          ? `Tomorrow, ${baseLabel.replace(/^Next /, '')}`
          : `내일 ${baseLabel.replace(/^다음 /, '')}`;
        candidates.push({
          minutesLeft,
          label: tomorrowLabel,
          sendAt: tomorrowFirst,
        });
      }
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
          candidates.push({ minutesLeft, label: isEnLocale() ? 'Exercise reminder' : '운동 알림', sendAt: scheduled });
        }
      }
    }

    // 최후 폴백: candidates가 비어있으면 내일 아침 08:00
    if (candidates.length === 0) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      return {
        label: isEnLocale() ? 'Tomorrow, morning dose' : '내일 아침약 복용',
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
  const { unreadCount, refreshBadge } = useNotificationBadge();
  const { user } = useAuth();
  const dialog = useDialog();
  const { t } = useTranslation();
  const [showNextNotifModal, setShowNextNotifModal] = useState(false);
  const [nextNotifInfo, setNextNotifInfo] = useState<ExNextNotifInfo | null>(null);
  const [savedExerciseName, setSavedExerciseName] = useState('');
  const [savedDuration, setSavedDuration] = useState(0);
  // 저장 후 후속 동작(다음알림 모달 / 완료·오류 알림)을 저장 오버레이가 완전히 사라진 뒤
  // 단독 present 하기 위해 보관한다. iOS는 닫히는 Modal 위에 새 Modal을 못 띄워(적층 교착)
  // 오버레이와 같은 tick에 모달을 열면 표시되지 않아 화면이 멈춘다(BodyStateScreen과 동일 패턴).
  const pendingAfterSaveRef = useRef<
    | { kind: 'next'; info: ExNextNotifInfo | null }
    | { kind: 'alert'; title?: string; message?: string; thenReset: boolean }
    | null
  >(null);

  const handleSave = async () => {
    if (!selected) {
      dialog.alert({ title: t('exercise.timeAlertTitle'), message: t('exercise.timeAlertMsg') });
      return;
    }
    setSaving(true);
    // 저장과 다음 알림 조회를 병렬 실행 (서로 독립적)
    const patientId = user?.role === 'patient' ? user?.id : null;
    let success = false;
    let info: ExNextNotifInfo | null = null;
    try {
      [success, info] = await Promise.all([
        saveExercise(exerciseName, selected),
        patientId ? fetchExerciseNextNotif(patientId) : Promise.resolve(null),
      ]);
    } catch (e) {
      console.error('[ExerciseDurationScreen] handleSave 오류:', e);
    } finally {
      // 위 저장/조회 중 예기치 못한 예외가 나도 저장중 오버레이가 영구히 뜬 채
      // 멈춘 것처럼 보이는 상황을 막기 위해 반드시 해제한다.
      setSaving(false);
    }
    // 후속 동작은 여기서 바로 present하지 않고 ref에 담아둔다 → 저장 오버레이가 사라진 뒤
    // onHidden에서 단독 present(iOS Modal 적층 교착 회피). 이게 없으면 iOS에서 다음알림
    // 모달/완료알림이 안 떠 확인·화면전환이 막혀 ExerciseDuration에 그대로 멈춘다.
    if (success) {
      refreshBadge().catch(() => {});
      setSavedExerciseName(exerciseName);
      setSavedDuration(selected);
      if (info) {
        pendingAfterSaveRef.current = { kind: 'next', info };
      } else {
        pendingAfterSaveRef.current = {
          kind: 'alert',
          title: t('exercise.savedTitle'),
          message: t('exercise.savedMsg', { name: exerciseName, duration: formatDuration(selected) }),
          thenReset: true,
        };
      }
    } else {
      pendingAfterSaveRef.current = {
        kind: 'alert',
        title: t('common.error'),
        message: t('exercise.saveErrorMsg'),
        thenReset: false,
      };
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={t('exercise.durationTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <ScrollView style={styles.flex1} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.question}>{t('exercise.durationQuestion')}</Text>
        <Text style={styles.exerciseName}>{exerciseName}</Text>

        {DURATION_GROUPS.map((group) => (
          <View key={group.labelKey} style={styles.group}>
            <Text style={styles.groupLabel}>{t(group.labelKey)}</Text>
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

        {/* 저장하기 — 고정 바 없이 내용 맨 끝 일반 버튼(다른 화면처럼 스크롤) */}
        <View style={styles.saveBtnWrap}>
          <PrimaryButton title={t('exercise.saveButton')} onPress={handleSave} disabled={!selected || saving} />
        </View>
      </ScrollView>

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
      <BrandProgressOverlay
        visible={saving}
        title={t('exercise.savingTitle')}
        minVisibleMs={500}
        // 스피너 Modal이 완전히 사라진 뒤에만 후속 모달/알림을 단독 present(두 Modal 적층 불가 → 멈춤 0).
        onHidden={() => {
          const p = pendingAfterSaveRef.current;
          pendingAfterSaveRef.current = null;
          if (!p) return;
          if (p.kind === 'next') {
            if (p.info) {
              setNextNotifInfo(p.info);
              setShowNextNotifModal(true);
            } else {
              navigation.reset({ index: 0, routes: [{ name: 'ExerciseMain' }] });
            }
            return;
          }
          // kind === 'alert' — 완료(→ 확인 후 reset) 또는 오류(머무름)
          const thenReset = p.thenReset;
          dialog.alert({ title: p.title, message: p.message }).then(() => {
            if (thenReset) navigation.reset({ index: 0, routes: [{ name: 'ExerciseMain' }] });
          });
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
  const { t } = useTranslation();
  if (!visible || !info) return null;

  const minutesText = formatDuration(info.minutesLeft);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={exNnStyles.overlay}>
        <View style={exNnStyles.card}>
          <Text style={exNnStyles.saveIcon}>👏</Text>
          <Text style={exNnStyles.saveText}>
            {t('exercise.completeMsg', { name: exerciseName, duration: formatDuration(duration) })}
          </Text>

          <View style={exNnStyles.divider} />

          <Text style={exNnStyles.icon}>🔔</Text>
          <Text style={exNnStyles.title}>{t('exercise.nextNotifTitle')}</Text>

          <View style={exNnStyles.labelPill}>
            <Text style={exNnStyles.labelPillText}>{info.label}</Text>
          </View>

          <Text style={exNnStyles.timeText}>{info.timeStr}</Text>

          <Text style={exNnStyles.subText}>
            {t('exercise.nextNotifSub', { minutes: minutesText })}
          </Text>

          <TouchableOpacity style={exNnStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={exNnStyles.closeBtnText}>{t('common.confirm')}</Text>
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
  flex1: { flex: 1 },
  saveBtnWrap: { marginTop: 24 },
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
