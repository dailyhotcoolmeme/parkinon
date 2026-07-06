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
import { triggerLabelToText, triggerLabelToMinutes } from '../utils/medUtils';
import { fetchPatientLabelDoseSlots, type DoseSlot } from './useDoseSlots';
import { formatSlotTime, slotSortValue, slotTitle } from '../constants/doseSlots';
import i18n from '../i18n';

function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

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
  // 시간대별 항목용 (bodyState/mood)
  timeSlots?: Record<string, { current: number; prev: number }>;
  // 약복용 식사 시간대별. 키 = 정규 슬롯 키(dose_slot_id / legacy meal_time)
  mealTimeSlots?: Record<string, { current: number; prev: number }>;
  // 약복용 슬롯 키 → 표시 라벨 (slot.label ?? 시각). 현황/트렌드 렌더 공용.
  mealSlotLabels?: Record<string, string>;
}

export interface UseRecordDetailDataReturn {
  summarySlot: SummarySlot | null;
  // 일반 항목 트렌드
  trendSeries: TrendSeries | null;
  // 시간대별 트렌드 (bodyState/mood)
  timeSeriesMap: TimeSeriesMap | null;
  // 약복용 식사 시간대별 트렌드
  mealTimeSeriesMap: TimeSeriesMap | null;
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
  if (isEnLocale()) {
    if (weeksAgo === 0) return 'This week';
    if (weeksAgo === 1) return 'Last week';
    return `${weeksAgo}w ago`;
  }
  if (weeksAgo === 0) return '이번주';
  if (weeksAgo === 1) return '지난주';
  return `${weeksAgo}주전`;
}

function monthLabel(monthsAgo: number): string {
  if (isEnLocale()) {
    if (monthsAgo === 0) return 'This month';
    if (monthsAgo === 1) return 'Last month';
    return `${monthsAgo}mo ago`;
  }
  if (monthsAgo === 0) return '이번달';
  if (monthsAgo === 1) return '지난달';
  return `${monthsAgo}개월전`;
}

function quarterLabel(quartersAgo: number): string {
  if (isEnLocale()) {
    if (quartersAgo === 0) return 'Last 3 mo';
    if (quartersAgo === 1) return 'Prev 3 mo';
    return `${quartersAgo * 3}mo ago`;
  }
  if (quartersAgo === 0) return '최근3개월';
  if (quartersAgo === 1) return '지난3개월';
  return `${quartersAgo * 3}개월전`;
}

// ── 집계 함수 ─────────────────────────────────────────────────────────────────

type MedLogRow = Pick<Database['public']['Tables']['med_logs']['Row'], 'id' | 'taken_at' | 'meal_time' | 'dose_slot_id'>;
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

// trigger_time_label → 분 수 (정렬용, 공용 유틸 위임)
function parseLabelMinutes(label: string): number {
  return triggerLabelToMinutes(label);
}

// trigger_time_label → 표시 문자열 (공용 유틸 위임, 하위 호환성 유지)
export function triggerLabelToDisplay(label: string): string {
  return triggerLabelToText(label) || label;
}

