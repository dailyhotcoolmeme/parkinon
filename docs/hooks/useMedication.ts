import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { getMedTimeLabel } from '../utils/getMedTimeLabel';

interface MedLog {
  id: string;
  medication_id: string;
  taken_at: string;
  time_slot: 'morning' | 'lunch' | 'evening' | 'bedtime';
  taken_by: string; // 본인 or 보호자 user_id
}

interface MedicationState {
  morning: MedLog | null;
  lunch: MedLog | null;
  evening: MedLog | null;
  bedtime: MedLog | null;
}

export const useMedication = (date: string) => {
  const { user, patientId } = useAuth();
  const [logs, setLogs] = useState<MedicationState>({
    morning: null,
    lunch: null,
    evening: null,
    bedtime: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 해당 날짜 복용 기록 조회
  const fetchLogs = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('med_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('taken_at', `${date}T00:00:00`)
        .lte('taken_at', `${date}T23:59:59`);

      if (error) throw error;

      const state: MedicationState = {
        morning: null,
        lunch: null,
        evening: null,
        bedtime: null,
      };
      data?.forEach((log) => {
        state[log.time_slot as keyof MedicationState] = log;
      });
      setLogs(state);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [patientId, date]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 복용 기록 저장
  const takeMedication = useCallback(
    async (timeSlot: keyof MedicationState, takenByProxy = false) => {
      if (!patientId || !user) return;
      setLoading(true);
      try {
        const { error } = await supabase.from('med_logs').insert({
          patient_id: patientId,
          time_slot: timeSlot,
          taken_at: new Date().toISOString(),
          taken_by: user.id,
          is_proxy: takenByProxy, // 보호자 대신 입력 여부
        });
        if (error) throw error;
        await fetchLogs();
        return true;
      } catch (err: any) {
        setError(err.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [patientId, user, fetchLogs]
  );

  // 현재 시간 기준 자동 시간대 판별
  const currentTimeSlot = getMedTimeLabel(new Date());

  return {
    logs,
    loading,
    error,
    takeMedication,
    currentTimeSlot,
    refresh: fetchLogs,
  };
};
