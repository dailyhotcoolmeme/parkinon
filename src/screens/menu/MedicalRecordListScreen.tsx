import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
import { useDialog } from '../../context/DialogContext';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { fullDate, monthDayShort } from '../../utils/dateLabels';
import { formatClock } from '../../utils/notifLabels';

type NavProp = StackNavigationProp<MenuStackParamList>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;


const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Appointment {
  id: string;
  appointment_date: string;
  hospital_name: string | null;
  doctor_name: string | null;
  notification_ids: string[] | null;
  notify_week_before: boolean;
  notify_day_before: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 진료일시에서 daysBefore 일 전(같은 시각) = 실제 알림 발송 시각. */
function alarmDate(iso: string, daysBefore: number): Date {
  return new Date(new Date(iso).getTime() - daysBefore * DAY_MS);
}

/** '2026년 9월 26일(수) 08:00' (24시간) — 알림 발송 정확한 일시 안내용. ko는 기존과 100% 동일. */
function formatNotifDateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  // 날짜 표기는 공용 dateLabels 하나만 쓴다(화면마다 요일표를 들고 있으면 언어가 늘 때 새어나간다).
  return i18n.t('dateFmt.fullDateTime', { date: fullDate(d), time: `${hh}:${mm}` });
}

/** '10월 3일(수) 오후 2:00' — 알림 본문에 넣는 진료 일시. ko는 기존과 100% 동일. */
function apptWhenKor(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return i18n.t('dateFmt.monthDayTime', { monthDay: monthDayShort(d), time: formatClock(d) });
}

async function ensureNotifPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const { status: ns } = await Notifications.requestPermissionsAsync();
  return ns === 'granted';
}

async function scheduleApptNotification(triggerDate: Date, title: string, body: string): Promise<string | null> {
  if (triggerDate <= new Date()) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
  } catch { return null; }
}

interface MedRecord {
  id: string;
  visit_date: string;
  hospital_name: string;
  doctor_name?: string;
  consultation_notes?: string | null;
  prescription_changed?: boolean | null;
  medical_record_medications: { id: string; change_type: string }[];
}

function formatApptDate(iso: string): string {
  const d = new Date(iso);
  return fullDate(d);
}

function formatApptTime(iso: string): string {
  const d = new Date(iso);
  return formatClock(d);
}

/** 24시간 'HH:MM' (오전/오후 없이). 예: 08:10 */
function formatApptTime24(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 병원명 · 의사명(선생님) 한 줄. 둘 중 하나만 있으면 그것만. */
function apptPlaceText(appt: { hospital_name: string | null; doctor_name: string | null }): string {
  const h = appt.hospital_name?.trim();
  const d = appt.doctor_name?.trim();
  if (h && d) return `${h} · ${d}`;
  return h || d || '';
}

function formatRecordDate(iso: string): string {
  const d = new Date(iso);
  return fullDate(d);
}

function formatRecordTime(iso: string): string {
  const d = new Date(iso);
  return formatClock(d);
}

function calcDday(iso: string): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return i18n.t('medRecordList.dday');
  if (diff > 0) return i18n.t('medRecordList.dMinus', { n: diff });
  return i18n.t('medRecordList.dPlus', { n: Math.abs(diff) });
}

/** 각 알림(D-7/D-1) 이름 밑 보조문구: 발송 정확 일시 + 상태. */
function alarmSubText(appt: Appointment, which: 'week' | 'day'): React.ReactNode {
  const d = alarmDate(appt.appointment_date, which === 'week' ? 7 : 1);
  const on = which === 'week' ? appt.notify_week_before : appt.notify_day_before;
  const dateStr = formatNotifDateTime(d);
  // (꺼짐)만 색 강조 — 중첩 Text라 부모 lineHeight를 그대로 상속(줄간격 영향 없음)
  if (!on) return (<>{dateStr} <Text style={styles.apptAlarmOff}>{i18n.t('medRecordList.alarmOff')}</Text></>);
  if (d.getTime() <= Date.now()) return `${dateStr}\n${i18n.t('medRecordList.alarmPastNote')}`;
  return i18n.t('medRecordList.alarmWillSend', { date: dateStr });
}

function hasPrescriptionChange(meds: { change_type: string }[]): boolean {
  return meds.some(m => ['added', 'changed', 'removed'].includes(m.change_type));
}

