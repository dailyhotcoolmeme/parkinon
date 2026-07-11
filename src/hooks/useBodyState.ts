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
import { getLocalToday, getLocalDayRange } from '../utils/medUtils';
import type { Database } from '../types/database';
import i18n from '../i18n';

type OnOffLogRow = Database['public']['Tables']['on_off_logs']['Row'];
type TriggeredBy = Database['public']['Tables']['on_off_logs']['Row']['triggered_by'];
type MediaLogRow = Database['public']['Tables']['media_logs']['Row'];

export interface BodyStateInput {
  body_state?: number;    // 1~5
  mood?: number;          // 1~5
  sleep_quality?: number; // 1~5
  constipation?: boolean;
  trigger_time_label?: string; // 'after_medication' | '30min_after' | '2hour_after'
  medication_meal_time?: string; // 'morning' | 'lunch' | 'dinner' | 'bedtime'
  // 약 복용 모델 7단계: 슬롯별 통계용 dose_slot_id + 어느 복용의 약효인지 1:1 매칭용 med_log_id.
  // 둘 다 없을 수 있음(미이관·수동) → 조건부 insert, NULL 허용.
  dose_slot_id?: string;
  med_log_id?: string;
}

export interface UseBodyStateReturn {
  todayLogs: OnOffLogRow[];
  loading: boolean;
  /** 오늘 로그를 최소 1회 조회 완료했는지. false면 todayLogs 가 아직 신뢰할 수 없음(콜드스타트 등). */
  loadedOnce: boolean;
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
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 환자 ID 결정
  const getPatientId = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (user.role === 'patient') return user.id;

    // 가족 미연동 보호자: null 반환
    if (!user.patient_group_id) return null;

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

      const tz = user?.timezone || 'Asia/Seoul';
      const today = getLocalToday(tz);
      const { start, end } = getLocalDayRange(today, tz);

      const { data, error: queryError } = await supabase
        .from('on_off_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', start)
        .lte('logged_at', end)
        .order('logged_at', { ascending: false });

      if (queryError) throw queryError;
      setTodayLogs(data ?? []);
    } catch (err: any) {
      console.error('[useBodyState] fetchTodayLogs 오류:', err);
      setError(err.message ?? i18n.t('bodyStateHook.fetchError'));
    } finally {
      setLoading(false);
      setLoadedOnce(true);
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
        setError(i18n.t('bodyStateHook.noPatientError'));
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
      if (data.medication_meal_time !== undefined) insertData.medication_meal_time = data.medication_meal_time;
      if (data.dose_slot_id !== undefined) insertData.dose_slot_id = data.dose_slot_id;
      if (data.med_log_id !== undefined) insertData.med_log_id = data.med_log_id;

      const { data: insertedRows, error: insertError } = await supabase
        .from('on_off_logs')
        .insert(insertData)
        .select();

      if (insertError) throw insertError;

      // 낙관적 반영 — insert().select() 로 받은 실제 행을 todayLogs 에 즉시 머지.
      //   재조회(void fetchTodayLogs)나 realtime 재조회 푸시(RTT)를 기다리지 않고
      //   몸상태 리스트에 바로 보이게 한다. 오늘 날짜인 경우에만 의미가 있지만,
      //   화면(BodyStateScreen)이 isToday 일 때만 todayLogs 를 표시하므로 항상 prepend 해도 무해하다.
      //   정렬: todayLogs 는 logged_at 내림차순(최신 먼저) → prepend.
      //   dedupe: 같은 id 가 이미 있으면(재조회가 먼저 끝난 경우 등) 새 행으로 교체.
      //           이후의 fetchTodayLogs/realtime 재조회는 전체 setTodayLogs(data) 로 덮어쓰므로
      //           중복이 누적되지 않는다(머지는 그 사이 짧은 구간의 신선도만 보장).
      const insertedRow = insertedRows?.[0];
      if (insertedRow) {
        setTodayLogs((prev) => {
          const filtered = prev.filter((r) => r.id !== insertedRow.id);
          return [insertedRow, ...filtered];
        });
      }

      // 오늘 기록 갱신 — await 하지 않는다(비대기).
      //   재조회 완료를 기다리면 호출부(handleSaveRecord)의 다음 안내 팝업 표시가
      //   그만큼 지연된다. 리스트 신선도는 on_off_logs realtime 구독 + 호출부의 refresh()로
      //   이미 보장되므로, 여기서는 백그라운드로만 갱신한다(낙관적 행을 서버 실제 상태로 정정).
      void fetchTodayLogs();

      // 보호자에게 푸시 알림 — 기록 직후 다음 안내 팝업을 즉시 띄우기 위해 백그라운드로(await 안 함)
      void (async () => {
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
            let patientName = i18n.t('bodyStateHook.defaultPatientName');
            if (user.role === 'patient') {
              patientName = user.name || i18n.t('bodyStateHook.defaultPatientName');
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

              // 한 번의 기록(같은 on_off_logs 행)에 담긴 항목들을 모아 보호자에게 1개 알림으로 보낸다.
              // 항목별 보호자 수신 설정(prefs)은 그대로 존중 — 켜진 항목만 묶음에 포함.
              const parts: string[] = [];
              if (data.body_state !== undefined && prefs.body_state !== false) {
                parts.push(i18n.t('bodyStateHook.partBodyState', { score: data.body_state }));
              }
              if (data.mood !== undefined && prefs.mood !== false) {
                parts.push(i18n.t('bodyStateHook.partMood', { score: data.mood }));
              }
              if (data.sleep_quality !== undefined && prefs.sleep !== false) {
                parts.push(i18n.t('bodyStateHook.partSleep'));
              }
              if (data.constipation !== undefined && prefs.constipation !== false) {
                parts.push(i18n.t('bodyStateHook.partConstipation'));
              }
              if (parts.length > 0) {
                await sendCaregiverPush(
                  cu.push_token,
                  i18n.t('bodyStateHook.pushTitle'),
                  i18n.t('bodyStateHook.pushBody', { name: patientName, parts: parts.join(' · ') }),
                  { type: 'caregiver_body_state' },
                );
              }
            }
          }
        }
      } catch (notifErr) {
        console.error('[useBodyState] 보호자 푸시 실패 (기록은 저장됨):', notifErr);
      }
      })();

      return true;
    } catch (err: any) {
      console.error('[useBodyState] saveBodyState 오류:', err);
      setError(err.message ?? i18n.t('bodyStateHook.saveError'));
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

      const { start, end } = getLocalDayRange(date, user?.timezone || 'Asia/Seoul');
      const { data, error: queryError } = await supabase
        .from('on_off_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', start)
        .lte('logged_at', end)
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

      const tz = user?.timezone || 'Asia/Seoul';
      const today = getLocalToday(tz);
      const { start } = getLocalDayRange(today, tz);

      const { count, error: queryError } = await supabase
        .from('on_off_logs')
        .select('*', { count: 'exact', head: true })
        .eq('patient_id', patientId)
        .gte('logged_at', start);

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

      const { start, end } = getLocalDayRange(date, user?.timezone || 'Asia/Seoul');
      const { data } = await supabase
        .from('media_logs')
        .select('*')
        .eq('patient_id', patientId)
        .eq('media_type', 'video')
        .eq('category', 'body_state')
        .gte('logged_at', start)
        .lte('logged_at', end)
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
    loadedOnce,
    error,
    saveBodyState,
    getBodyStateLogs,
    isFirstLogToday,
    getPatientId,
    refresh,
    fetchVideoLogs,
  };
}
