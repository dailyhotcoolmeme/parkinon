/**
 * useMedication.ts
 * 약 복용 관련 훅
 *
 * - medications 목록 조회 (환자별 등록된 약)
 * - med_logs 오늘 복용 현황 (시간대별)
 * - takeMedication(mealTime) - 복용 기록 저장
 * - getMedLogs(date) - 날짜별 복용 내역 조회
 */
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { sendCaregiverPush, scheduleEffectTrackingNotifications } from '../utils/notifications';
import { getKSTToday, getKSTDayRange } from '../utils/medUtils';
import { useSettings } from '../context/SettingsContext';
import type { Database } from '../types/database';

type MealTime = Database['public']['Tables']['med_logs']['Row']['meal_time'];
type MedLogRow = Database['public']['Tables']['med_logs']['Row'];
type MedicationRow = Database['public']['Tables']['medications']['Row'];

export interface TodayMedStatus {
  morning: MedLogRow | null;
  lunch: MedLogRow | null;
  dinner: MedLogRow | null;
  bedtime: MedLogRow | null;
}

export interface UseMedicationReturn {
  medications: MedicationRow[];
  todayStatus: TodayMedStatus;
  loading: boolean;
  error: string | null;
  takeMedication: (mealTime: MealTime, medicationId?: string) => Promise<boolean>;
  getMedLogs: (date: string) => Promise<MedLogRow[]>;
  refresh: () => Promise<void>;
}

const MEAL_TIME_LABELS: Record<string, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
};

