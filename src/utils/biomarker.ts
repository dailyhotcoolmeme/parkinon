// 디지털 바이오마커 MVP-A Phase 1 — 측정 INSERT · baseline 갱신/조회 유틸
// 참고: docs/digital_biomarker_mvpA_spec.md §6 (baseline), §8 (데이터 모델)
//
// 본 유틸은 측정 row + feature row를 한 트랜잭션처럼 순차 INSERT하고
// 각 feature의 본인 baseline_stats를 Welford 점진식으로 cumulative 갱신한다.
// (Phase 1 — cumulative. 30일 sliding window 재계산은 Phase 3에서 분리)

import { supabase } from '../lib/supabase';
import type {
  MeasurementType,
  MeasurementMedPhase,
  Database,
  Json,
} from '../types/database';

/** 본인 baseline 학습 기간 컷오프 (n) — 14회 측정 누적 시 화면 비교 활성 (§6.1) */
export const BASELINE_LEARNING_MIN_N = 14;

/** 측정 feature 1건 — value_numeric은 baseline 산정 대상, value_jsonb는 raw 보존 */
export interface MeasurementFeatureInput {
  feature_key: string;
  value_numeric?: number | null;
  value_jsonb?: Record<string, unknown> | unknown[] | null;
}

export interface RecordMeasurementInput {
  type: MeasurementType;
  features: MeasurementFeatureInput[];
  medPhase: MeasurementMedPhase;
  medIntakeId?: string | null;
  context?: Record<string, unknown>;
  /** 측정 시작·종료 시각(미지정 시 시작=now, 종료=null) */
  startedAt?: string;
  endedAt?: string;
}

export interface BaselineStats {
  mean: number;
  sd: number;
  n: number;
}

export type MeasurementRow = Database['public']['Tables']['measurements']['Row'];

// ────────────────────────────────────────────────────────────────────────────
// 내부 유틸
// ────────────────────────────────────────────────────────────────────────────

