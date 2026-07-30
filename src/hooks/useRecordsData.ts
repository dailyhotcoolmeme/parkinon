/**
 * useRecordsData.ts
 * 기록 보기 화면용 Supabase 데이터 조회 훅
 *
 * - 이번 주 / 이번 달 / 최근 3개월 기간별 집계
 * - 이전 기간 데이터도 함께 조회하여 비교값 계산
 * - triggered_by='notification' 필터 적용 (몸상태/기분)
 * - med_logs, on_off_logs, exercise_logs 테이블 사용
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Database } from '../types/database';
import i18n from '../i18n';

type Period = 'week' | 'month' | 'quarter';

// 시간대별 평균 (trigger_time_label 기준)
export interface TimeSlotAvg {
  label: string;   // minutesToLabel 결과에 해당하는 trigger_time_label 값
  avg: number;
  count: number;
}

export interface RecordsSummary {
  // 약 복용
  medication: {
    current: number;   // 복용률 % (복용 횟수 / 예상 횟수)
    prev: number;
    currentCount: number;
    prevCount: number;
  };
  // 몸상태 (시간대별 평균, notification 기록만)
  bodyState: Record<string, { current: number; prev: number }>;
  // 기분 (시간대별 평균, notification 기록만)
  mood: Record<string, { current: number; prev: number }>;
  // 수면 (평균점수)
  sleep: { current: number; prev: number };
  // 변비 (true 기록 일수)
  constipation: { currentDays: number; prevDays: number };
  // 운동
  exercise: { currentCount: number; prevCount: number; currentMinutes: number; prevMinutes: number };
}

export interface UseRecordsDataReturn {
  summary: RecordsSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // 미연동 보호자: 보호자인데 연동 환자 id 없음(해석 완료 후). 화면에서 안내 카드로 전환용.
  unlinkedCaregiver: boolean;
}

// 기간에 따른 날짜 범위 계산
function getDateRanges(period: Period): {
  current: { start: string; end: string };
  prev: { start: string; end: string };
} {
  const now = new Date();
  // 오늘 끝 (현재 순간)
  const todayEnd = now.toISOString();

  if (period === 'week') {
    // 이번 주: 이번 주 월요일 00:00 ~ 지금
    const dayOfWeek = now.getDay(); // 0=일요일
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() + mondayOffset);
    thisMonday.setHours(0, 0, 0, 0);

    // 지난 주: 저번 주 월요일 ~ 저번 주 일요일
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    lastSunday.setHours(23, 59, 59, 999);

    return {
      current: { start: thisMonday.toISOString(), end: todayEnd },
      prev: { start: lastMonday.toISOString(), end: lastSunday.toISOString() },
    };
  }

  if (period === 'month') {
    // 이번 달: 이번 달 1일 ~ 지금
    const thisMonth1st = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    // 지난 달: 지난달 1일 ~ 지난달 말일
    const lastMonth1st = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    return {
      current: { start: thisMonth1st.toISOString(), end: todayEnd },
      prev: { start: lastMonth1st.toISOString(), end: lastMonthEnd.toISOString() },
    };
  }

  // 최근 3개월: 3개월 전 오늘 ~ 지금
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);
  threeMonthsAgo.setHours(0, 0, 0, 0);

  // 이전 3개월: 6개월 전 ~ 3개월 전
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const prevEnd = new Date(threeMonthsAgo);
  prevEnd.setMilliseconds(-1);

  return {
    current: { start: threeMonthsAgo.toISOString(), end: todayEnd },
    prev: { start: sixMonthsAgo.toISOString(), end: prevEnd.toISOString() },
  };
}

// 기간 내 예상 복용 횟수 계산 (하루 3회 기준)
function estimateMedDoses(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  const diffMs = e.getTime() - s.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(diffDays * 3, 1);
}

export function useRecordsData(period: Period): UseRecordsDataReturn {
  const { user } = useAuth();
  const [summary, setSummary] = useState<RecordsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlinkedCaregiver, setUnlinkedCaregiver] = useState(false);

  // 환자 ID 결정 (보호자면 그룹 내 환자 ID 조회)
  // ⚠️ 미연동 보호자는 절대 user.id 로 폴백하지 않는다(본인 빈 기록을 환자처럼 보여주는 버그).
  //    환자가 없으면 null 을 반환 → 화면에서 가족 연동 안내로 전환.
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

    return data?.user_id ?? null;
  }, [user]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const patientId = await getPatientId();
      if (!patientId) {
        // 보호자인데 연동 환자가 없으면 안내 카드로 전환(빈 0% 표시 방지).
        setUnlinkedCaregiver(user.role === 'caregiver');
        setSummary(null);
        setLoading(false);
        return;
      }
      setUnlinkedCaregiver(false);

      const { current, prev } = getDateRanges(period);

      // ── 1. 약 복용 (med_logs) ──────────────────────────────────────────────
      const [medCurrRes, medPrevRes] = await Promise.all([
        supabase
          .from('med_logs')
          .select('id', { count: 'exact', head: true })
          .eq('patient_id', patientId)
          .gte('taken_at', current.start)
          .lte('taken_at', current.end),
        supabase
          .from('med_logs')
          .select('id', { count: 'exact', head: true })
          .eq('patient_id', patientId)
          .gte('taken_at', prev.start)
          .lte('taken_at', prev.end),
      ]);

      if (medCurrRes.error) throw medCurrRes.error;
      if (medPrevRes.error) throw medPrevRes.error;

      const medCurrCount = medCurrRes.count ?? 0;
      const medPrevCount = medPrevRes.count ?? 0;

      const medCurrDoses = estimateMedDoses(current.start, current.end);
      const medPrevDoses = estimateMedDoses(prev.start, prev.end);

      const medCurrRate = Math.round((medCurrCount / medCurrDoses) * 100);
      const medPrevRate = Math.round((medPrevCount / medPrevDoses) * 100);

      // ── 2. 몸상태 + 기분 + 수면 + 변비 (on_off_logs) ────────────────────────
      // 몸상태/기분은 triggered_by='notification' 만, 수면/변비는 전체
      const [onOffCurrRes, onOffPrevRes] = await Promise.all([
        supabase
          .from('on_off_logs')
          .select('body_state, mood, sleep_quality, constipation, triggered_by, trigger_time_label, logged_at')
          .eq('patient_id', patientId)
          .gte('logged_at', current.start)
          .lte('logged_at', current.end),
        supabase
          .from('on_off_logs')
          .select('body_state, mood, sleep_quality, constipation, triggered_by, trigger_time_label, logged_at')
          .eq('patient_id', patientId)
          .gte('logged_at', prev.start)
          .lte('logged_at', prev.end),
      ]);

      if (onOffCurrRes.error) throw onOffCurrRes.error;
      if (onOffPrevRes.error) throw onOffPrevRes.error;

      const currLogs = onOffCurrRes.data ?? [];
      const prevLogs = onOffPrevRes.data ?? [];

      // triggered_by='notification' 인 것만 필터 (약효 패턴용)
      const currNotifLogs = currLogs.filter(l => l.triggered_by === 'notification');
      const prevNotifLogs = prevLogs.filter(l => l.triggered_by === 'notification');

      // 시간대별 평균 계산 함수
      function calcTimeAvg(
        logs: typeof currNotifLogs,
        field: 'body_state' | 'mood',
      ): Record<string, { sum: number; count: number }> {
        const acc: Record<string, { sum: number; count: number }> = {};
        for (const log of logs) {
          const val = log[field];
          if (val == null) continue;
          const label = log.trigger_time_label ?? i18n.t('recordsHook.unknownLabel');
          if (!acc[label]) acc[label] = { sum: 0, count: 0 };
          acc[label].sum += val;
          acc[label].count += 1;
        }
        return acc;
      }

      // 알려진 시간대 순서 정의 (trigger_time_label 값 기준)
      const TIME_LABEL_ORDER = ['after_medication', '30min_after', '2hour_after'];

      function buildTimeRecord(
        currAcc: Record<string, { sum: number; count: number }>,
        prevAcc: Record<string, { sum: number; count: number }>,
      ): Record<string, { current: number; prev: number }> {
        const result: Record<string, { current: number; prev: number }> = {};
        // 현재 기간에 있는 라벨 + 알려진 순서 합집합
        const labels = Array.from(
          new Set([...TIME_LABEL_ORDER, ...Object.keys(currAcc), ...Object.keys(prevAcc)])
        ).filter(l => currAcc[l] || prevAcc[l]);

        for (const label of labels) {
          const c = currAcc[label];
          const p = prevAcc[label];
          result[label] = {
            current: c ? parseFloat((c.sum / c.count).toFixed(2)) : 0,
            prev: p ? parseFloat((p.sum / p.count).toFixed(2)) : 0,
          };
        }
        return result;
      }

      const bodyStateCurrAcc = calcTimeAvg(currNotifLogs, 'body_state');
      const bodyStatePrevAcc = calcTimeAvg(prevNotifLogs, 'body_state');
      const bodyStateRecord = buildTimeRecord(bodyStateCurrAcc, bodyStatePrevAcc);

      const moodCurrAcc = calcTimeAvg(currNotifLogs, 'mood');
      const moodPrevAcc = calcTimeAvg(prevNotifLogs, 'mood');
      const moodRecord = buildTimeRecord(moodCurrAcc, moodPrevAcc);

      // 수면 평균 (전체 로그)
      function calcAvg(logs: typeof currLogs, field: 'sleep_quality'): number {
        const vals = logs.map(l => l[field]).filter((v): v is number => v != null);
        if (vals.length === 0) return 0;
        return parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2));
      }

      const sleepCurr = calcAvg(currLogs, 'sleep_quality');
      const sleepPrev = calcAvg(prevLogs, 'sleep_quality');

      // 변비 기록 일수 (constipation=true 인 날짜 수)
      function countConstipationDays(logs: typeof currLogs): number {
        const days = new Set<string>();
        for (const log of logs) {
          if (log.constipation === true) {
            // logged_at 날짜만 추출
            days.add(log.logged_at.split('T')[0]);
          }
        }
        return days.size;
      }

      const constCurrDays = countConstipationDays(currLogs);
      const constPrevDays = countConstipationDays(prevLogs);

      // ── 3. 운동 (exercise_logs) ────────────────────────────────────────────
      const [exCurrRes, exPrevRes] = await Promise.all([
        supabase
          .from('exercise_logs')
          .select('duration_minutes')
          .eq('patient_id', patientId)
          .gte('logged_at', current.start)
          .lte('logged_at', current.end),
        supabase
          .from('exercise_logs')
          .select('duration_minutes')
          .eq('patient_id', patientId)
          .gte('logged_at', prev.start)
          .lte('logged_at', prev.end),
      ]);

      if (exCurrRes.error) throw exCurrRes.error;
      if (exPrevRes.error) throw exPrevRes.error;

      const exCurrData = exCurrRes.data ?? [];
      const exPrevData = exPrevRes.data ?? [];
      const exCurrMinutes = exCurrData.reduce((s, r) => s + r.duration_minutes, 0);
      const exPrevMinutes = exPrevData.reduce((s, r) => s + r.duration_minutes, 0);

      // ── 결과 조합 ─────────────────────────────────────────────────────────
      setSummary({
        medication: {
          current: Math.min(medCurrRate, 100),
          prev: Math.min(medPrevRate, 100),
          currentCount: medCurrCount,
          prevCount: medPrevCount,
        },
        bodyState: bodyStateRecord,
        mood: moodRecord,
        sleep: { current: sleepCurr, prev: sleepPrev },
        constipation: { currentDays: constCurrDays, prevDays: constPrevDays },
        exercise: {
          currentCount: exCurrData.length,
          prevCount: exPrevData.length,
          currentMinutes: exCurrMinutes,
          prevMinutes: exPrevMinutes,
        },
      });
    } catch (err: any) {
      console.error('[useRecordsData] lookup error:', err);
      setError(i18n.t('recordsHook.fetchError'));
    } finally {
      setLoading(false);
    }
  }, [user, period, getPatientId]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]);

  return { summary, loading, error, refresh: fetchData, unlinkedCaregiver };
}
