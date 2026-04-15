import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Notifications from 'expo-notifications';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { MenuStackParamList } from '../../navigation/MenuNavigator';

type NavProp = StackNavigationProp<MenuStackParamList>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

interface Appointment {
  id: string;
  appointment_date: string;
  hospital_name: string | null;
  doctor_name: string | null;
  notification_ids: string[] | null;
}

interface MedRecord {
  id: string;
  visit_date: string;
  hospital_name: string;
  doctor_name?: string;
  medical_record_medications: { id: string; change_type: string }[];
}

function formatApptDate(iso: string): string {
  const d = new Date(iso);
  const dow = DAYS_KR[d.getDay()];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`;
}

function formatApptTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, '0')}`;
}

function formatRecordDate(iso: string): string {
  const d = new Date(iso);
  const dow = DAYS_KR[d.getDay()];
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${dow})`;
}

function formatRecordTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, '0')}`;
}

function calcDday(iso: string): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'D-Day';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function hasPrescriptionChange(meds: { change_type: string }[]): boolean {
  return meds.some(m => ['added', 'changed', 'removed'].includes(m.change_type));
}

export function MedicalRecordListScreen() {
  const navigation = useNavigation<NavProp>();
  const { user } = useAuth();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [records, setRecords] = useState<MedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? SUPABASE_ANON_KEY;
  };

  const fetchData = useCallback(async () => {
    if (!user) return;
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
          `${SUPABASE_URL}/rest/v1/medical_appointments?patient_id=eq.${user.id}&appointment_date=gt.${now}&order=appointment_date.asc`,
          { headers },
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?patient_id=eq.${user.id}&order=visit_date.desc&select=*,medical_record_medications(id,change_type)`,
          { headers },
        ),
      ]);

      if (!apptRes.ok || !recRes.ok) throw new Error('데이터를 불러오지 못했어요.');

      setAppointments(await apptRes.json());
      setRecords(await recRes.json());
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const handleDeleteAppointment = (appt: Appointment) => {
    Alert.alert(
      '일정 삭제',
      `${formatApptDate(appt.appointment_date)} 일정을 삭제할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
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
              if (!res.ok) throw new Error('삭제에 실패했어요.');
              setAppointments(prev => prev.filter(a => a.id !== appt.id));
            } catch (e: any) {
              Alert.alert('오류', e.message ?? '삭제에 실패했어요.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="진료 기록" showBack />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* ── 진료 일정 ─────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>진료 일정</Text>
            <TouchableOpacity
              style={styles.addApptBtn}
              onPress={() => navigation.navigate('AppointmentWrite' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.addApptBtnText}>+ 일정 등록</Text>
            </TouchableOpacity>
          </View>

          {appointments.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>등록된 진료 일정이 없어요</Text>
            </View>
          ) : (
            appointments.map(appt => (
              <View key={appt.id} style={styles.apptCard}>
                <View style={styles.apptTop}>
                  <Text style={styles.apptDate}>{formatApptDate(appt.appointment_date)}</Text>
                  <Text style={styles.ddayBadge}>{calcDday(appt.appointment_date)}</Text>
                </View>
                <Text style={styles.apptTime}>{formatApptTime(appt.appointment_date)}</Text>
                {appt.hospital_name ? (
                  <Text style={styles.apptHospital}>{appt.hospital_name}</Text>
                ) : null}
                {appt.doctor_name ? (
                  <Text style={styles.apptDoctor}>{appt.doctor_name} 선생님</Text>
                ) : null}
                <View style={styles.apptBtns}>
                  <TouchableOpacity
                    style={styles.apptEditBtn}
                    onPress={() => navigation.navigate('AppointmentWrite', { appointmentId: appt.id } as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.apptEditBtnText}>수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.apptDeleteBtn}
                    onPress={() => handleDeleteAppointment(appt)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.apptDeleteBtnText}>삭제</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          {/* ── 진료 이력 ─────────────────────────────── */}
          <Text style={[styles.sectionLabel, { marginTop: 32, marginBottom: 12 }]}>진료 이력</Text>
          {records.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>아직 진료 기록이 없어요</Text>
            </View>
          ) : (
            records.map(rec => {
              const changed = hasPrescriptionChange(rec.medical_record_medications);
              return (
                <TouchableOpacity
                  key={rec.id}
                  style={styles.recordCard}
                  onPress={() => navigation.navigate('MedicalRecordDetail', { recordId: rec.id } as any)}
                  activeOpacity={0.8}
                >
                  <View style={styles.recordCardLeft}>
                    <Text style={styles.recordDate}>{formatRecordDate(rec.visit_date)}</Text>
                    <Text style={styles.recordTime}>{formatRecordTime(rec.visit_date)}</Text>
                    <Text style={styles.recordHospital}>{rec.hospital_name}</Text>
                    {rec.doctor_name ? (
                      <Text style={styles.recordDoctor}>{rec.doctor_name} 선생님</Text>
                    ) : null}
                  </View>
                  {changed ? (
                    <View style={styles.changedBadge}>
                      <Text style={styles.changedBadgeText}>처방 변경 🔴</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })
          )}

          <TouchableOpacity
            style={styles.addRecordBtn}
            onPress={() => navigation.navigate('MedicalRecordWrite' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.addRecordBtnText}>+ 진료 기록 추가</Text>
          </TouchableOpacity>
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
  scroll: { padding: 20, paddingBottom: 48 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
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
  apptTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  apptDate: { fontSize: 18, fontWeight: '700', color: Colors.text },
  ddayBadge: {
    backgroundColor: Colors.primary, color: Colors.white,
    fontSize: 15, fontWeight: '800',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 20, overflow: 'hidden',
  },
  apptTime: { fontSize: 17, color: Colors.textSub, marginBottom: 8 },
  apptHospital: { fontSize: 17, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  apptDoctor: { fontSize: 16, color: Colors.textSub, marginBottom: 12 },
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

  // 진료 이력 카드
  recordCard: {
    backgroundColor: Colors.white, borderRadius: 14, padding: 18,
    marginBottom: 12, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  recordCardLeft: { flex: 1 },
  recordDate: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  recordTime: { fontSize: 16, color: Colors.textSub, marginBottom: 6 },
  recordHospital: { fontSize: 17, color: Colors.text, marginBottom: 2 },
  recordDoctor: { fontSize: 16, color: Colors.textSub },
  changedBadge: { backgroundColor: '#FFF0F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  changedBadgeText: { fontSize: 14, fontWeight: '700', color: Colors.danger },

  // 진료기록 추가 버튼
  addRecordBtn: {
    backgroundColor: Colors.primary, borderRadius: 14, minHeight: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  addRecordBtnText: { fontSize: 19, fontWeight: '700', color: Colors.white },
});