export function MedicalRecordListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const { user } = useAuth();
  const { patientId, loading: pidLoading } = usePatientId();
  const { unreadCount } = useNotificationBadge();

  // 미연동 보호자: 보호자인데 환자 해석이 끝났고 연동 환자 없음(환자 본인 경로는 영향 없음).
  const caregiverUnlinked = user?.role === 'caregiver' && !pidLoading && patientId == null;
  const dialog = useDialog();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [records, setRecords] = useState<MedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? SUPABASE_ANON_KEY;
  };

  const fetchData = useCallback(async () => {
    // 환자 id가 아직 해석 중이면 스피너 유지, 해석 끝났는데 없으면(미연동 보호자 등)
    // 영구 스피너 방지를 위해 로딩 종료 후 종료(빈 상태/안내가 대신 노출됨).
    if (!user || !patientId) {
      if (!pidLoading) setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      };

      const now = new Date().toISOString();
      const [apptRes, recRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/medical_appointments?patient_id=eq.${patientId}&appointment_date=gt.${now}&order=appointment_date.asc`,
          { headers },
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?patient_id=eq.${patientId}&order=visit_date.desc&select=id,visit_date,hospital_name,doctor_name,consultation_notes,prescription_changed,medical_record_medications(id,change_type)`,
          { headers },
        ),
      ]);

      if (!apptRes.ok || !recRes.ok) throw new Error(t('medRecordList.fetchFailMsg'));

      setAppointments(await apptRes.json());
      setRecords(await recRes.json());
    } catch (e: any) {
      setError(e.message ?? t('medRecordList.genericErrorMsg'));
    } finally {
      setLoading(false);
    }
  }, [user, patientId, pidLoading]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const handleDeleteAppointment = async (appt: Appointment) => {
    const ok = await dialog.confirm({
      title: t('medRecordList.deleteScheduleTitle'),
      message: t('medRecordList.deleteScheduleMsg', { date: formatApptDate(appt.appointment_date) }),
      confirmText: t('medRecordList.delete'),
      cancelText: t('medRecordList.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const token = await getToken();
      // 알림 취소
      if (appt.notification_ids?.length) {
        for (const id of appt.notification_ids) {
          try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
        }
      }
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/medical_appointments?id=eq.${appt.id}`,
        {
          method: 'DELETE',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error(t('medRecordList.deleteFailMsg'));
      setAppointments(prev => prev.filter(a => a.id !== appt.id));
    } catch (e: any) {
      dialog.alert({ title: t('medRecordList.errorTitle'), message: e.message ?? t('medRecordList.deleteFailMsg') });
    }
  };

  // 알림 토글 — 서버 크론(send-appointment-reminders)이 발송. 여기선 DB 상태만 갱신 + 결과 팝업.
  const toggleApptAlarm = async (appt: Appointment, which: 'week' | 'day', value: boolean) => {
    const newWeek = which === 'week' ? value : appt.notify_week_before;
    const newDay = which === 'day' ? value : appt.notify_day_before;
    // 토글한 알림의 발송 시점(D-7/D-1)과 지났는지 여부
    const d = alarmDate(appt.appointment_date, which === 'week' ? 7 : 1);
    const dPast = d.getTime() <= Date.now();
    // 낙관적 UI 반영
    setAppointments(prev => prev.map(a =>
      a.id === appt.id ? { ...a, notify_week_before: newWeek, notify_day_before: newDay } : a,
    ));
    try {
      const token = await getToken();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/medical_appointments?id=eq.${appt.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            notify_week_before: newWeek,
            notify_day_before: newDay,
            // 토글한 알림의 표식: 그 시점(D-7/D-1)이 지났으면 true(억제), 미래면 false(그때 발송)
            notified_week: which === 'week' ? dPast : undefined,
            notified_day: which === 'day' ? dPast : undefined,
          }),
        },
      );
      if (!res.ok) throw new Error(t('medRecordList.alarmSaveFailMsg'));
      setAppointments(prev => prev.map(a =>
        a.id === appt.id ? { ...a, notify_week_before: newWeek, notify_day_before: newDay } : a,
      ));
      // 결과 팝업 — 정확한 발송 일시 안내(지난 시점이면 안 옴 안내)
      const dateStr = formatNotifDateTime(d);
      if (value) {
        dialog.alert(
          dPast
            ? { title: t('medRecordList.alarmOnTitle'), message: t('medRecordList.alarmOnPastMsg', { date: dateStr }) }
            : { title: t('medRecordList.alarmOnTitle'), message: t('medRecordList.alarmOnFutureMsg', { date: dateStr }) },
        );
      } else {
        dialog.alert({ title: t('medRecordList.alarmOffTitle'), message: t('medRecordList.alarmOffMsg', { date: dateStr }) });
      }
    } catch (e) {
      // 실패 시 원복
      setAppointments(prev => prev.map(a =>
        a.id === appt.id
          ? { ...a, notify_week_before: appt.notify_week_before, notify_day_before: appt.notify_day_before }
          : a,
      ));
      dialog.alert({ title: t('medRecordList.errorTitle'), message: t('medRecordList.alarmSaveFailAlertMsg') });
    }
  };

  const handleDeleteRecord = async (rec: MedRecord) => {
    const ok = await dialog.confirm({
      title: t('medRecordList.deleteRecordTitle'),
      message: t('medRecordList.deleteRecordMsg', { date: formatApptDate(rec.visit_date) }),
      confirmText: t('medRecordList.delete'),
      cancelText: t('medRecordList.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const token = await getToken();
      const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
      // 연결된 처방약 스냅샷 먼저 삭제 후 기록 삭제
      await fetch(`${SUPABASE_URL}/rest/v1/medical_record_medications?medical_record_id=eq.${rec.id}`, { method: 'DELETE', headers: h });
      const res = await fetch(`${SUPABASE_URL}/rest/v1/medical_records?id=eq.${rec.id}`, { method: 'DELETE', headers: h });
      if (!res.ok) throw new Error(t('medRecordList.deleteFailMsg'));
      setRecords(prev => prev.filter(r => r.id !== rec.id));
    } catch (e: any) {
      dialog.alert({ title: t('medRecordList.errorTitle'), message: e.message ?? t('medRecordList.deleteFailMsg') });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar
        title={t('medRecordList.headerTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : caregiverUnlinked ? (
        <View style={styles.unlinkedWrap}>
          <Ionicons name="people-outline" size={56} color={Colors.textHint} />
          <Text style={styles.unlinkedTitle}>{t('medRecordList.unlinkedTitle')}</Text>
          <Text style={styles.unlinkedDesc}>{t('medRecordList.unlinkedDesc')}</Text>
          <TouchableOpacity
            style={styles.linkFamilyBtn}
            onPress={() => navigation.navigate('FamilyLink')}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={22} color={Colors.white} />
            <Text style={styles.linkFamilyBtnText}>{t('medRecordList.linkFamilyBtn')}</Text>
          </TouchableOpacity>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryBtnText}>{t('medRecordList.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* ── 진료 일정 ─────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="calendar-outline" size={24} color={Colors.primary} style={{ marginRight: 8 }} />
              <Text style={styles.sectionLabel}>{t('medRecordList.scheduleSection')}</Text>
            </View>
            <TouchableOpacity
              style={styles.addApptBtn}
              onPress={() => navigation.navigate('AppointmentWrite' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.addApptBtnText}>{t('medRecordList.addSchedule')}</Text>
            </TouchableOpacity>
          </View>

          {appointments.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('medRecordList.noSchedule')}</Text>
            </View>
          ) : (
            appointments.map(appt => (
              <View key={appt.id} style={styles.apptCard}>
                {/* 상단: 날짜+D배지(왼쪽) · 수정/삭제 아이콘(우측 상단) */}
                <View style={styles.apptTop}>
                  <View style={styles.apptDateRow}>
                    <Text style={styles.apptDate}>{formatApptDate(appt.appointment_date)}</Text>
                    <Text style={styles.apptDate}>{formatApptTime24(appt.appointment_date)}</Text>
                    <Text style={styles.ddayBadge}>{calcDday(appt.appointment_date)}</Text>
                  </View>
                  <View style={styles.apptIconBtns}>
                    <TouchableOpacity
                      style={styles.apptIconBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => navigation.navigate('AppointmentWrite', { appointmentId: appt.id } as any)}
                      activeOpacity={0.7}
                      accessibilityLabel={t('medRecordList.a11yEditSchedule')}
                    >
                      <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.apptIconBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => handleDeleteAppointment(appt)}
                      activeOpacity={0.7}
                      accessibilityLabel={t('medRecordList.a11yDeleteSchedule')}
                    >
                      <Ionicons name="trash-outline" size={22} color={Colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
                {apptPlaceText(appt) ? (
                  <Text style={styles.apptHospital}>{apptPlaceText(appt)}</Text>
                ) : null}

                {/* 알림 2개 (D-7 / D-1) — on/off 토글 + 발송 정확 일시 안내 */}
                <View style={styles.apptAlarmBox}>
                  <View style={styles.apptAlarmRow}>
                    <View style={styles.apptAlarmLeft}>
                      <Text style={styles.apptAlarmTitle}>{t('medRecordList.weekBeforeAlarm')}</Text>
                      <Text style={styles.apptAlarmSub}>{alarmSubText(appt, 'week')}</Text>
                    </View>
                    <Switch
                      value={appt.notify_week_before}
                      onValueChange={(v) => toggleApptAlarm(appt, 'week', v)}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
                      thumbColor={Colors.white}
                    />
                  </View>
                  <View style={styles.apptAlarmRow}>
                    <View style={styles.apptAlarmLeft}>
                      <Text style={styles.apptAlarmTitle}>{t('medRecordList.dayBeforeAlarm')}</Text>
                      <Text style={styles.apptAlarmSub}>{alarmSubText(appt, 'day')}</Text>
                    </View>
                    <Switch
                      value={appt.notify_day_before}
                      onValueChange={(v) => toggleApptAlarm(appt, 'day', v)}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
                      thumbColor={Colors.white}
                    />
                  </View>
                </View>
              </View>
            ))
          )}

          {/* ── 진료 이력 ─────────────────────────────── */}
          <View style={[styles.sectionHeader, { marginTop: 32, marginBottom: 12 }]}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="clipboard-outline" size={24} color={Colors.primary} style={{ marginRight: 8 }} />
              <Text style={styles.sectionLabel}>{t('medRecordList.historySection')}</Text>
            </View>
            <TouchableOpacity
              style={styles.addApptBtn}
              onPress={() => navigation.navigate('MedicalRecordWrite' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.addApptBtnText}>{t('medRecordList.addRecord')}</Text>
            </TouchableOpacity>
          </View>
          {records.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('medRecordList.noRecord')}</Text>
            </View>
          ) : (
            records.map(rec => {
              const changed = !!rec.prescription_changed;
              const place = apptPlaceText({ hospital_name: rec.hospital_name, doctor_name: rec.doctor_name ?? null });
              const notes = rec.consultation_notes?.trim();
              return (
                <TouchableOpacity
                  key={rec.id}
                  style={styles.recordCard}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('MedicalRecordDetail', { recordId: rec.id } as any)}
                >
                  {/* 1행: 날짜·시간·D배지(인라인, 왼쪽) — 수정/삭제 아이콘(우측 상단) */}
                  <View style={styles.apptTop}>
                    <View style={styles.apptDateRow}>
                      <Text style={styles.apptDate}>{formatApptDate(rec.visit_date)}</Text>
                      <Text style={styles.apptDate}>{formatApptTime24(rec.visit_date)}</Text>
                      <Text style={styles.ddayBadge}>{calcDday(rec.visit_date)}</Text>
                    </View>
                    <View style={styles.apptIconBtns}>
                      <TouchableOpacity
                        style={styles.apptIconBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => navigation.navigate('MedicalRecordWrite', { recordId: rec.id } as any)}
                        activeOpacity={0.7}
                        accessibilityLabel={t('medRecordList.a11yEditRecord')}
                      >
                        <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.apptIconBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => handleDeleteRecord(rec)}
                        activeOpacity={0.7}
                        accessibilityLabel={t('medRecordList.a11yDeleteRecord')}
                      >
                        <Ionicons name="trash-outline" size={22} color={Colors.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* 2행: 병원 · 의사 (선생님 제거) + 처방 변경 표시 */}
                  {(place || changed) ? (
                    <View style={styles.recPlaceRow}>
                      {place ? <Text style={styles.apptHospital}>{place}</Text> : null}
                      {changed ? (
                        <TouchableOpacity
                          style={styles.recChangedBtn}
                          onPress={() => navigation.navigate('MedicationManage', { mode: 'meds' } as any)}
                          activeOpacity={0.7}
                          accessibilityLabel={t('medRecordList.a11yPrescriptionChanged')}
                        >
                          <Text style={styles.recChangedBtnText}>{t('medRecordList.prescriptionChanged')}</Text>
                          <Ionicons name="chevron-forward" size={14} color={Colors.danger} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                  {/* 3행: 상담 내용 — 전체 표시(줄바꿈 그대로) */}
                  {notes ? (
                    <Text style={styles.recNotes}>{notes}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 18, color: Colors.danger, textAlign: 'center', marginBottom: 16 },
  retryBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  retryBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
  scroll: { padding: 16, paddingBottom: 40 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center' },
  sectionLabel: { fontSize: 19, fontWeight: '700', color: Colors.text },
  addApptBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  addApptBtnText: { fontSize: 16, fontWeight: '700', color: Colors.white },

  // 일정 카드
  apptCard: {
    backgroundColor: Colors.white, borderRadius: 16, padding: 18,
    marginBottom: 12, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6,
  },
  apptTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  apptDateRow: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  apptDate: { fontSize: 16, fontWeight: '700', color: Colors.text },
  ddayBadge: {
    backgroundColor: '#EEEEEE', color: Colors.textSub,
    fontSize: 13, fontWeight: '800',
    paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 20, overflow: 'hidden',
  },
  apptIconBtns: { flexDirection: 'row', gap: 2 },
  apptIconBtn: { padding: 6 },
  apptTime: { fontSize: 17, color: Colors.textSub, marginBottom: 8 },
  apptHospital: { fontSize: 16, fontWeight: '600', color: Colors.text },
  apptDoctor: { fontSize: 16, color: Colors.textSub, marginBottom: 4 },

  // 알림 2개 (D-7 / D-1)
  apptAlarmBox: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  apptAlarmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  apptAlarmLeft: { flex: 1 },
  apptAlarmTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  apptAlarmSub: { fontSize: 14, color: Colors.textSub, marginTop: 3, lineHeight: 19 },
  apptAlarmOff: { color: Colors.primary, fontWeight: '700' },
  apptBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  apptEditBtn: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', minHeight: 44,
    justifyContent: 'center',
  },
  apptEditBtnText: { fontSize: 17, fontWeight: '700', color: Colors.primary },
  apptDeleteBtn: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', minHeight: 44,
    justifyContent: 'center',
  },
  apptDeleteBtnText: { fontSize: 17, fontWeight: '700', color: Colors.textSub },

  // 빈 상태
  emptyCard: {
    backgroundColor: Colors.white, borderRadius: 14, padding: 24,
    alignItems: 'center', marginBottom: 8,
  },
  emptyText: { fontSize: 18, color: Colors.textSub },

  // 미연동 보호자 안내(가족 연동 유도) — 기준 화면(기록 보기)과 동일
  unlinkedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  unlinkedTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  unlinkedDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },
  linkFamilyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, paddingHorizontal: 24, borderRadius: 12,
    backgroundColor: Colors.primary, marginTop: 24,
  },
  linkFamilyBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },

  // 진료 이력 카드 (진료 일정 카드와 동일 톤 — 날짜·시간 한 줄 + D배지, 병원·의사, 상담내용)
  recordCard: {
    backgroundColor: Colors.white, borderRadius: 14, padding: 18,
    marginBottom: 12, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  recTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  recDateTime: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  recPlaceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 5 },
  recChangedBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 1,
    backgroundColor: '#FFF0F0', borderRadius: 8,
    paddingLeft: 10, paddingRight: 6, paddingVertical: 4,
  },
  recChangedBtnText: { fontSize: 13, fontWeight: '700', color: Colors.danger },
  recNotes: { fontSize: 15, color: Colors.textSub, lineHeight: 21, marginTop: 8 },

  // 진료기록 추가 버튼
  addRecordBtn: {
    backgroundColor: Colors.primary, borderRadius: 14, minHeight: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  addRecordBtnText: { fontSize: 19, fontWeight: '700', color: Colors.white },
});
