/**
 * useExercise.ts
 * 운동 기록 관련 훅
 *
 * - exercise_logs 오늘 기록 조회
 * - saveExercise(type, duration) - 운동 기록 저장
 * - getExerciseLogs(date) - 날짜별 기록 조회
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Database } from '../types/database';

type ExerciseLogRow = Database['public']['Tables']['exercise_logs']['Row'];

export interface UseExerciseReturn {
  todayLogs: ExerciseLogRow[];
  loading: boolean;
  error: string | null;
  saveExercise: (exerciseType: string, durationMinutes: number) => Promise<boolean>;
  getExerciseLogs: (date: string) => Promise<{ logs: ExerciseLogRow[]; error: string | null }>;
  getTodayTotalMinutes: () => number;
  refresh: () => Promise<void>;
}

export function useExercise(): UseExerciseReturn {
  const { user } = useAuth();
  const [todayLogs, setTodayLogs] = useState<ExerciseLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 환자 ID 결정
  const getPatientId = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (user.role === 'patient') return user.id;

    if (!user.patient_group_id) return user.id;

    const { data } = await supabase
      .from('patient_group_members')
      .select('user_id, role')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single();

    return data?.user_id ?? user.id;
  }, [user]);

  // 오늘 운동 기록 조회
  const fetchTodayLogs = useCallback(async () => {
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
        .from('exercise_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', `${today}T00:00:00.000Z`)
        .lte('logged_at', `${today}T23:59:59.999Z`)
        .order('logged_at', { ascending: false });

      if (queryError) throw queryError;
      setTodayLogs(data ?? []);
    } catch (err: any) {
      console.error('[useExercise] fetchTodayLogs 오류:', err);
      setError(err.message ?? '운동 기록을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId]);

  // 초기 로드
  useEffect(() => {
    if (user) {
      fetchTodayLogs();
    }
  }, [user, fetchTodayLogs]);

  // 운동 기록 저장
  const saveExercise = useCallback(async (
    exerciseType: string,
    durationMinutes: number
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

      if (durationMinutes <= 0 || durationMinutes > 300) {
        setError('운동 시간을 올바르게 입력해주세요.');
        return false;
      }

      const { error: insertError } = await supabase
        .from('exercise_logs')
        .insert({
          patient_id: patientId,
          logged_by: user.id,
          exercise_type: exerciseType,
          duration_minutes: durationMinutes,
          logged_at: new Date().toISOString(),
        });

      if (insertError) throw insertError;

      await fetchTodayLogs();
      return true;
    } catch (err: any) {
      console.error('[useExercise] saveExercise 오류:', err);
      setError(err.message ?? '운동 기록 저장에 실패했어요.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId, fetchTodayLogs]);

  // 날짜별 기록 조회
  const getExerciseLogs = useCallback(async (date: string): Promise<{ logs: ExerciseLogRow[]; error: string | null }> => {
    if (!user) return { logs: [], error: null };

    try {
      const patientId = await getPatientId();
      if (!patientId) return { logs: [], error: null };

      const { data, error: queryError } = await supabase
        .from('exercise_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', `${date}T00:00:00.000Z`)
        .lte('logged_at', `${date}T23:59:59.999Z`)
        .order('logged_at', { ascending: true });

      if (queryError) throw queryError;
      return { logs: data ?? [], error: null };
    } catch (err: any) {
      console.error('[useExercise] getExerciseLogs 오류:', err);
      const msg = err.message ?? '운동 기록을 불러오지 못했어요.';
      return { logs: [], error: msg };
    }
  }, [user, getPatientId]);

  // 오늘 총 운동 시간(분) 계산
  const getTodayTotalMinutes = useCallback((): number => {
    return todayLogs.reduce((sum, log) => sum + log.duration_minutes, 0);
  }, [todayLogs]);

  // 새로고침
  const refresh = useCallback(async () => {
    await fetchTodayLogs();
  }, [fetchTodayLogs]);

  return {
    todayLogs,
    loading,
    error,
    saveExercise,
    getExerciseLogs,
    getTodayTotalMinutes,
    refresh,
  };
}
