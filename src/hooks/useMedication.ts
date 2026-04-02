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
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
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

export function useMedication(): UseMedicationReturn {
  const { user } = useAuth();
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
    if (!user.patient_group_id) return null;

    const { data } = await supabase
      .from('patient_group_members')
      .select('user_id, role')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single();

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

      const today = new Date().toISOString().split('T')[0];

      const { data, error: queryError } = await supabase
        .from('med_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('taken_at', `${today}T00:00:00.000Z`)
        .lte('taken_at', `${today}T23:59:59.999Z`)
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
        setError('연동된 환자 정보를 찾을 수 없어요.');
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

      const { data, error: queryError } = await supabase
        .from('med_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('taken_at', `${date}T00:00:00.000Z`)
        .lte('taken_at', `${date}T23:59:59.999Z`)
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