async function getAuthUserIdOrThrow(): Promise<string> {
  const { data: sessionData, error } = await supabase.auth.getSession();
  if (error) throw new Error(`[biomarker] 세션 조회 실패: ${error.message}`);
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new Error('[biomarker] 로그인 세션 없음');
  return uid;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. recordMeasurement — measurements + measurement_features 저장
// ────────────────────────────────────────────────────────────────────────────

/**
 * 측정 1건과 그에 속한 feature들을 저장하고, value_numeric이 있는 feature에 대해
 * 본인 baseline_stats를 Welford 점진식으로 갱신한다.
 *
 * @returns 새로 생성된 measurement_id
 */
export async function recordMeasurement(
  input: RecordMeasurementInput
): Promise<string> {
  const userId = await getAuthUserIdOrThrow();

  // measurements INSERT
  const { data: measurement, error: mErr } = await supabase
    .from('measurements')
    .insert({
      user_id: userId,
      type: input.type,
      med_phase: input.medPhase,
      med_intake_id: input.medIntakeId ?? null,
      context: (input.context ?? {}) as unknown as Json,
      started_at: input.startedAt ?? new Date().toISOString(),
      ended_at: input.endedAt ?? null,
    })
    .select('id')
    .single();

  if (mErr || !measurement) {
    throw new Error(`[biomarker] measurement INSERT 실패: ${mErr?.message ?? 'unknown'}`);
  }

  const measurementId = measurement.id;

  // measurement_features INSERT (개수가 적으므로 한 번에 배치)
  if (input.features.length > 0) {
    const rows = input.features.map((f) => ({
      measurement_id: measurementId,
      feature_key: f.feature_key,
      value_numeric: f.value_numeric ?? null,
      value_jsonb: (f.value_jsonb ?? null) as unknown as Json,
    }));

    const { error: fErr } = await supabase.from('measurement_features').insert(rows);
    if (fErr) {
      // measurement은 남기되 feature 저장 실패는 보고
      throw new Error(`[biomarker] measurement_features INSERT 실패: ${fErr.message}`);
    }

    // baseline 점진 갱신 (value_numeric이 유한수일 때만)
    for (const f of input.features) {
      if (
        f.value_numeric !== null &&
        f.value_numeric !== undefined &&
        Number.isFinite(f.value_numeric)
      ) {
        try {
          await updateBaseline(userId, f.feature_key, f.value_numeric);
        } catch (e) {
          // baseline 갱신 실패는 측정 자체를 무효화하지 않음 — 로그만 남기고 계속
          console.warn(
            `[biomarker] baseline 갱신 실패 (feature=${f.feature_key}):`,
            e
          );
        }
      }
    }
  }

  // Phase 5A — 환자 본인 측정 완료 시 보호자에게 푸시 발송 (cross-user)
  // 참고: docs/digital_biomarker_mvpA_spec.md §5.1, §7.4
  // - 신규 Edge Function notify-measurement-completed 호출.
  // - 보호자가 측정한 케이스는 없음(스펙 §5.3: 보호자 대리 측정 금지)이지만
  //   안전을 위해 발송 자체는 함수 측에서 그룹·토글 기준으로 판단.
  // - 발송 실패는 측정 성공 자체를 무효화하지 않음(console.warn만).
  try {
    await supabase.functions.invoke('notify-measurement-completed', {
      body: { measurement_id: measurementId },
    });
  } catch (e) {
    console.warn('[biomarker] 보호자 측정 알림 발송 실패(측정은 저장됨):', e);
  }

  return measurementId;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. updateBaseline — Welford 점진식 cumulative 갱신
// ────────────────────────────────────────────────────────────────────────────

/**
 * 본인·feature_key 1쌍에 대해 새 값 1개로 baseline (mean, sd, n)을 점진 갱신.
 * Welford online algorithm:
 *   n' = n + 1
 *   delta  = x - mean
 *   mean'  = mean + delta / n'
 *   M2'    = M2 + delta * (x - mean')         (sample variance용 sum-of-squares)
 *   sd'    = sqrt(M2' / (n' - 1))              (n' >= 2)
 *
 * 기존 row에 M2가 없으므로 sd^2 * (n - 1)로 역산해 M2를 복원한다.
 * upsert로 첫 측정에서도 row를 생성한다.
 *
 * NOTE (Phase 1 한계): 30일 sliding window가 아닌 cumulative 갱신이다.
 * Phase 3에서 30일 윈도우로 재계산하는 전용 함수(Edge Function 권장)로 교체 예정.
 */
export async function updateBaseline(
  userId: string,
  featureKey: string,
  newValue: number
): Promise<void> {
  if (!Number.isFinite(newValue)) {
    throw new Error(`[biomarker] updateBaseline: newValue가 유한수 아님 (${newValue})`);
  }

  // 기존 baseline 조회
  const { data: existing, error: selErr } = await supabase
    .from('baseline_stats')
    .select('mean, sd, n')
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (selErr) {
    throw new Error(`[biomarker] baseline 조회 실패: ${selErr.message}`);
  }

  let mean = 0;
  let m2 = 0;
  let n = 0;

  if (existing) {
    mean = Number(existing.mean) || 0;
    n = Number(existing.n) || 0;
    const sd = Number(existing.sd) || 0;
    // 기존 sd로 M2 역산 (n >= 2일 때만 의미 있음; n<2면 M2=0)
    m2 = n >= 2 ? sd * sd * (n - 1) : 0;
  }

  // Welford 갱신
  const nNew = n + 1;
  const delta = newValue - mean;
  const meanNew = mean + delta / nNew;
  const m2New = m2 + delta * (newValue - meanNew);
  const sdNew = nNew >= 2 ? Math.sqrt(m2New / (nNew - 1)) : 0;

  const { error: upErr } = await supabase.from('baseline_stats').upsert(
    {
      user_id: userId,
      feature_key: featureKey,
      mean: meanNew,
      sd: sdNew,
      n: nNew,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,feature_key' }
  );

  if (upErr) {
    throw new Error(`[biomarker] baseline upsert 실패: ${upErr.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 3. getBaseline — 본인·feature_key의 baseline 조회
// ────────────────────────────────────────────────────────────────────────────

export async function getBaseline(
  userId: string,
  featureKey: string
): Promise<BaselineStats | null> {
  const { data, error } = await supabase
    .from('baseline_stats')
    .select('mean, sd, n')
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (error) {
    throw new Error(`[biomarker] getBaseline 실패: ${error.message}`);
  }
  if (!data) return null;

  return {
    mean: Number(data.mean) || 0,
    sd: Number(data.sd) || 0,
    n: Number(data.n) || 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. getMeasurements — 최근 측정 조회
// ────────────────────────────────────────────────────────────────────────────

export interface GetMeasurementsOptions {
  type?: MeasurementType;
  limit?: number;
  /** 최근 N일치만 조회. 지정 시 started_at >= now() - sinceDays */
  sinceDays?: number;
}

export async function getMeasurements(
  userId: string,
  options: GetMeasurementsOptions = {}
): Promise<MeasurementRow[]> {
  let q = supabase
    .from('measurements')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('started_at', { ascending: false });

  if (options.type) {
    q = q.eq('type', options.type);
  }
  if (options.sinceDays && options.sinceDays > 0) {
    const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000);
    q = q.gte('started_at', since.toISOString());
  }
  if (options.limit && options.limit > 0) {
    q = q.limit(options.limit);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`[biomarker] getMeasurements 실패: ${error.message}`);
  }
  return data ?? [];
}

// ────────────────────────────────────────────────────────────────────────────
// 5. isBaselineReady — 14일 학습 기간 가드 (§6.1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * baseline_stats.n >= BASELINE_LEARNING_MIN_N (14)이면 true.
 * 화면에서 "본인 평균 비교" UI를 활성화해도 되는지 판단할 때 사용.
 */
export async function isBaselineReady(
  userId: string,
  featureKey: string
): Promise<boolean> {
  const stats = await getBaseline(userId, featureKey);
  if (!stats) return false;
  return stats.n >= BASELINE_LEARNING_MIN_N;
}

// ────────────────────────────────────────────────────────────────────────────
// 6. getDailyTrend — 30일 일별 평균 시계열 (Phase 3, §6.5 추세 그래프 데이터)
// ────────────────────────────────────────────────────────────────────────────

export interface DailyTrendPoint {
  /** YYYY-MM-DD (local date) */
  date: string;
  /** 해당 일자의 feature value 평균. 측정 없으면 null. */
  value: number | null;
}

/**
 * 일별 집계 모드.
 * - 'mean': 그 날 측정들의 평균(기본, 기존 동작)
 * - 'best': 그 날 "가장 좋은" 값.
 *           featureKey가 'rt_mean_ms'(반응속도 평균 반응시간)면 min(짧을수록 좋음),
 *           그 외(예: tap_count)는 max(클수록 좋음).
 */
export type DailyTrendMode = 'mean' | 'best';

/**
 * 시점 필터 — 측정 기록 화면 시점 구조화용.
 * - 'all'(기본): 모든 med_phase 포함(기존 동작 호환)
 * - '30m'/'2h'/'self_initiated': 해당 med_phase만
 */
export type MedPhaseFilter = 'all' | MeasurementMedPhase;

/**
 * 최근 N일(기본 30) 동안의 일별 feature value 시계열을 반환한다.
 * - mode='mean'(기본): 측정이 여러 번 있는 날은 평균.
 * - mode='best': 그 날 가장 좋은 측정값. featureKey='rt_mean_ms'면 min, 그 외 max.
 * - 측정 없는 날은 value=null.
 * - date 순 오름차순(과거 → 오늘).
 * - medPhase 지정 시 해당 시점 측정만 집계('all'은 전체).
 *
 * 사용 예: 결과 화면 추세 그래프(§4.4·§9.5), 측정 기록 화면(§6.5).
 * 학습 기간 가드(14일)는 호출 측에서 isBaselineReady 별도 체크.
 *
 * 호환성: 기존 호출(mode/medPhase 미지정)은 mean·all로 동작 유지.
 */
export async function getDailyTrend(
  userId: string,
  type: MeasurementType,
  featureKey: string,
  days = 30,
  mode: DailyTrendMode = 'mean',
  medPhase: MedPhaseFilter = 'all'
): Promise<DailyTrendPoint[]> {
  // 최근 days 일치 measurement_features 조회 (조인)
  // measurement 자체에서 started_at, type, deleted_at 필터.
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let q = supabase
    .from('measurement_features')
    .select(
      'value_numeric, measurement:measurements!inner(user_id, type, med_phase, started_at, deleted_at)'
    )
    .eq('feature_key', featureKey)
    .eq('measurement.user_id', userId)
    .eq('measurement.type', type)
    .is('measurement.deleted_at', null)
    .gte('measurement.started_at', since.toISOString());
  if (medPhase !== 'all') {
    q = q.eq('measurement.med_phase', medPhase);
  }
  const { data, error } = await q;

  if (error) {
    throw new Error(`[biomarker] getDailyTrend 실패: ${error.message}`);
  }

  // 'best' 모드 판정: 짧을수록 좋은 지표인지(rt_mean_ms 등) 판단
  // — featureKey 단위로 자동 분기. 추후 지표 추가 시 lowerIsBetterKeys에 추가.
  const lowerIsBetterKeys = new Set<string>(['rt_mean_ms']);
  const lowerIsBetter = lowerIsBetterKeys.has(featureKey);

  // 일자별 누적
  // - mean 모드: { sum, n }
  // - best 모드: { best } (lowerIsBetter면 min, 아니면 max)
  const buckets = new Map<string, { sum: number; n: number; best: number | null }>();

  for (const row of data ?? []) {
    const v = row?.value_numeric;
    // supabase-js의 inner join 결과: measurement는 객체 또는 배열일 수 있음 (PostgREST 단일 FK는 객체)
    const m: any = (row as any)?.measurement;
    const startedAt: string | undefined = Array.isArray(m)
      ? m[0]?.started_at
      : m?.started_at;
    if (!startedAt) continue;
    if (v === null || v === undefined || !Number.isFinite(Number(v))) continue;

    const num = Number(v);
    const dateKey = toLocalDateKey(new Date(startedAt));
    const cur = buckets.get(dateKey) ?? { sum: 0, n: 0, best: null };
    cur.sum += num;
    cur.n += 1;
    if (cur.best === null) {
      cur.best = num;
    } else if (lowerIsBetter) {
      if (num < cur.best) cur.best = num;
    } else {
      if (num > cur.best) cur.best = num;
    }
    buckets.set(dateKey, cur);
  }

  // days 만큼의 연속 날짜(과거 → 오늘) 구성
  const result: DailyTrendPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = toLocalDateKey(d);
    const b = buckets.get(key);
    let value: number | null = null;
    if (b && b.n > 0) {
      value = mode === 'best' ? b.best : b.sum / b.n;
    }
    result.push({ date: key, value });
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// 11. getMeasurementsWithFeature — 개별 측정 리스트(측정시각 + 핵심 feature값)
// ────────────────────────────────────────────────────────────────────────────

export interface MeasurementWithFeatureRow {
  measurement_id: string;
  /** 측정 시작 시각(ISO) */
  started_at: string;
  /** 해당 featureKey의 value_numeric. 없거나 유한수 아니면 null */
  value: number | null;
  /** 측정 시점 (약효 30분 후/2시간 후/자율 측정 등) */
  med_phase: MeasurementMedPhase;
}

/**
 * 본인 측정 중 특정 type + featureKey가 매칭되는 행을 최신순으로 반환.
 * 측정 기록 화면(개별 리스트)용. 기본 30건.
 *
 * 정렬: started_at DESC (최신 → 과거)
 * deleted_at IS NULL 만 포함.
 * medPhase 지정 시 해당 시점만('all'은 전체, 기본 'all' — 기존 호출 호환).
 */
export async function getMeasurementsWithFeature(
  userId: string,
  type: MeasurementType,
  featureKey: string,
  limit = 30,
  medPhase: MedPhaseFilter = 'all'
): Promise<MeasurementWithFeatureRow[]> {
  let q = supabase
    .from('measurement_features')
    .select(
      'value_numeric, measurement_id, measurement:measurements!inner(id, user_id, type, med_phase, started_at, deleted_at)'
    )
    .eq('feature_key', featureKey)
    .eq('measurement.user_id', userId)
    .eq('measurement.type', type)
    .is('measurement.deleted_at', null)
    .order('started_at', { ascending: false, foreignTable: 'measurement' })
    .limit(limit);
  if (medPhase !== 'all') {
    q = q.eq('measurement.med_phase', medPhase);
  }
  const { data, error } = await q;

  if (error) {
    throw new Error(`[biomarker] getMeasurementsWithFeature 실패: ${error.message}`);
  }

  const rows: MeasurementWithFeatureRow[] = [];
  for (const r of data ?? []) {
    const m: any = (r as any)?.measurement;
    const startedAt: string | undefined = Array.isArray(m) ? m[0]?.started_at : m?.started_at;
    const mid: string | undefined = (r as any)?.measurement_id
      ?? (Array.isArray(m) ? m[0]?.id : m?.id);
    if (!startedAt || !mid) continue;
    const v = (r as any)?.value_numeric;
    const num = v === null || v === undefined ? null : Number(v);
    const phase: MeasurementMedPhase =
      (Array.isArray(m) ? m[0]?.med_phase : m?.med_phase) ?? 'self_initiated';
    rows.push({
      measurement_id: mid,
      started_at: startedAt,
      value: num !== null && Number.isFinite(num) ? num : null,
      med_phase: phase,
    });
  }

  // PostgREST의 foreignTable 정렬이 환경에 따라 적용되지 않을 수도 있어 클라이언트 측에서도 정렬 보장
  rows.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));

  return rows.slice(0, limit);
}

/** 로컬 시간대 기준 YYYY-MM-DD */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 7. recomputeBaselineFromWindow — 최근 N일 데이터로 baseline 재계산 (Phase 3)
// ────────────────────────────────────────────────────────────────────────────

/**
 * 최근 N일(기본 30)의 모든 측정 feature value로 mean/sd/n을 새로 계산해
 * baseline_stats를 upsert한다. cumulative Welford(Phase 1) 대체용 sliding window.
 *
 * - 표본 0이면 upsert 하지 않고 조용히 종료(기존 row 유지).
 * - sd는 표본 표준편차(n>=2일 때만, 그 외 0).
 * - 화면 진입 시점에 호출 → 항상 최신 30일 윈도우 baseline 반영.
 */
export async function recomputeBaselineFromWindow(
  userId: string,
  featureKey: string,
  days = 30
): Promise<void> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('measurement_features')
    .select(
      'value_numeric, measurement:measurements!inner(user_id, started_at, deleted_at)'
    )
    .eq('feature_key', featureKey)
    .eq('measurement.user_id', userId)
    .is('measurement.deleted_at', null)
    .gte('measurement.started_at', since.toISOString());

  if (error) {
    throw new Error(`[biomarker] recomputeBaselineFromWindow 조회 실패: ${error.message}`);
  }

  const values: number[] = [];
  for (const row of data ?? []) {
    const v = row?.value_numeric;
    if (v === null || v === undefined) continue;
    const num = Number(v);
    if (!Number.isFinite(num)) continue;
    values.push(num);
  }

  if (values.length === 0) {
    // 윈도우 내 표본 없음 — 기존 baseline 유지(자동 reset 금지 정책)
    return;
  }

  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let sd = 0;
  if (n >= 2) {
    const variance =
      values.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / (n - 1);
    sd = Math.sqrt(variance);
  }

  const { error: upErr } = await supabase.from('baseline_stats').upsert(
    {
      user_id: userId,
      feature_key: featureKey,
      mean,
      sd,
      n,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,feature_key' }
  );

  if (upErr) {
    throw new Error(`[biomarker] recomputeBaselineFromWindow upsert 실패: ${upErr.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 8. getMeasurementById — 단일 측정 row + feature 조회 (Phase 3 결과 화면)
// ────────────────────────────────────────────────────────────────────────────

export interface MeasurementWithFeatures {
  measurement: MeasurementRow;
  features: Record<string, number | null>;
}

/**
 * 결과 화면이 받는 measurementId 1건을 measurement row + feature_key→value_numeric
 * 맵으로 묶어 반환.
 */
export async function getMeasurementById(
  measurementId: string
): Promise<MeasurementWithFeatures | null> {
  // measurementId 가 이미 있어 두 조회가 서로 독립이므로 병렬 실행(로딩 워터폴 제거).
  const [mResult, fResult] = await Promise.all([
    supabase
      .from('measurements')
      .select('*')
      .eq('id', measurementId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('measurement_features')
      .select('feature_key, value_numeric')
      .eq('measurement_id', measurementId),
  ]);

  const { data: mRow, error: mErr } = mResult;
  if (mErr) {
    throw new Error(`[biomarker] getMeasurementById measurement 실패: ${mErr.message}`);
  }
  if (!mRow) return null;

  const { data: fRows, error: fErr } = fResult;
  if (fErr) {
    throw new Error(`[biomarker] getMeasurementById features 실패: ${fErr.message}`);
  }

  const features: Record<string, number | null> = {};
  for (const r of fRows ?? []) {
    features[r.feature_key] =
      r.value_numeric === null || r.value_numeric === undefined
        ? null
        : Number(r.value_numeric);
  }

  return { measurement: mRow as MeasurementRow, features };
}

// ────────────────────────────────────────────────────────────────────────────
// 9. resetAllBaselinesForUser — 약 변경 시 baseline reset (Phase 3, §6.2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * 본인의 모든 baseline_stats row를 삭제한다. 약 변경 reset(비강제 사용자 선택) 전용.
 * 자동 호출 금지 — 다이얼로그에서 사용자가 "새 기준으로 시작" 선택 시에만.
 */
export async function resetAllBaselinesForUser(userId: string): Promise<void> {
  const { error } = await supabase
    .from('baseline_stats')
    .delete()
    .eq('user_id', userId);
  if (error) {
    throw new Error(`[biomarker] resetAllBaselinesForUser 실패: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 10. getLatestMeasurementId — 자율 진입점(메뉴 "최근 결과 보기") 보조
// ────────────────────────────────────────────────────────────────────────────

export async function getLatestMeasurementId(
  userId: string,
  type?: 'tap' | 'reaction',
): Promise<string | null> {
  let q = supabase
    .from('measurements')
    .select('id')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (type) {
    q = q.eq('type', type);
  }
  const { data, error } = await q
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`[biomarker] getLatestMeasurementId 실패: ${error.message}`);
  }
  return data?.id ?? null;
}
