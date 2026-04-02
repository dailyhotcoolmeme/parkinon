import React, { useState, useRef } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Data model ───────────────────────────────────────────────────────────────

interface MedNotif {
  id: string;
  minutes: number;
  enabled: boolean;
}

interface ExerciseNotif {
  id: string;
  ampm: '오전' | '오후';
  hour: number;
  minute: number;
  enabled: boolean;
}

function minutesToLabel(m: number): string {
  if (m === 0) return '복용 직후';
  if (m < 60) return `${m}분 후`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`;
}

const MED_TIME_OPTIONS = [0, 10, 30, 60, 90, 120, 180, 240];
const EXERCISE_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EXERCISE_MINUTES = [0, 10, 20, 30, 40, 50];

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsScreen() {
  // Med notifications
  const [medNotifs, setMedNotifs] = useState<MedNotif[]>([
    { id: '1', minutes: 0, enabled: true },
    { id: '2', minutes: 30, enabled: true },
    { id: '3', minutes: 120, enabled: true },
  ]);

  // Exercise notifications (multiple times)
  const [exerciseNotifs, setExerciseNotifs] = useState<ExerciseNotif[]>([
    { id: '1', ampm: '오후', hour: 2, minute: 0, enabled: true },
  ]);

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

  // Caregiver (kept for data completeness)
  const isCaregiver = false;
  const [caregiverNotifs, setCaregiverNotifs] = useState([
    { id: 'taken', label: '약 복용 시', enabled: true },
    { id: 'missed', label: '약 미복용 시', enabled: true },
    { id: 'exercise', label: '운동 완료 시', enabled: true },
  ]);

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

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const toggleMed = (id: string) => {
    setMedNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n))
    );
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

  const toggleCaregiverNotif = (id: string) => {
    setCaregiverNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n))
    );
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
        {/* ── Card 1: 약효 추적 알림 ── */}
        <View style={styles.card}>
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
                  {notif.enabled ? '알림이 켜져 있어요' : '알림이 꺼져 있어요'}
                </Text>
              </View>
              <View style={styles.notifRight}>
                <Switch
                  value={notif.enabled}
                  onValueChange={() => toggleMed(notif.id)}
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
        </View>

        {/* ── Card 2: 운동 알림 ── */}
        <View style={[styles.card, styles.cardMarginTop]}>
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
                  {notif.enabled ? '알림이 켜져 있어요' : '알림이 꺼져 있어요'}
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
        </View>

        {/* ── Card 3: 보호자 알림 (보호자에게만 표시) ── */}
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
                  환자 활동을 알려드려요
                </Text>
              </View>
            </View>
            {caregiverNotifs.map((notif) => (
              <View key={notif.id} style={styles.notifRow}>
                <Text style={[styles.notifTitle, { flex: 1 }]}>
                  {notif.label}
                </Text>
                <Switch
                  value={notif.enabled}
                  onValueChange={() => toggleCaregiverNotif(notif.id)}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.white}
                />
              </View>
            ))}
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
