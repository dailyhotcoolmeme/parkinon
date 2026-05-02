import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { usePatientId } from '../../hooks/usePatientId';
import { supabase } from '../../lib/supabase';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

type NavProp = StackNavigationProp<MenuStackParamList>;
type RouteType = RouteProp<{ AppointmentWrite: { appointmentId?: string } }, 'AppointmentWrite'>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const ITEM_H = 58;
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();

const PICKER_YEARS = Array.from({ length: 5 }, (_, i) => CUR_YEAR + i);
const PICKER_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const PICKER_HOURS = Array.from({ length: 24 }, (_, i) => i);
const PICKER_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

// 오늘 날짜 (시간 제거)
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

function getDaysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function getDayOfWeek(y: number, m: number, d: number): string {
  return DAYS_KR[new Date(y, m - 1, d).getDay()];
}

// ─── 알림 유틸 ──────────────────────────────────────────────────────────────
async function ensureNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const { status: newStatus } = await Notifications.requestPermissionsAsync();
  return newStatus === 'granted';
}

async function scheduleNotification(triggerDate: Date, title: string, body: string): Promise<string | null> {
  if (triggerDate <= new Date()) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
  } catch { return null; }
}

async function cancelNotifications(ids: string[]) {
  for (const id of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
  }
}

// ─── 컬럼 피커 컴포넌트 ─────────────────────────────────────────────────────
function PickerCol({
  data, selected, onSelect, suffix, padLen = 0, getLabel, fontSize = 20,
}: {
  data: number[];
  selected: number;
  onSelect: (v: number) => void;
  suffix: string;
  padLen?: number;
  getLabel?: (v: number) => string;
  fontSize?: number;
}) {
  const ref = useRef<FlatList<number>>(null);
  const selectedIndex = Math.max(0, data.indexOf(selected));

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollToOffset({ offset: selectedIndex * ITEM_H, animated: false });
    }
  }, [selected, selectedIndex]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList<number>
        ref={ref}
        data={data}
        keyExtractor={(item) => String(item)}
        initialScrollIndex={selectedIndex}
        getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={() => {}}
        onLayout={() => {
          if (ref.current) {
            ref.current.scrollToOffset({ offset: selectedIndex * ITEM_H, animated: false });
          }
        }}
        renderItem={({ item }) => {
          const isSelected = item === selected;
          const label = getLabel
            ? getLabel(item)
            : padLen > 0
              ? String(item).padStart(padLen, '0') + suffix
              : String(item) + suffix;
          return (
            <TouchableOpacity
              style={[colStyles.item, isSelected && colStyles.itemActive]}
              onPress={() => onSelect(item)}
              activeOpacity={0.7}
            >
              <Text style={[colStyles.itemText, { fontSize }, isSelected && colStyles.itemTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

// ─── 날짜 선택 모달 ─────────────────────────────────────────────────────────
function DatePickerModal({
  visible, year, month, day,
  onYearChange, onMonthChange, onDayChange,
  onConfirm, onClose,
}: {
  visible: boolean;
  year: number; month: number; day: number;
  onYearChange: (v: number) => void;
  onMonthChange: (v: number) => void;
  onDayChange: (v: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // 선택 가능한 월 목록: 올해면 오늘 월 이후만, 그 외 전체
  const availableMonths = year === TODAY.getFullYear()
    ? PICKER_MONTHS.filter(m => m >= TODAY.getMonth() + 1)
    : PICKER_MONTHS;

  // 선택 가능한 일 목록: 올해·이번달이면 오늘 일 이후만, 그 외 전체
  const allDays = Array.from({ length: getDaysInMonth(year, month) }, (_, i) => i + 1);
  const days = (year === TODAY.getFullYear() && month === TODAY.getMonth() + 1)
    ? allDays.filter(d => d >= TODAY.getDate())
    : allDays;

  // 연도 변경 시 월/일이 과거로 내려가지 않도록 보정
  const handleYearChange = (y: number) => {
    onYearChange(y);
    if (y === TODAY.getFullYear()) {
      const minMonth = TODAY.getMonth() + 1;
      if (month < minMonth) {
        onMonthChange(minMonth);
        onDayChange(TODAY.getDate());
      } else if (month === minMonth && day < TODAY.getDate()) {
        onDayChange(TODAY.getDate());
      }
    }
  };

  // 월 변경 시 day가 availableMonths에서 벗어나지 않도록 보정
  const handleMonthChange = (m: number) => {
    onMonthChange(m);
    if (year === TODAY.getFullYear() && m === TODAY.getMonth() + 1 && day < TODAY.getDate()) {
      onDayChange(TODAY.getDate());
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={mpStyles.container}>
        <TouchableOpacity style={mpStyles.overlay} onPress={onClose} activeOpacity={1} />
        <View style={mpStyles.sheet}>
          <View style={mpStyles.handle} />
          <Text style={mpStyles.title}>날짜 선택</Text>
          <View style={mpStyles.colsRow}>
            {/* 년도 */}
            <View style={{ flex: 5 }}>
              <Text style={mpStyles.colHeader}>년도</Text>
              <PickerCol
                data={PICKER_YEARS}
                selected={year}
                onSelect={handleYearChange}
                suffix="년"
                fontSize={19}
              />
            </View>
            <View style={mpStyles.colDivider} />
            {/* 월 */}
            <View style={{ flex: 3 }}>
              <Text style={mpStyles.colHeader}>월</Text>
              <PickerCol
                data={availableMonths}
                selected={month}
                onSelect={handleMonthChange}
                suffix="월"
                fontSize={19}
              />
            </View>
            <View style={mpStyles.colDivider} />
            {/* 일 + 요일 */}
            <View style={{ flex: 5 }}>
              <Text style={mpStyles.colHeader}>일</Text>
              <PickerCol
                data={days}
                selected={day}
                onSelect={onDayChange}
                suffix="일"
                fontSize={18}
                getLabel={(d) => `${d}일 (${getDayOfWeek(year, month, d)})`}
              />
            </View>
          </View>
          <TouchableOpacity style={mpStyles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={mpStyles.confirmText}>선택 완료</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── 시간 선택 모달 ─────────────────────────────────────────────────────────
function TimePickerModal({
  visible, hour, minute,
  onHourChange, onMinuteChange,
  onConfirm, onClose,
}: {
  visible: boolean;
  hour: number; minute: number;
  onHourChange: (v: number) => void;
  onMinuteChange: (v: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={mpStyles.container}>
        <TouchableOpacity style={mpStyles.overlay} onPress={onClose} activeOpacity={1} />
        <View style={mpStyles.sheet}>
          <View style={mpStyles.handle} />
          <Text style={mpStyles.title}>시간 선택</Text>
          <View style={mpStyles.colsRow}>
            <View style={{ flex: 1 }}>
              <Text style={mpStyles.colHeader}>시</Text>
              <PickerCol
                data={PICKER_HOURS}
                selected={hour}
                onSelect={onHourChange}
                suffix="시"
                padLen={2}
              />
            </View>
            <View style={mpStyles.colDivider} />
            <View style={{ flex: 1 }}>
              <Text style={mpStyles.colHeader}>분</Text>
              <PickerCol
                data={PICKER_MINUTES}
                selected={minute}
                onSelect={onMinuteChange}
                suffix="분"
                padLen={2}
              />
            </View>
          </View>
          <TouchableOpacity style={mpStyles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={mpStyles.confirmText}>선택 완료</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── 메인 화면 ───────────────────────────────────────────────────────────────
export function AppointmentWriteScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteType>();
  const appointmentId = (route.params as any)?.appointmentId as string | undefined;
  const { user } = useAuth();
  const { patientId } = usePatientId();
  const { unreadCount } = useNotificationBadge();

  // 내일 10:00 기본값
  const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  const [selYear, setSelYear] = useState(tomorrow.getFullYear());
  const [selMonth, setSelMonth] = useState(tomorrow.getMonth() + 1);
  const [selDay, setSelDay] = useState(tomorrow.getDate());
  const [selHour, setSelHour] = useState(10);
  const [selMinute, setSelMinute] = useState(0);

  // 피커 임시 상태 (취소 시 원래값 유지)
  const [tmpYear, setTmpYear] = useState(selYear);
  const [tmpMonth, setTmpMonth] = useState(selMonth);
  const [tmpDay, setTmpDay] = useState(selDay);
  const [tmpHour, setTmpHour] = useState(selHour);
  const [tmpMinute, setTmpMinute] = useState(selMinute);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [hospitalName, setHospitalName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [notifyWeekBefore, setNotifyWeekBefore] = useState(true);
  const [notifyDayBefore, setNotifyDayBefore] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [existingNotifIds, setExistingNotifIds] = useState<string[]>([]);
  const [isFirstAppointment, setIsFirstAppointment] = useState(false);

  // 월/연도 바뀌면 일 범위 초과 시 클램프
  useEffect(() => {
    const maxDay = getDaysInMonth(tmpYear, tmpMonth);
    if (tmpDay > maxDay) setTmpDay(maxDay);
  }, [tmpYear, tmpMonth]);

  // 신규 등록: 이전 진료 기록에서 병원명/의사명 자동완성
  useEffect(() => {
    if (appointmentId || !user) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? SUPABASE_ANON_KEY;
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_appointments?patient_id=eq.${patientId ?? user.id}&order=created_at.desc&limit=1`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            if (data[0].hospital_name) setHospitalName(data[0].hospital_name);
            if (data[0].doctor_name) setDoctorName(data[0].doctor_name);
          } else {
            setIsFirstAppointment(true);
          }
        }
      } catch {}
    })();
  }, [user, appointmentId]);

  // 수정 모드: 기존 데이터 로드
  useEffect(() => {
    if (!appointmentId || !user) return;
    (async () => {
      setIsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? SUPABASE_ANON_KEY;
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_appointments?id=eq.${appointmentId}`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error('데이터 로드 실패');
        const data = await res.json();
        if (data.length > 0) {
          const appt = data[0];
          const d = new Date(appt.appointment_date);
          setSelYear(d.getFullYear());
          setSelMonth(d.getMonth() + 1);
          setSelDay(d.getDate());
          setSelHour(d.getHours());
          const rawMin = d.getMinutes();
          setSelMinute(Math.round(rawMin / 5) * 5 % 60);
          setHospitalName(appt.hospital_name ?? '');
          setDoctorName(appt.doctor_name ?? '');
          if (appt.notification_ids?.length > 0) setExistingNotifIds(appt.notification_ids);
        }
      } catch (e: any) {
        Alert.alert('오류', e.message ?? '데이터를 불러오지 못했어요.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [appointmentId, user]);

  const openDatePicker = () => {
    setTmpYear(selYear); setTmpMonth(selMonth); setTmpDay(selDay);
    setShowDatePicker(true);
  };

  const openTimePicker = () => {
    setTmpHour(selHour); setTmpMinute(selMinute);
    setShowTimePicker(true);
  };

  const confirmDate = () => {
    const maxDay = getDaysInMonth(tmpYear, tmpMonth);
    let safeDay = Math.min(tmpDay, maxDay);
    // 과거 날짜 최종 방어: 오늘 이전이면 오늘로 보정
    const chosen = new Date(tmpYear, tmpMonth - 1, safeDay);
    if (chosen < TODAY) {
      setSelYear(TODAY.getFullYear());
      setSelMonth(TODAY.getMonth() + 1);
      setSelDay(TODAY.getDate());
    } else {
      setSelYear(tmpYear); setSelMonth(tmpMonth); setSelDay(safeDay);
    }
    setShowDatePicker(false);
  };

  const confirmTime = () => {
    setSelHour(tmpHour); setSelMinute(tmpMinute);
    setShowTimePicker(false);
  };

  const dow = getDayOfWeek(selYear, selMonth, selDay);
  const displayDate = `${selYear}년 ${selMonth}월 ${selDay}일 (${dow})`;
  const displayTime = `${String(selHour).padStart(2, '0')}시 ${String(selMinute).padStart(2, '0')}분`;

  const handleSave = async () => {
    if (!user) return;
    const apptDate = new Date(selYear, selMonth - 1, selDay, selHour, selMinute);

    setIsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? SUPABASE_ANON_KEY;
      const headers: Record<string, string> = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      };

      if (existingNotifIds.length > 0) await cancelNotifications(existingNotifIds);

      const newNotifIds: string[] = [];
      const hasPermission = (notifyWeekBefore || notifyDayBefore)
        ? await ensureNotificationPermission() : false;

      if (hasPermission) {
        const weekBefore = new Date(apptDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const dayBefore = new Date(apptDate.getTime() - 24 * 60 * 60 * 1000);
        if (notifyWeekBefore) {
          const id = await scheduleNotification(weekBefore, '진료 일정 알림', `${hospitalName.trim()} 진료가 1주일 후입니다.`);
          if (id) newNotifIds.push(id);
        }
        if (notifyDayBefore) {
          const id = await scheduleNotification(dayBefore, '진료 일정 알림', `${hospitalName.trim()} 진료가 내일입니다.`);
          if (id) newNotifIds.push(id);
        }
      }

      const payload = {
        patient_id: patientId ?? user.id,
        appointment_date: apptDate.toISOString(),
        hospital_name: hospitalName.trim() || null,
        doctor_name: doctorName.trim() || null,
        notify_week_before: notifyWeekBefore,
        notify_day_before: notifyDayBefore,
        notified_week: false,
        notified_day: false,
        notification_ids: newNotifIds.length > 0 ? newNotifIds : null,
      };

      if (appointmentId) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_appointments?id=eq.${appointmentId}`,
          { method: 'PATCH', headers, body: JSON.stringify(payload) },
        );
        if (!res.ok) throw new Error('일정 수정에 실패했어요.');
      } else {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_appointments`,
          { method: 'POST', headers, body: JSON.stringify(payload) },
        );
        if (!res.ok) throw new Error('일정 저장에 실패했어요.');
      }

      Alert.alert('저장 완료', '진료 일정이 저장되었어요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '저장에 실패했어요.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <TopBar
          title={appointmentId ? '일정 수정' : '진료 일정 등록'}
          showBack
          showBell
          bellBadge={unreadCount}
          onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title={appointmentId ? '일정 수정' : '진료 일정 등록'} showBack />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* 진료 날짜 */}
          <Text style={styles.label}>진료 날짜 *</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={openDatePicker} activeOpacity={0.8}>
            <Text style={styles.pickerBtnText}>📅  {displayDate}</Text>
            <Text style={styles.pickerArrow}>▼</Text>
          </TouchableOpacity>

          {/* 진료 시간 */}
          <Text style={styles.label}>진료 시간 *</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={openTimePicker} activeOpacity={0.8}>
            <Text style={styles.pickerBtnText}>🕐  {displayTime}</Text>
            <Text style={styles.pickerArrow}>▼</Text>
          </TouchableOpacity>

          {/* 처음 등록 안내 */}
          {isFirstAppointment && (
            <View style={styles.hintCard}>
              <Text style={styles.hintText}>
                💡 병원명과 의사명을 한 번만 입력하면{'\n'}다음부터는 자동으로 불러와요
              </Text>
            </View>
          )}

          {/* 병원명 */}
          <Text style={styles.label}>병원명 *</Text>
          <TextInput
            style={styles.input}
            placeholder="예) 한강성심병원"
            placeholderTextColor={Colors.textHint}
            value={hospitalName}
            onChangeText={setHospitalName}
            maxLength={50}
          />

          {/* 의사명 */}
          <Text style={styles.label}>의사명</Text>
          <TextInput
            style={styles.input}
            placeholder="예) 김민준"
            placeholderTextColor={Colors.textHint}
            value={doctorName}
            onChangeText={setDoctorName}
            maxLength={30}
          />

          {/* 알림 설정 */}
          <View style={styles.sectionLabelRow}>
            <Ionicons name="notifications-outline" size={24} color={Colors.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.label, { marginTop: 0 }]}>알림 설정</Text>
          </View>
          <View style={styles.notifCard}>
            <View style={styles.notifRow}>
              <View style={styles.notifLeft}>
                <Text style={styles.notifTitle}>1주일 전 알림</Text>
                <Text style={styles.notifDesc}>진료 7일 전에 알려드려요</Text>
              </View>
              <Switch
                value={notifyWeekBefore}
                onValueChange={setNotifyWeekBefore}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={Colors.white}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.notifRow}>
              <View style={styles.notifLeft}>
                <Text style={styles.notifTitle}>하루 전 알림</Text>
                <Text style={styles.notifDesc}>진료 1일 전에 알려드려요</Text>
              </View>
              <Switch
                value={notifyDayBefore}
                onValueChange={setNotifyDayBefore}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={Colors.white}
              />
            </View>
          </View>
          <Text style={styles.notifNote}>알림이 오려면 기기 알림 설정을 허용해 주세요.</Text>

          {/* 저장 버튼 */}
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleSave}
            activeOpacity={0.8}
            disabled={isSaving}
          >
            {isSaving
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={styles.saveBtnText}>저장하기</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <DatePickerModal
        visible={showDatePicker}
        year={tmpYear} month={tmpMonth} day={tmpDay}
        onYearChange={setTmpYear}
        onMonthChange={setTmpMonth}
        onDayChange={setTmpDay}
        onConfirm={confirmDate}
        onClose={() => setShowDatePicker(false)}
      />

      <TimePickerModal
        visible={showTimePicker}
        hour={tmpHour} minute={tmpMinute}
        onHourChange={setTmpHour}
        onMinuteChange={setTmpMinute}
        onConfirm={confirmTime}
        onClose={() => setShowTimePicker(false)}
      />
    </SafeAreaView>
  );
}

// ─── 스타일 ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },
  label: {
    fontSize: 18, fontWeight: '700', color: Colors.text,
    marginBottom: 8, marginTop: 20,
  },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1.5,
    borderColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 14, minHeight: 56,
  },
  pickerBtnText: { fontSize: 18, color: Colors.text, fontWeight: '600' },
  pickerArrow: { fontSize: 14, color: Colors.textSub },
  hintCard: {
    backgroundColor: '#FFF8E1', borderRadius: 10, borderWidth: 1,
    borderColor: '#FFE082', padding: 14, marginTop: 16,
  },
  hintText: { fontSize: 16, color: '#7B5800', lineHeight: 24 },
  input: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1.5,
    borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, color: Colors.text, minHeight: 56,
  },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24 },
  notifCard: {
    backgroundColor: Colors.white, borderRadius: 14, overflow: 'hidden',
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  notifRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  notifLeft: { flex: 1 },
  notifTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  notifDesc: { fontSize: 15, color: Colors.textSub },
  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
  notifNote: { fontSize: 14, color: Colors.textHint, marginTop: 10, marginBottom: 8 },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 14, minHeight: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 32,
  },
  saveBtnDisabled: { backgroundColor: Colors.textHint },
  saveBtnText: { fontSize: 19, fontWeight: '700', color: Colors.white },
});

const colStyles = StyleSheet.create({
  item: {
    height: ITEM_H, justifyContent: 'center', alignItems: 'center',
    borderRadius: 8, marginHorizontal: 3, marginVertical: 1,
  },
  itemActive: { backgroundColor: Colors.light },
  itemText: { color: Colors.text },
  itemTextActive: { color: Colors.primary, fontWeight: '700' },
});

const mpStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 16, paddingBottom: 40,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  colHeader: {
    fontSize: 15, fontWeight: '600', color: Colors.textSub,
    textAlign: 'center', paddingBottom: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 4,
  },
  colsRow: { flexDirection: 'row', height: 290 },
  colDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 8 },
  confirmBtn: {
    backgroundColor: Colors.primary, borderRadius: 12, minHeight: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  confirmText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