// 약복용 시간대별 슬롯 색 팔레트 — 기존 MEAL_COLORS(아침=빨강/점심=초록/저녁=파랑/취침=주황)
// 색을 그대로 순환 사용. 표준 4슬롯(sortOrder 0~3)은 기존과 동일 색을 받는다.
const MEAL_COLOR_PALETTE = ['#F44336', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#607D8B'];
const TRIGGER_COLORS = ['#F44336', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#607D8B'];

/**
 * 약복용 시간대별 집계의 슬롯 메타.
 * - slotKey: 정규 그룹 키 (dose_slot_id ?? legacyKey→slot.id ?? meal_time)
 * - label: 표시 라벨 (slot.label ?? formatSlotTime(slot.time))
 * - color: sortOrder 기반 팔레트 순환
 * - sortValue: 정렬용 (sortOrder*10000 + 시각 분 — sortOrder 우선, 동률 시 시각)
 */
interface MedSlotMeta {
  slotKey: string;
  label: string;
  color: string;
  sortValue: number;
}

export function useRecordDetailData(type: ItemKey, period: Period): UseRecordDetailDataReturn {
  const { user } = useAuth();
  const [summarySlot, setSummarySlot] = useState<SummarySlot | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeries | null>(null);
  const [timeSeriesMap, setTimeSeriesMap] = useState<TimeSeriesMap | null>(null);
  const [mealTimeSeriesMap, setMealTimeSeriesMap] = useState<TimeSeriesMap | null>(null);
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
      let doseSlots: DoseSlot[] = [];

      if (type === 'medication') {
        const { data } = await supabase
          .from('med_logs')
          .select('id, taken_at, meal_time, dose_slot_id')
          .eq('patient_id', patientId)
          .gte('taken_at', totalStart)
          .lte('taken_at', totalEnd);
        medLogs = data ?? [];
        // 표시/라벨 전용(비활성 포함) dose_slots(시각순, N개). 없으면 [] → legacy meal_time 폴백.
        // 삭제(soft delete)된 슬롯도 포함해 과거 기록이 '이전 복용' 으로 격하되지 않고
        // 원래 시간대 이름(label/time)으로 트렌드/현황에 표시되게 한다.
        // (이 hook 은 과거 기록 표시 전용 — 게이팅/스케줄 로직 없음.)
        doseSlots = await fetchPatientLabelDoseSlots(patientId);
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

      if (type === 'medication') {
        const currLogs = filterMed(medLogs, currRange.start, currRange.end);
        const prevLogs = filterMed(medLogs, prevRange.start, prevRange.end);

        const points: TrendPoint[] = ranges.map(r => ({
          value: medRate(filterMed(medLogs, r.start, r.end), r.start, r.end),
          label: r.label,
        }));

        // ── 시간대별: dose_slots(N개, 시각순) 기반 ──────────────────────────────
        // legacyKey(meal_time) → 정규 dose_slot id 매핑 (이관 환자 키 통일, 4단계 패턴).
        const legacyKeyToSlotId = new Map<string, string>();
        doseSlots.forEach((s) => {
          if (s.legacyKey && s.id) legacyKeyToSlotId.set(s.legacyKey, s.id);
        });

        // 로그 1건 → 정규 그룹 키.
        //   우선순위: log.dose_slot_id ?? legacyKey(meal_time)→slot.id ?? meal_time
        // 미이관 환자는 doseSlots 가 비어 매핑 실패 → meal_time 키 유지(legacy 정상).
        const logSlotKey = (log: MedLogRow): string | null =>
          log.dose_slot_id ??
          (log.meal_time ? legacyKeyToSlotId.get(log.meal_time) : undefined) ??
          log.meal_time ??
          null;

        // 로그별 정규 키를 1회만 계산해 이후 모든 순회에서 재사용(반복 logSlotKey 호출 제거).
        const logKeyCache: Array<string | null> = medLogs.map(logSlotKey);

        // 슬롯 메타 맵 (정규 키 → 라벨/색/정렬). 활성 dose_slots 로 먼저 구성.
        const slotMetaByKey = new Map<string, MedSlotMeta>();
        doseSlots.forEach((s) => {
          // 활성 슬롯의 정규 키: 실제 행이면 id, (이론상) id 없으면 legacyKey/시각.
          const key = s.id ?? s.legacyKey ?? s.time;
          if (!key || slotMetaByKey.has(key)) return;
          slotMetaByKey.set(key, {
            slotKey: key,
            // 설정/메인/시트와 동일한 slotTitle(이름+시각)로 통일 → "아침 오전 6:00", "밤 11:00".
            label: slotTitle(s.label, s.legacyKey, s.time),
            color: MEAL_COLOR_PALETTE[s.sortOrder % MEAL_COLOR_PALETTE.length],
            sortValue: s.sortOrder * 10000 + slotSortValue(s.time),
          });
        });

        // 데이터에 등장하나 활성 목록에 없는 슬롯(비활성/삭제된 과거 기록) — 합집합 보존.
        // 정규 키만 알고 메타가 없으므로, 같은 키의 임의 로그 1건으로 라벨을 복원한다.
        //   - dose_slot_id 로만 남은 경우: 라벨/시각 알 수 없음 → '이전 복용' 폴백.
        //   - legacy meal_time 으로 남은 경우: meal_time 자체가 키이자 표시 단서.
        const legacyMealLabel: Record<string, string> = isEnLocale()
          ? { morning: 'Morning medication', lunch: 'Lunch medication', dinner: 'Dinner medication', bedtime: 'Bedtime medication' }
          : { morning: '아침약', lunch: '점심약', dinner: '저녁약', bedtime: '취침약' };
        const legacyMealOrder: Record<string, number> = {
          morning: 0, lunch: 1, dinner: 2, bedtime: 3,
        };
        let extraSeq = doseSlots.length; // 합집합 슬롯 색/정렬 순번(활성 뒤에 이어붙임)
        for (let i = 0; i < medLogs.length; i++) {
          const log = medLogs[i];
          const key = logKeyCache[i];
          if (!key || slotMetaByKey.has(key)) continue;
          // 활성 목록에 없는 키 → 합집합 추가.
          const mealKey = log.meal_time ?? '';
          const isLegacyMeal = mealKey in legacyMealLabel;
          slotMetaByKey.set(key, {
            slotKey: key,
            label: isLegacyMeal ? legacyMealLabel[mealKey] : i18n.t('recordDetailHook.pastDoseFallback'),
            color: MEAL_COLOR_PALETTE[extraSeq % MEAL_COLOR_PALETTE.length],
            // legacy meal 은 표준 순서, 그 외(삭제된 커스텀 슬롯)는 맨 뒤.
            sortValue: isLegacyMeal
              ? legacyMealOrder[mealKey] * 10000
              : 9_000_000 + extraSeq,
          });
          extraSeq += 1;
        }

        // 슬롯키 × 구간 카운트를 1회 순회로 집계 (기존 countInRange 의 O(슬롯×구간×로그) 제거).
        // filterMed 와 동일한 inclusive 경계로 각 로그를 해당 구간(들)에 누적 → 출력 동일.
        const rangeCounts: Array<Map<string, number>> = ranges.map(() => new Map<string, number>());
        for (let i = 0; i < medLogs.length; i++) {
          const key = logKeyCache[i];
          if (!key) continue;
          const t = new Date(medLogs[i].taken_at);
          for (let ri = 0; ri < ranges.length; ri++) {
            const r = ranges[ri];
            if (t >= r.start && t <= r.end) {
              rangeCounts[ri].set(key, (rangeCounts[ri].get(key) ?? 0) + 1);
            }
          }
        }
        const currIdx = ranges.length - 1;
        const prevIdx = ranges.length >= 2 ? ranges.length - 2 : 0;
        const countInRangeIdx = (ri: number, slotKey: string) => rangeCounts[ri].get(slotKey) ?? 0;

        // 표시 대상: 조회 구간(전체 ranges) 내 실제 복용 데이터가 1건이라도 있는 슬롯만.
        // (기존 동작 보존 — 데이터 없는 슬롯은 현황/트렌드에 노출하지 않음.
        //  과거 합집합 슬롯도 데이터가 있어야 등장하므로 자연히 만족.)
        const slotsWithData = new Set<string>();
        for (const key of logKeyCache) {
          if (key) slotsWithData.add(key);
        }
        // 정렬된 슬롯 키 목록 (sortOrder→시각순). 데이터 있는 슬롯만.
        const sortedSlotMetas = Array.from(slotMetaByKey.values())
          .filter(m => slotsWithData.has(m.slotKey))
          .sort((a, b) => a.sortValue - b.sortValue);

        const mealTimeSlots: Record<string, { current: number; prev: number }> = {};
        for (const meta of sortedSlotMetas) {
          mealTimeSlots[meta.slotKey] = {
            current: countInRangeIdx(currIdx, meta.slotKey),
            prev: countInRangeIdx(prevIdx, meta.slotKey),
          };
        }

        const mealTSM: TimeSeriesMap = {};
        for (const meta of sortedSlotMetas) {
          const mealPoints = ranges.map((r, ri) => ({
            value: countInRangeIdx(ri, meta.slotKey),
            label: r.label,
          }));
          const maxVal = Math.max(...mealPoints.map(p => p.value), 1);
          mealTSM[meta.slotKey] = { points: mealPoints, unit: '회', max: maxVal, color: meta.color };
        }

        // 표시 라벨 맵(키→라벨)을 RecordDetailScreen 이 쓸 수 있게 summarySlot 에 동봉.
        const slotLabels: Record<string, string> = {};
        for (const meta of sortedSlotMetas) slotLabels[meta.slotKey] = meta.label;

        const hasSlots = sortedSlotMetas.length > 0;
        setSummarySlot({
          current: medRate(currLogs, currRange.start, currRange.end),
          prev: medRate(prevLogs, prevRange.start, prevRange.end),
          unit: '%',
          mealTimeSlots: hasSlots ? mealTimeSlots : undefined,
          mealSlotLabels: hasSlots ? slotLabels : undefined,
        });
        setTrendSeries({ points, unit: '%', max: 100, color: '#4CAF50' });
        setTimeSeriesMap(null);
        setMealTimeSeriesMap(hasSlots ? mealTSM : null);

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
        setMealTimeSeriesMap(null);

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
        setMealTimeSeriesMap(null);

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
        setMealTimeSeriesMap(null);

      } else {
        // bodyState 또는 mood: 시간대별
        const field: 'body_state' | 'mood' = type === 'bodyState' ? 'body_state' : 'mood';

        // 사용자가 설정한 med_notif_prefs 로드 → 설정된 인터벌 기준으로 슬롯 구성
        let configuredLabels: string[] = ['after_medication'];
        try {
          const { data: userPrefs } = await supabase
            .from('users')
            .select('med_notif_prefs')
            .eq('id', patientId)
            .single();
          const prefs = (userPrefs?.med_notif_prefs ?? []) as Array<{ minutes: number; enabled: boolean }>;
          const enabledLabels = prefs
            .filter(n => n.enabled && n.minutes > 0)
            .sort((a, b) => a.minutes - b.minutes)
            .map(n => `${n.minutes}min_after`);
          configuredLabels = ['after_medication', ...enabledLabels];
        } catch {}

        // 데이터에 있는 라벨도 추가 (설정 변경 전 기록 포함)
        // 분 수(parseLabelMinutes) 기준으로 중복 제거: 같은 분 수를 가진 라벨은 하나만 유지
        const allLabels = new Set<string>(configuredLabels);
        for (const log of onOffLogs) {
          if (log.triggered_by === 'notification' && log.trigger_time_label) {
            allLabels.add(log.trigger_time_label);
          }
        }
        // 분 수 기준 중복 제거: 같은 시간대를 나타내는 서로 다른 라벨 형식 통일
        const minutesMap = new Map<number, string>();
        for (const label of allLabels) {
          const mins = parseLabelMinutes(label);
          if (!minutesMap.has(mins)) {
            minutesMap.set(mins, label);
          }
        }
        const sortedLabels = Array.from(minutesMap.values()).sort(
          (a, b) => parseLabelMinutes(a) - parseLabelMinutes(b),
        );

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

        // 트렌드: 시간대별 시리즈 (동적 색상 팔레트)
        const tsmResult: TimeSeriesMap = {};
        sortedLabels.forEach((label, idx) => {
          const color = TRIGGER_COLORS[idx % TRIGGER_COLORS.length];
          const points: TrendPoint[] = ranges.map(r => {
            const avg = timeSlotAvg(filterOnOff(onOffLogs, r.start, r.end), field);
            return { value: avg[label] ?? 0, label: r.label };
          });
          tsmResult[label] = { points, unit: '점', max: 5, color };
        });
        setTimeSeriesMap(tsmResult);
        setMealTimeSeriesMap(null);
        setTrendSeries(null);
      }
    } catch (err: any) {
      console.error('[useRecordDetailData] 조회 오류:', err);
      setError(err.message ?? i18n.t('recordDetailHook.fetchError'));
    } finally {
      setLoading(false);
    }
  }, [user, type, period, getPatientId]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]);

  return { summarySlot, trendSeries, timeSeriesMap, mealTimeSeriesMap, loading, error, refresh: fetchData };
}