export function useMedication(): UseMedicationReturn {
  const { user } = useAuth();
  const { medNotifs } = useSettings();
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [todayStatus, setTodayStatus] = useState<TodayMedStatus>({
    morning: null,
    lunch: null,
    dinner: null,
    bedtime: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 환자 ID 결정: 환자이면 본인, 보호자이면 연동된 환자 ID
  const getPatientId = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (user.role === 'patient') return user.id;

    // 보호자인 경우 그룹에서 환자 ID 조회
    if (!user.patient_group_id) {
      console.warn('[useMedication] 보호자 patient_group_id=null → 환자 미연동');
      return null;
    }

    const { data, error } = await supabase
      .from('patient_group_members')
      .select('user_id, role')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single();

    if (error) {
      console.error('[useMedication] getPatientId 그룹 조회 오류:', error);
    }

    return data?.user_id ?? null;
  }, [user]);

  // 오늘 복용 현황 조회
  const fetchTodayStatus = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const patientId = await getPatientId();
      if (!patientId) {
        setLoading(false);
        return;
      }

      const today = getKSTToday();
      const { start, end } = getKSTDayRange(today);

      const { data, error: queryError } = await supabase
        .from('med_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('taken_at', start)
        .lte('taken_at', end)
        .order('taken_at', { ascending: false });

      if (queryError) throw queryError;

      const status: TodayMedStatus = {
        morning: null,
        lunch: null,
        dinner: null,
        bedtime: null,
      };

      // 같은 시간대에 여러 기록이 있으면 가장 최근 것 사용
      data?.forEach((log) => {
        const slot = log.meal_time as keyof TodayMedStatus;
        if (!status[slot]) {
          status[slot] = log;
        }
      });

      setTodayStatus(status);
    } catch (err: any) {
      console.error('[useMedication] fetchTodayStatus 오류:', err);
      setError(err.message ?? '복용 현황을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId]);

  // 활성 약 목록 조회
  const fetchMedications = useCallback(async () => {
    if (!user) return;

    try {
      const patientId = await getPatientId();
      if (!patientId) return;

      const { data, error: queryError } = await supabase
        .from('medications')
        .select('*')
        .eq('patient_id', patientId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (queryError) throw queryError;
      setMedications(data ?? []);
    } catch (err: any) {
      console.error('[useMedication] fetchMedications 오류:', err);
    }
  }, [user, getPatientId]);

  // 초기 로드
  useEffect(() => {
    if (user) {
      fetchMedications();
      fetchTodayStatus();
    }
  }, [user, fetchMedications, fetchTodayStatus]);

  // 복용 기록 저장
  const takeMedication = useCallback(async (
    mealTime: MealTime,
    medicationId?: string
  ): Promise<boolean> => {
    if (!user) return false;

    setLoading(true);
    setError(null);

    try {
      const patientId = await getPatientId();
      if (!patientId) {
        const msg = '복용 기록을 저장할 환자 정보를 찾을 수 없어요. 가족 연동 후 다시 시도해 주세요.';
        console.error('[useMedication] takeMedication: patientId null → insert 중단');
        setError(msg);
        return false;
      }

      const insertData: any = {
        patient_id: patientId,
        logged_by: user.id,
        taken_at: new Date().toISOString(),
        meal_time: mealTime,
      };

      if (medicationId) {
        insertData.medication_id = medicationId;
      }

      const { error: insertError } = await supabase
        .from('med_logs')
        .insert(insertData);

      if (insertError) throw insertError;

      // 복용 시각 AsyncStorage 저장 (약효 추적 trigger_time_label 추론용)
      await AsyncStorage.setItem(
        'parkinon_last_medication',
        JSON.stringify({ taken_at: new Date().toISOString(), meal_time: mealTime })
      ).catch(() => {});

      // DB INSERT 성공 후 알림 처리 (실패해도 전체 함수에 영향 없음)
      try {
        // 약효 추적 알림 — 취침약이 아닐 때만 스케줄 (야간 수면 방해 방지)
        if (mealTime !== 'bedtime') {
          // push_token 있으면 서버 큐, 없으면 로컬 알림
          if (user?.push_token) {
            await supabase.functions.invoke('queue-effect-tracking', {
              body: {
                patient_id: patientId,
                push_token: user.push_token,
                meal_time: mealTime,
                notif_settings: medNotifs.map((n) => ({ minutes: n.minutes, enabled: n.enabled })),
              },
            });
          } else {
            await scheduleEffectTrackingNotifications(medNotifs);
          }
        }

        // 보호자에게 푸시 알림 (같은 그룹의 보호자 push_token 조회 후 전송)
        if (user.patient_group_id) {
          const { data: caregivers } = await supabase
            .from('patient_group_members')
            .select('user_id')
            .eq('group_id', user.patient_group_id)
            .eq('role', 'caregiver');

          if (caregivers && caregivers.length > 0) {
            const caregiverIds = caregivers.map((c: any) => c.user_id);
            const { data: caregiverUsers } = await supabase
              .from('users')
              .select('push_token, caregiver_notif_prefs')
              .in('id', caregiverIds)
              .not('push_token', 'is', null);

            // 환자 이름 조회
            let patientName = '환자분';
            if (user.role === 'patient') {
              patientName = user.name || '환자분';
            } else {
              // 보호자인 경우 연동된 환자 이름 조회
              const { data: patientRow } = await supabase
                .from('users')
                .select('name')
                .eq('id', patientId)
                .single();
              if (patientRow?.name) patientName = patientRow.name;
            }

            for (const cu of caregiverUsers ?? []) {
              if (!cu.push_token) continue;
              const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>;
              if (prefs.med_taken === false) continue;
              await sendCaregiverPush(
                cu.push_token,
                '💊 약을 드셨어요',
                `${patientName}님이 약을 드셨어요.`,
                { type: 'caregiver_medication' },
              );
            }
          }
        }
      } catch (notifErr) {
        console.error('[useMedication] 알림 처리 실패 (복용 기록은 저장됨):', notifErr);
      }

      // 오늘 현황 갱신
      await fetchTodayStatus();
      return true;
    } catch (err: any) {
      console.error('[useMedication] takeMedication 오류:', err);
      setError(err.message ?? '복용 기록 저장에 실패했어요.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId, fetchTodayStatus]);

  // 날짜별 복용 내역 조회
  const getMedLogs = useCallback(async (date: string): Promise<MedLogRow[]> => {
    if (!user) return [];

    try {
      const patientId = await getPatientId();
      if (!patientId) return [];

      const { start, end } = getKSTDayRange(date);
      const { data, error: queryError } = await supabase
        .from('med_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('taken_at', start)
        .lte('taken_at', end)
        .order('taken_at', { ascending: true });

      if (queryError) throw queryError;
      return data ?? [];
    } catch (err: any) {
      console.error('[useMedication] getMedLogs 오류:', err);
      return [];
    }
  }, [user, getPatientId]);

  // 새로고침
  const refresh = useCallback(async () => {
    await Promise.all([fetchMedications(), fetchTodayStatus()]);
  }, [fetchMedications, fetchTodayStatus]);

  return {
    medications,
    todayStatus,
    loading,
    error,
    takeMedication,
    getMedLogs,
    refresh,
  };
}
