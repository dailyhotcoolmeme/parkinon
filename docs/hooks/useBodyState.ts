import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

interface BodyStateLog {
  body_score?: number;
  mood_score?: number;
  sleep_score?: number;
  constipation?: boolean;
  triggered_by: 'notification' | 'manual';
  time_slot?: string;
  med_log_id?: string;
}

export const useBodyState = () => {
  const { user, patientId } = useAuth();
  const [loading, setLoading] = useState(false);

  const saveLog = useCallback(async (log: BodyStateLog, isProxy = false) => {
    if (!patientId || !user) return false;
    setLoading(true);
    try {
      const { error } = await supabase.from('on_off_logs').insert({
        patient_id: patientId,
        recorded_at: new Date().toISOString(),
        created_by: user.id,
        is_proxy: isProxy,
        ...log,
      });
      if (error) throw error;
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, [patientId, user]);

  // 오늘 첫 번째 기록인지 확인 (수면 질문 표시 여부)
  const isFirstLogToday = useCallback(async () => {
    if (!patientId) return true;
    const today = new Date().toISOString().split('T')[0];
    const { count } = await supabase
      .from('on_off_logs')
      .select('*', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .gte('recorded_at', `${today}T00:00:00`);
    return (count ?? 0) === 0;
  }, [patientId]);

  return { saveLog, loading, isFirstLogToday };
};
