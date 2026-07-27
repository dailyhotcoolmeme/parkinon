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
import { logActivity } from '../utils/activityLog';
import { useAuth } from '../context/AuthContext';
import { sendCaregiverPush } from '../utils/notifications';
import { getLocalToday, getLocalDayRange } from '../utils/medUtils';
import type { Database } from '../types/database';
import i18n from '../i18n';

type ExerciseLogRow = Database['public']['Tables']['exercise_logs']['Row'];

export interface UseExerciseReturn {
  todayLogs: ExerciseLogRow[];
  loading: boolean;
  error: string | null;
  saveExercise: (exerciseType: string, durationMinutes: number) => Promise<boolean>;
  cancelExercise: (exerciseLogId: string) => Promise<boolean>;
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

    if (!user.patient_group_id) return null;

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

      const tz = user?.timezone || 'Asia/Seoul';
      const today = getLocalToday(tz);
      const { start, end } = getLocalDayRange(today, tz);

      const { data, error: queryError } = await supabase
        .from('exercise_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', start)
        .lte('logged_at', end)
        .order('logged_at', { ascending: false });

      if (queryError) throw queryError;
      setTodayLogs(data ?? []);
    } catch (err: any) {
      console.error('[useExercise] fetchTodayLogs 오류:', err);
      setError(i18n.t('exerciseHook.fetchError'));
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
        setError(i18n.t('exerciseHook.noPatientError'));
        return false;
      }

      if (durationMinutes <= 0 || durationMinutes > 300) {
        setError(i18n.t('exerciseHook.invalidDurationError'));
        return false;
      }

      // 덮어쓰기(마지막 것만): 같은 운동 종류·같은 날(KST) 기존 기록을 지우고 새로 기록.
      // (운동은 하루 여러 종류가 정상 → '같은 종류'만 교체. RLS상 본인(logged_by) 행만 삭제됨)
      const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const dayStartMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 60 * 60 * 1000;
      const dayStartIso = new Date(dayStartMs).toISOString();
      const dayEndIso = new Date(dayStartMs + 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from('exercise_logs')
        .delete()
        .eq('patient_id', patientId)
        .eq('exercise_type', exerciseType)
        .gte('logged_at', dayStartIso)
        .lt('logged_at', dayEndIso);

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

      logActivity('exercise_saved', { exercise_type: exerciseType, duration_minutes: durationMinutes });

      await fetchTodayLogs();

      // 보호자에게 푸시 알림
      try {
        if (user.patient_group_id) {
          const { data: caregivers } = await supabase
            .from('patient_group_members')
            .select('user_id')
            .eq('group_id', user.patient_group_id)
            .eq('role', 'caregiver');

          if (caregivers?.length) {
            const caregiverIds = caregivers.map((c: any) => c.user_id);
            const { data: caregiverUsers } = await supabase
              .from('users')
              .select('push_token, caregiver_notif_prefs')
              .in('id', caregiverIds)
              .not('push_token', 'is', null);

            // 환자 이름 조회
            let patientName = i18n.t('exerciseHook.defaultPatientName');
            if (user.role === 'patient') {
              patientName = user.name || i18n.t('exerciseHook.defaultPatientName');
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
              if (prefs.exercise !== false) {
                await sendCaregiverPush(
                  cu.push_token,
                  i18n.t('exerciseHook.pushTitle'),
                  i18n.t('exerciseHook.pushBody', { name: patientName, type: exerciseType, duration: durationMinutes }),
                  { type: 'caregiver_exercise' },
                );
              }
            }
          }
        }
      } catch (notifErr) {
        console.error('[useExercise] 보호자 푸시 실패 (기록은 저장됨):', notifErr);
      }

      // 같은 시간대 미읽음 운동 알림 일괄 읽음 처리
      try {
        const now = new Date().toISOString();
        await supabase
          .from('notification_logs')
          .update({ read_at: now })
          .eq('user_id', user.id)
          .eq('type', 'exercise_reminder')
          .is('read_at', null);
      } catch (e) {
        // silent — 운동 기록 자체엔 영향 없음
      }

      return true;
    } catch (err: any) {
      console.error('[useExercise] saveExercise 오류:', err);
      setError(i18n.t('exerciseHook.saveError'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId, fetchTodayLogs]);

  // 운동 기록 취소(삭제)
  // RLS 우회 + 권한 자체검증을 위해 직접 delete가 아닌 RPC 사용
  const cancelExercise = useCallback(async (exerciseLogId: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const { error: rpcError } = await supabase.rpc('cancel_patient_record', {
        p_table: 'exercise_logs',
        p_record_id: exerciseLogId,
      });

      if (rpcError) throw rpcError;

      await fetchTodayLogs();
      return true;
    } catch (err: any) {
      console.error('[useExercise] cancelExercise 오류:', err);
      return false;
    }
  }, [user, fetchTodayLogs]);

  // 날짜별 기록 조회
  const getExerciseLogs = useCallback(async (date: string): Promise<{ logs: ExerciseLogRow[]; error: string | null }> => {
    if (!user) return { logs: [], error: null };

    try {
      const patientId = await getPatientId();
      if (!patientId) return { logs: [], error: null };

      const { start, end } = getLocalDayRange(date, user?.timezone || 'Asia/Seoul');
      const { data, error: queryError } = await supabase
        .from('exercise_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', start)
        .lte('logged_at', end)
        .order('logged_at', { ascending: true });

      if (queryError) throw queryError;
      return { logs: data ?? [], error: null };
    } catch (err: any) {
      console.error('[useExercise] getExerciseLogs 오류:', err);
      const msg = i18n.t('exerciseHook.fetchError');
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
    cancelExercise,
    getExerciseLogs,
    getTodayTotalMinutes,
    refresh,
  };
}
