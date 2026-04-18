/**
 * useBodyState.ts
 * 몸 상태(ON/OFF) 기록 관련 훅
 *
 * - on_off_logs 오늘 기록 조회
 * - saveBodyState(data, triggeredBy) - 기록 저장
 * - getBodyStateLogs(date) - 날짜별 기록 조회
 * - isFirstLogToday() - 오늘 첫 번째 기록 여부 (수면 질문 표시용)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { sendCaregiverPush } from '../utils/notifications';
import type { Database } from '../types/database';

type OnOffLogRow = Database['public']['Tables']['on_off_logs']['Row'];
type TriggeredBy = Database['public']['Tables']['on_off_logs']['Row']['triggered_by'];
type MediaLogRow = Database['public']['Tables']['media_logs']['Row'];

export interface BodyStateInput {
  body_state?: number;    // 1~5
  mood?: number;          // 1~5
  sleep_quality?: number; // 1~5
  constipation?: boolean;
  trigger_time_label?: string; // 'after_medication' | '30min_after' | '2hour_after'
}

export interface UseBodyStateReturn {
  todayLogs: OnOffLogRow[];
  loading: boolean;
  error: string | null;
  saveBodyState: (data: BodyStateInput, triggeredBy: TriggeredBy) => Promise<boolean>;
  getBodyStateLogs: (date: string) => Promise<OnOffLogRow[]>;
  isFirstLogToday: () => Promise<boolean>;
  getPatientId: () => Promise<string | null>;
  refresh: () => Promise<void>;
  fetchVideoLogs: (date: string) => Promise<MediaLogRow[]>;
}

export function useBodyState(): UseBodyStateReturn {
  const { user } = useAuth();
  const [todayLogs, setTodayLogs] = useState<OnOffLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 환자 ID 결정
  const getPatientId = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (user.role === 'patient') return user.id;

    // 가족 미연동 보호자: 본인 id fallback
    if (!user.patient_group_id) return user.id;

    const { data } = await supabase
      .from('patient_group_members')
      .select('user_id, role')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single();

    return data?.user_id ?? user.id;
  }, [user]);

  // 오늘 기록 조회
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
        .from('on_off_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', `${today}T00:00:00.000Z`)
        .lte('logged_at', `${today}T23:59:59.999Z`)
        .order('logged_at', { ascending: false });

      if (queryError) throw queryError;
      setTodayLogs(data ?? []);
    } catch (err: any) {
      console.error('[useBodyState] fetchTodayLogs 오류:', err);
      setError(err.message ?? '기록을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId]);

  // 몸상태 기록 저장
  const saveBodyState = useCallback(async (
    data: BodyStateInput,
    triggeredBy: TriggeredBy
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
        triggered_by: triggeredBy,
        logged_at: new Date().toISOString(),
      };

      if (data.body_state !== undefined) insertData.body_state = data.body_state;
      if (data.mood !== undefined) insertData.mood = data.mood;
      if (data.sleep_quality !== undefined) insertData.sleep_quality = data.sleep_quality;
      if (data.constipation !== undefined) insertData.constipation = data.constipation;
      if (data.trigger_time_label !== undefined) insertData.trigger_time_label = data.trigger_time_label;

      const { error: insertError } = await supabase
        .from('on_off_logs')
        .insert(insertData);

      if (insertError) throw insertError;

      // 오늘 기록 갱신
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

            for (const cu of caregiverUsers ?? []) {
              if (!cu.push_token) continue;
              const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>;
              if (prefs.body_state !== false) {
                await sendCaregiverPush(
                  cu.push_token,
                  '😊 몸 상태를 기록했어요',
                  '환자분이 몸 상태를 기록했어요.',
                  { type: 'caregiver_body_state' },
                );
              }
            }
          }
        }
      } catch (notifErr) {
        console.error('[useBodyState] 보호자 푸시 실패 (기록은 저장됨):', notifErr);
      }

      return true;
    } catch (err: any) {
      console.error('[useBodyState] saveBodyState 오류:', err);
      setError(err.message ?? '기록 저장에 실패했어요.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, getPatientId, fetchTodayLogs]);

  // 날짜별 기록 조회
  const getBodyStateLogs = useCallback(async (date: string): Promise<OnOffLogRow[]> => {
    if (!user) return [];

    try {
      const patientId = await getPatientId();
      if (!patientId) return [];

      const { data, error: queryError } = await supabase
        .from('on_off_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', `${date}T00:00:00.000Z`)
        .lte('logged_at', `${date}T23:59:59.999Z`)
        .order('logged_at', { ascending: true });

      if (queryError) throw queryError;
      return data ?? [];
    } catch (err: any) {
      console.error('[useBodyState] getBodyStateLogs 오류:', err);
      return [];
    }
  }, [user, getPatientId]);

  // 오늘 첫 번째 기록 여부 확인 (수면 질문 표시용)
  const isFirstLogToday = useCallback(async (): Promise<boolean> => {
    if (!user) return true;

    try {
      const patientId = await getPatientId();
      if (!patientId) return true;

      const today = new Date().toISOString().split('T')[0];

      const { count, error: queryError } = await supabase
        .from('on_off_logs')
        .select('*', { count: 'exact', head: true })
        .eq('patient_id', patientId)
        .gte('logged_at', `${today}T00:00:00.000Z`);

      if (queryError) throw queryError;
      return (count ?? 0) === 0;
    } catch (err: any) {
      console.error('[useBodyState] isFirstLogToday 오류:', err);
      return true;
    }
  }, [user, getPatientId]);

  // 날짜별 영상 목록 조회
  const fetchVideoLogs = useCallback(async (date: string): Promise<MediaLogRow[]> => {
    if (!user) return [];

    try {
      const patientId = await getPatientId();
      if (!patientId) return [];

      const { data } = await supabase
        .from('media_logs')
        .select('*')
        .eq('patient_id', patientId)
        .eq('media_type', 'video')
        .eq('category', 'body_state')
        .gte('logged_at', `${date}T00:00:00.000Z`)
        .lte('logged_at', `${date}T23:59:59.999Z`)
        .order('logged_at', { ascending: false });

      return data ?? [];
    } catch (err: any) {
      console.error('[useBodyState] fetchVideoLogs 오류:', err);
      return [];
    }
  }, [user, getPatientId]);

  // 초기 로드
  useEffect(() => {
    if (user) {
      fetchTodayLogs();
    }
  }, [user, fetchTodayLogs]);

  // 새로고침
  const refresh = useCallback(async () => {
    await fetchTodayLogs();
  }, [fetchTodayLogs]);

  return {
    todayLogs,
    loading,
    error,
    saveBodyState,
    getBodyStateLogs,
    isFirstLogToday,
    getPatientId,
    refresh,
    fetchVideoLogs,
  };
}
