/**
 * useRecordDetailData.ts
 * 기록 상세 화면(RecordDetailScreen)용 Supabase 데이터 조회 훅
 *
 * - 현황 카드: 현재 기간 vs 이전 기간 비교
 * - 트렌드 그래프: 기간별 과거 9개 데이터 포인트
 *   - 주별: 이번주 포함 최근 9주
 *   - 월별: 이번달 포함 최근 5개월
 *   - 3개월별: 최근3개월 포함 최근 4구간(12개월)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Database } from '../types/database';

type Period = '이번 주' | '이번 달' | '최근 3개월';
type ItemKey = 'medication' | 'bodyState' | 'mood' | 'sleep' | 'constipation' | 'exercise';

export interface TrendPoint {
  value: number;
  label: string;
}

export interface TrendSeries {
  points: TrendPoint[];
  unit: string;
  max: number;
  color: string;
}

// 시간대별 트렌드 (bodyState/mood): key = trigger_time_label
export type TimeSeriesMap = Record<string, TrendSeries>;

export interface SummarySlot {
  current: number;
  prev: number;
  unit: string;
  // 시간대별 항목용
  timeSlots?: Record<string, { current: number; prev: number }>;
}

export interface UseRecordDetailDataReturn {
  summarySlot: SummarySlot | null;
  // 일반 항목 트렌드
  trendSeries: TrendSeries | null;
  // 시간대별 트렌드 (bodyState/mood)
  timeSeriesMap: TimeSeriesMap | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// ── 날짜 범위 유틸 ─────────────────────────────────────────────────────────────

function getWeekRange(weeksAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + mondayOffset);
  thisMonday.setHours(0, 0, 0, 0);

  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() - weeksAgo * 7);

  const end = new Date(start);
  if (weeksAgo === 0) {
    // 이번 주: 지금까지
    end.setTime(now.getTime());
  } else {
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

function getMonthRange(monthsAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1, 0, 0, 0, 0);
  let end: Date;
  if (monthsAgo === 0) {
    end = new Date(now);
  } else {
    end = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0, 23, 59, 59, 999);
  }
  return { start, end };
}

function getQuarterRange(quartersAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(now.getMonth() - (quartersAgo + 1) * 3);
  start.setHours(0, 0, 0, 0);

  let end: Date;
  if (quartersAgo === 0) {
    end = new Date(now);
  } else {
    end = new Date(now);
    end.setMonth(now.getMonth() - quartersAgo * 3);
    end.setMilliseconds(-1);
  }
  return { start, end };
}

function weekLabel(weeksAgo: number): string {
  if (weeksAgo === 0) return '이번주';
  if (weeksAgo === 1) return '지난주';
  return `${weeksAgo}주전`;
}

function monthLabel(monthsAgo: number): string {
  if (monthsAgo === 0) return '이번달';
  if (monthsAgo === 1) return '지난달';
  return `${monthsAgo}개월전`;
}

function quarterLabel(quartersAgo: number): string {
  if (quartersAgo === 0) return '최근3개월';
  if (quartersAgo === 1) return '지난3개월';
  return `${quartersAgo * 3}개월전`;
}

// ── 집계 함수 ─────────────────────────────────────────────────────────────────

type MedLogRow = Pick<Database['public']['Tables']['med_logs']['Row'], 'id' | 'taken_at'>;
type OnOffRow = Pick<
  Database['public']['Tables']['on_off_logs']['Row'],
  'body_state' | 'mood' | 'sleep_quality' | 'constipation' | 'triggered_by' | 'trigger_time_label' | 'logged_at'
>;
type ExRow = Pick<Database['public']['Tables']['exercise_logs']['Row'], 'duration_minutes' | 'logged_at'>;

function estimateDoses(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(diffDays * 3, 1);
}

function medRate(logs: MedLogRow[], start: Date, end: Date): number {
  const doses = estimateDoses(start, end);
  return Math.min(Math.round((logs.length / doses) * 100), 100);
}

function avgField(logs: OnOffRow[], field: 'sleep_quality'): number {
  const vals = logs.map(l => l[field]).filter((v): v is number => v != null);
  if (vals.length === 0) return 0;
  return parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2));
}

function countConstipationDays(logs: OnOffRow[]): number {
  const days = new Set<string>();
  for (const log of logs) {
    if (log.constipation === true) days.add(log.logged_at.split('T')[0]);
  }
  return days.size;
}

function timeSlotAvg(
  logs: OnOffRow[],
  field: 'body_state' | 'mood',
): Record<string, number> {
  const acc: Record<string, { sum: number; count: number }> = {};
  for (const log of logs.filter(l => l.triggered_by === 'notification')) {
    const val = log[field];
    if (val == null) continue;
    const label = log.trigger_time_label ?? 'unknown';
    if (!acc[label]) acc[label] = { sum: 0, count: 0 };
    acc[label].sum += val;
    acc[label].count += 1;
  }
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) {
    result[k] = parseFloat((v.sum / v.count).toFixed(2));
  }
  return result;
}

// ── 훅 ───────────────────────────────────────────────────────────────────────

export function useRecordDetailData(type: ItemKey, period: Period): UseRecordDetailDataReturn {
  const { user } = useAuth();
  const [summarySlot, setSummarySlot] = useState<SummarySlot | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeries | null>(null);
  const [timeSeriesMap, setTimeSeriesMap] = useState<TimeSeriesMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const patientId = await getPatientId();
      if (!patientId) {
        setLoading(false);
        return;
      }

      // ── 기간 구간 정의 ─────────────────────────────────────────────────────
      type RangeEntry = { start: Date; end: Date; label: string };
      let ranges: RangeEntry[] = [];

      if (period === '이번 주') {
        // 최근 9주 (이번 주 포함)
        for (let w = 8; w >= 0; w--) {
          const r = getWeekRange(w);
          ranges.push({ start: r.start, end: r.end, label: weekLabel(w) });
        }
      } else if (period === '이번 달') {
        // 최근 5개월 (이번 달 포함)
        for (let m = 4; m >= 0; m--) {
          const r = getMonthRange(m);
          ranges.push({ start: r.start, end: r.end, label: monthLabel(m) });
        }
      } else {
        // 최근 4구간 (이번 3개월 포함)
        for (let q = 3; q >= 0; q--) {
          const r = getQuarterRange(q);
          ranges.push({ start: r.start, end: r.end, label: quarterLabel(q) });
        }
      }

      // 현재/이전 기간 (summary 카드용)
      const currRange = ranges[ranges.length - 1];
      const prevRange = ranges[ranges.length - 2] ?? ranges[0];

      // ── 데이터 조회 ────────────────────────────────────────────────────────
      // 전체 구간 start ~ 지금 한 번에 가져온 뒤 클라이언트에서 구간별 분류
      const totalStart = ranges[0].start.toISOString();
      const totalEnd = ranges[ranges.length - 1].end.toISOString();

      let medLogs: MedLogRow[] = [];
      let onOffLogs: OnOffRow[] = [];
      let exLogs: ExRow[] = [];

      if (type === 'medication') {
        const { data } = await supabase
          .from('med_logs')
          .select('id, taken_at')
          .eq('patient_id', patientId)
          .gte('taken_at', totalStart)
          .lte('taken_at', totalEnd);
        medLogs = data ?? [];
      } else if (type === 'exercise') {
        const { data } = await supabase
          .from('exercise_logs')
          .select('duration_minutes, logged_at')
          .eq('patient_id', patientId)
          .gte('logged_at', totalStart)
          .lte('logged_at', totalEnd);
        exLogs = data ?? [];
      } else {
        // bodyState, mood, sleep, constipation → on_off_logs
        const { data } = await supabase
          .from('on_off_logs')
          .select('body_state, mood, sleep_quality, constipation, triggered_by, trigger_time_label, logged_at')
          .eq('patient_id', patientId)
          .gte('logged_at', totalStart)
          .lte('logged_at', totalEnd);
        onOffLogs = data ?? [];
      }

      // ── 구간별 필터 함수 ───────────────────────────────────────────────────
      function filterMed(logs: MedLogRow[], s: Date, e: Date) {
        return logs.filter(l => {
          const t = new Date(l.taken_at);
          return t >= s && t <= e;
        });
      }
      function filterOnOff(logs: OnOffRow[], s: Date, e: Date) {
        return logs.filter(l => {
          const t = new Date(l.logged_at);
          return t >= s && t <= e;
        });
      }
      function filterEx(logs: ExRow[], s: Date, e: Date) {
        return logs.filter(l => {
          const t = new Date(l.logged_at);
          return t >= s && t <= e;
        });
      }

      // ── 구간별 집계 ────────────────────────────────────────────────────────
      // trigger_time_label 순서
      const TIME_ORDER = ['after_medication', '30min_after', '2hour_after'];
      const TIME_COLORS: Record<string, string> = {
        after_medication: '#F44336',
        '30min_after': '#4CAF50',
        '2hour_after': '#2196F3',
      };
      const TRIGGER_LABEL_TO_DISPLAY: Record<string, string> = {
        after_medication: '복용 직후',
        '30min_after': '30분 후',
        '2hour_after': '2시간 후',
      };

      if (type === 'medication') {
        const points: TrendPoint[] = ranges.map(r => ({
          value: medRate(filterMed(medLogs, r.start, r.end), r.start, r.end),
          label: r.label,
        }));
        const currLogs = filterMed(medLogs, currRange.start, currRange.end);
        const prevLogs = filterMed(medLogs, prevRange.start, prevRange.end);

        setSummarySlot({
          current: medRate(currLogs, currRange.start, currRange.end),
          prev: medRate(prevLogs, prevRange.start, prevRange.end),
          unit: '%',
        });
        setTrendSeries({ points, unit: '%', max: 100, color: '#4CAF50' });
        setTimeSeriesMap(null);

      } else if (type === 'sleep') {
        const points: TrendPoint[] = ranges.map(r => ({
          value: avgField(filterOnOff(onOffLogs, r.start, r.end), 'sleep_quality'),
          label: r.label,
        }));
        const curr = avgField(filterOnOff(onOffLogs, currRange.start, currRange.end), 'sleep_quality');
        const prev = avgField(filterOnOff(onOffLogs, prevRange.start, prevRange.end), 'sleep_quality');

        setSummarySlot({ current: curr, prev, unit: '점' });
        setTrendSeries({ points, unit: '점', max: 5, color: '#9C27B0' });
        setTimeSeriesMap(null);

      } else if (type === 'constipation') {
        const points: TrendPoint[] = ranges.map(r => ({
          value: countConstipationDays(filterOnOff(onOffLogs, r.start, r.end)),
          label: r.label,
        }));
        const curr = countConstipationDays(filterOnOff(onOffLogs, currRange.start, currRange.end));
        const prev = countConstipationDays(filterOnOff(onOffLogs, prevRange.start, prevRange.end));
        const maxVal = Math.max(...points.map(p => p.value), 7);

        setSummarySlot({ current: curr, prev, unit: '일' });
        setTrendSeries({ points, unit: '일', max: maxVal, color: '#FF9800' });
        setTimeSeriesMap(null);

      } else if (type === 'exercise') {
        const points: TrendPoint[] = ranges.map(r => ({
          value: filterEx(exLogs, r.start, r.end).length,
          label: r.label,
        }));
        const currEx = filterEx(exLogs, currRange.start, currRange.end);
        const prevEx = filterEx(exLogs, prevRange.start, prevRange.end);
        const maxVal = Math.max(...points.map(p => p.value), 7);

        setSummarySlot({
          current: currEx.length,
          prev: prevEx.length,
          unit: '회',
        });
        setTrendSeries({ points, unit: '회', max: maxVal, color: '#FF5722' });
        setTimeSeriesMap(null);

      } else {
        // bodyState 또는 mood: 시간대별
        const field: 'body_state' | 'mood' = type === 'bodyState' ? 'body_state' : 'mood';

        // 존재하는 trigger_time_label 수집
        const allLabels = new Set<string>();
        for (const log of onOffLogs) {
          if (log.triggered_by === 'notification' && log.trigger_time_label) {
            allLabels.add(log.trigger_time_label);
          }
        }
        // 순서 정렬
        const sortedLabels = [
          ...TIME_ORDER.filter(l => allLabels.has(l)),
          ...Array.from(allLabels).filter(l => !TIME_ORDER.includes(l)),
        ];

        // 현황 카드용
        const currAvg = timeSlotAvg(filterOnOff(onOffLogs, currRange.start, currRange.end), field);
        const prevAvg = timeSlotAvg(filterOnOff(onOffLogs, prevRange.start, prevRange.end), field);

        const timeSlots: Record<string, { current: number; prev: number }> = {};
        for (const label of sortedLabels) {
          timeSlots[label] = {
            current: currAvg[label] ?? 0,
            prev: prevAvg[label] ?? 0,
          };
        }

        // 가장 대표값 (중간 시간대)
        const midLabel = sortedLabels[Math.floor(sortedLabels.length / 2)] ?? sortedLabels[0];
        setSummarySlot({
          current: midLabel ? (currAvg[midLabel] ?? 0) : 0,
          prev: midLabel ? (prevAvg[midLabel] ?? 0) : 0,
          unit: '점',
          timeSlots,
        });

        // 트렌드: 시간대별 시리즈
        const tsmResult: TimeSeriesMap = {};
        for (const label of sortedLabels) {
          const color = TIME_COLORS[label] ?? '#607D8B';
          const points: TrendPoint[] = ranges.map(r => {
            const avg = timeSlotAvg(filterOnOff(onOffLogs, r.start, r.end), field);
            return { value: avg[label] ?? 0, label: r.label };
          });
          tsmResult[label] = {
            points,
            unit: '점',
            max: 5,
            color,
          };
        }
        setTimeSeriesMap(tsmResult);
        setTrendSeries(null);
      }
    } catch (err: any) {
      console.error('[useRecordDetailData] 조회 오류:', err);
      setError(err.message ?? '데이터를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [user, type, period, getPatientId]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]);

  return { summarySlot, trendSeries, timeSeriesMap, loading, error, refresh: fetchData };
}
