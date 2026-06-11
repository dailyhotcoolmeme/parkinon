/**
 * useDoseSlots.ts
 * 복용 슬롯(dose_slots) 읽기 전용 훅 — 약 복용 모델 재설계 4단계 기반.
 *
 * - 환자 단위 dose_slots 를 fetch (is_active 만, sort_order → time 정렬)
 * - dose_slots 행이 있으면 그것으로, 없으면 호출처가 legacy(meal_schedules/meal_time)로 폴백
 * - 모든 읽기 화면이 "표시할 슬롯 리스트"를 얻는 단일 분기점(resolveDisplaySlots) 제공
 *
 * patientId 결정은 usePatientId 훅 재사용(보호자→연동환자 일관성).
 * RLS 로 본인 + 같은 그룹 보호자 read 허용됨.
 *
 * ⚠️ 읽기 전용. 쓰기(takeMedication 등)는 5단계에서 처리.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { usePatientId } from './usePatientId';
import {
  LEGACY_SLOT_ORDER,
  LEGACY_SLOT_META,
  LEGACY_KEY_TO_LABEL,
  labelToLegacyKey,
  normalizeHhmm,
  slotSortValue,
  type LegacyMealKey,
} from '../constants/doseSlots';
import type { Database } from '../types/database';

type DoseSlotRow = Database['public']['Tables']['dose_slots']['Row'];

/**
 * 화면에서 쓰는 슬롯 표현. dose_slots 행 기반이거나 legacy 가상 슬롯.
 * - id: dose_slots 행이면 실제 uuid, legacy 가상 슬롯이면 null
 * - legacyKey: 표준 4슬롯 매핑(label 역매핑) 또는 legacy 폴백 키. 없으면 null
 * - time: 'HH:MM'
 */
export interface DoseSlot {
  id: string | null;
  patientId: string | null;
  time: string;
  label: string | null;
  sortOrder: number;
  remindEnabled: boolean;
  remindSoundId: string | null;
  trackEnabled: boolean;
  trackIntervals: number[];
  trackSoundId: string | null;
  legacyKey: LegacyMealKey | null;
  /** dose_slots 테이블 행에서 온 슬롯인지(true) legacy 폴백 가상 슬롯인지(false) */
  isReal: boolean;
}

export interface UseDoseSlotsReturn {
  slots: DoseSlot[];
  /** dose_slots 행이 1개 이상 있으면 true → 폴백 분기의 단일 기준 */
  hasDoseSlots: boolean;
  loading: boolean;
  getSlotById: (id: string) => DoseSlot | undefined;
  getSlotByLegacyKey: (key: LegacyMealKey) => DoseSlot | undefined;
  refresh: () => Promise<void>;
}

// ─── DB Row → DoseSlot 변환 ───────────────────────────────────────────────────
function rowToDoseSlot(row: DoseSlotRow): DoseSlot {
  const time = normalizeHhmm(row.time);
  return {
    id: row.id,
    patientId: row.patient_id,
    time,
    label: row.label,
    sortOrder: row.sort_order,
    remindEnabled: row.remind_enabled,
    remindSoundId: row.remind_sound_id,
    trackEnabled: row.track_enabled,
    trackIntervals: row.track_intervals ?? [],
    trackSoundId: row.track_sound_id,
    legacyKey: labelToLegacyKey(row.label),
    isReal: true,
  };
}

function sortSlots(slots: DoseSlot[]): DoseSlot[] {
  // sort_order → time 으로 일원화 (4슬롯 가정 금지, N개 안전)
  return [...slots].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return slotSortValue(a.time) - slotSortValue(b.time);
  });
}

// ─── 모듈 레벨 가벼운 캐시 (patientId → slots) ────────────────────────────────
// 약 관리에서 변경 후 invalidate 가능하게 refresh + invalidateDoseSlotsCache 제공.
const slotsCache = new Map<string, DoseSlot[]>();

export function invalidateDoseSlotsCache(patientId?: string): void {
  if (patientId) slotsCache.delete(patientId);
  else slotsCache.clear();
}

async function fetchDoseSlots(patientId: string): Promise<DoseSlot[]> {
  const { data, error } = await supabase
    .from('dose_slots')
    .select('*')
    .eq('patient_id', patientId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('time', { ascending: true });

  if (error) {
    console.error('[useDoseSlots] fetch 오류:', error);
    throw error;
  }

  const slots = sortSlots((data ?? []).map(rowToDoseSlot));
  slotsCache.set(patientId, slots);
  return slots;
}

/**
 * 훅 바깥(async 함수 등 비-React 컨텍스트)에서 환자 dose_slots 를 읽는 진입점.
 * - 모듈 캐시를 재사용/갱신한다(훅과 동일 캐시).
 * - 오류 시 [] 반환 → 호출처는 resolveDisplaySlots 로 legacy 폴백.
 *
 * ⚠️ 읽기 전용. dose_slots 행이 없으면 [] → resolveDisplaySlots 가 legacy 생성.
 */
export async function fetchPatientDoseSlots(patientId: string): Promise<DoseSlot[]> {
  if (!patientId) return [];
  if (slotsCache.has(patientId)) return slotsCache.get(patientId)!;
  try {
    return await fetchDoseSlots(patientId);
  } catch {
    return [];
  }
}

export function useDoseSlots(): UseDoseSlotsReturn {
  const { patientId, loading: patientLoading } = usePatientId();
  const [slots, setSlots] = useState<DoseSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (useCache: boolean) => {
      if (patientLoading) return;
      if (!patientId) {
        if (mounted.current) {
          setSlots([]);
          setLoading(false);
        }
        return;
      }

      // 캐시 히트 → 즉시 반영(여전히 백그라운드 갱신은 안 함, refresh 로 무효화)
      if (useCache && slotsCache.has(patientId)) {
        if (mounted.current) {
          setSlots(slotsCache.get(patientId)!);
          setLoading(false);
        }
        return;
      }

      if (mounted.current) setLoading(true);
      try {
        const next = await fetchDoseSlots(patientId);
        if (mounted.current) setSlots(next);
      } catch {
        if (mounted.current) setSlots([]);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [patientId, patientLoading]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // 보호자↔환자 즉시 반영: 이 환자의 dose_slots 변경을 realtime 으로 감지해 갱신.
  // (보호자가 환자 dose_slots 를 수정하면 환자 기기가, 반대도 즉시 반영)
  useEffect(() => {
    if (!patientId) return;
    const channel = supabase
      .channel(`dose-slots-rt-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dose_slots', filter: `patient_id=eq.${patientId}` },
        () => {
          invalidateDoseSlotsCache(patientId);
          load(false);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [patientId, load]);

  const refresh = useCallback(async () => {
    if (patientId) invalidateDoseSlotsCache(patientId);
    await load(false);
  }, [patientId, load]);

  const getSlotById = useCallback(
    (id: string) => slots.find((s) => s.id === id),
    [slots]
  );

  const getSlotByLegacyKey = useCallback(
    (key: LegacyMealKey) => slots.find((s) => s.legacyKey === key),
    [slots]
  );

  return {
    slots,
    hasDoseSlots: slots.length > 0,
    loading: loading || patientLoading,
    getSlotById,
    getSlotByLegacyKey,
    refresh,
  };
}

// ─── 표시 슬롯 단일 분기점 ────────────────────────────────────────────────────

/** legacy meal_schedules(슬롯키→'HH:MM') 형태. users.meal_schedules 와 동일. */
export type LegacyMealSchedules = Partial<Record<LegacyMealKey, string>> | null | undefined;
/** legacy med_time_notif_prefs(슬롯키→on/off) 형태. */
export type LegacyNotifPrefs = Partial<Record<LegacyMealKey, boolean>> | null | undefined;

/**
 * legacy 데이터로부터 가상 DoseSlot 리스트 생성.
 * - meal_schedules 에 시각이 있으면 그 시각, 없으면 LEGACY_SLOT_META.defaultTime
 * - notifPrefs 에서 명시적으로 false 인 슬롯도 4슬롯 항상 표시(기존 앱 동작 보존).
 *   해당 슬롯은 remindEnabled=false 로만 표시하고 화면이 dim+"알림 없음" 처리.
 *   prefs 가 없으면 4슬롯 전부 알림 ON 으로 간주(기존 기본값과 동일).
 *   ⚠️ 회귀 수정: 이전엔 false 슬롯을 통째 제외해 홈 카드·모달에서 누락됐음.
 *   이관 환자(useDoseSlots 가 is_active 만 필터, remind_enabled 무시하고 전부 노출)와 동작 일치.
 */
function buildLegacySlots(
  mealSchedules: LegacyMealSchedules,
  notifPrefs: LegacyNotifPrefs
): DoseSlot[] {
  const sched = mealSchedules ?? {};
  const prefs = notifPrefs ?? null;

  const result: DoseSlot[] = [];
  LEGACY_SLOT_ORDER.forEach((key, idx) => {
    // 알림 OFF(prefs[key]===false) 슬롯도 항상 포함 — 제외하지 않는다.
    // remindEnabled=false 로만 표시되고 dim 처리는 화면이 담당.
    const meta = LEGACY_SLOT_META[key];
    const time = normalizeHhmm(sched[key]) || meta.defaultTime;
    result.push({
      id: null,
      patientId: null,
      time,
      label: meta.label,
      sortOrder: idx,
      remindEnabled: prefs ? prefs[key] !== false : true,
      remindSoundId: null,
      trackEnabled: key !== 'bedtime', // 기존: 취침약 자동 추적 제외
      trackIntervals: [],
      trackSoundId: null,
      legacyKey: key,
      isReal: false,
    });
  });
  return sortSlots(result);
}

/**
 * 모든 읽기 화면이 "표시할 슬롯 리스트"를 얻는 단일 분기점.
 * - doseSlots(useDoseSlots 의 slots) 가 1개 이상이면 그대로 사용
 * - 없으면 legacy(meal_schedules + notifPrefs)로 가상 슬롯 생성
 *
 * @param doseSlots useDoseSlots().slots
 * @param legacyMealSchedules users.meal_schedules 등 (슬롯키→'HH:MM')
 * @param legacyNotifPrefs users.med_time_notif_prefs 등 (슬롯키→on/off), 선택
 */
export function resolveDisplaySlots(
  doseSlots: DoseSlot[],
  legacyMealSchedules: LegacyMealSchedules,
  legacyNotifPrefs?: LegacyNotifPrefs
): DoseSlot[] {
  if (doseSlots && doseSlots.length > 0) return doseSlots;
  return buildLegacySlots(legacyMealSchedules, legacyNotifPrefs);
}

// ─── 쓰기 경로 공용 동기화 헬퍼 (5단계 dual-write) ───────────────────────────────
// 약 복용 모델 재설계 5단계: 신규(dose_slots/medication_dose_slots) 와 legacy 를
// 함께 기록하는 dual-write 의 신규 쪽을 담당하는 멱등 헬퍼.
//
// ⚠️ 설계 원칙
//  - DB 에 (patient_id, label) unique 제약이 없으므로 select-then-write 로 멱등성 확보.
//  - 실패해도 throw 하지 않는다 — legacy 쓰기는 호출처에서 이미 끝났으므로
//    신규 쪽 실패가 복용 기록/알림 흐름을 깨선 안 된다(전환기 안전). 콘솔 경고 후 계속.
//  - 다른 에이전트(약 관리/온보딩)가 import 해서 쓰는 공용 진입점.

/** track_intervals 기본값 — medNotifs(전역 약효추적 설정)에서 enabled 분 추출, 없으면 30/120. */
function defaultTrackIntervals(
  enabledMinutes?: number[] | null
): number[] {
  if (enabledMinutes && enabledMinutes.length > 0) {
    return [...new Set(enabledMinutes.filter((m) => m > 0))].sort((a, b) => a - b);
  }
  return [30, 120];
}

/**
 * 환자 dose_slots 를 legacy meal_schedules 기준으로 보장(upsert)한다.
 *
 * 멱등 키 = (patient_id, label). dose_slots 를 select 해 label 매칭 행이 있으면
 * time(+remind_enabled) 을 update, 없으면 insert.
 *  - label = LEGACY_KEY_TO_LABEL[key] ('아침/점심/저녁/취침')
 *  - time = mealSchedules[key] (정규화) || LEGACY_SLOT_META[key].defaultTime
 *  - sort_order = LEGACY_SLOT_ORDER 의 인덱스
 *  - remind_enabled = notifPrefs[key] !== false (명시 false 만 off)
 *  - track_enabled = key !== 'bedtime' (기존: 취침약 자동 추적 제외)
 *  - track_intervals = defaultTrackIntervals(notifMinutes)
 *
 * 신규 온보딩 환자(dose_slots 0개)면 4슬롯 전부 insert.
 *
 * @param patientId 대상 환자 id (보호자 경로면 연동 환자 id 를 정확히 전달)
 * @param mealSchedules users.meal_schedules (슬롯키→'HH:MM')
 * @param notifPrefs   users.med_time_notif_prefs (슬롯키→on/off), 선택
 * @param notifMinutes 전역 medNotifs enabled minutes (track_intervals 기본값용), 선택
 */
export async function ensurePatientDoseSlots(
  patientId: string,
  mealSchedules: LegacyMealSchedules,
  notifPrefs?: LegacyNotifPrefs,
  notifMinutes?: number[] | null
): Promise<void> {
  if (!patientId) return;
  try {
    const sched = mealSchedules ?? {};
    const prefs = notifPrefs ?? null;

    // 기존 슬롯 조회 (멱등 키 매칭용). is_active 무관 — 같은 label 행이 있으면 재사용.
    const { data: existing, error: selErr } = await supabase
      .from('dose_slots')
      .select('id, label')
      .eq('patient_id', patientId);

    if (selErr) {
      console.warn('[ensurePatientDoseSlots] select 실패(계속):', selErr);
      return;
    }

    const byLabel = new Map<string, string>(); // label → id
    (existing ?? []).forEach((r) => {
      if (r.label) byLabel.set(r.label.trim(), r.id);
    });

    const trackIntervals = defaultTrackIntervals(notifMinutes);

    for (let idx = 0; idx < LEGACY_SLOT_ORDER.length; idx++) {
      const key = LEGACY_SLOT_ORDER[idx];
      const label = LEGACY_KEY_TO_LABEL[key];
      const time = normalizeHhmm(sched[key]) || LEGACY_SLOT_META[key].defaultTime;
      const remindEnabled = prefs ? prefs[key] !== false : true;

      const existingId = byLabel.get(label);
      if (existingId) {
        // 멱등 update: time + remind_enabled 만 갱신(track 설정/소리는 6단계 세트카드 소관).
        const { error: updErr } = await supabase
          .from('dose_slots')
          .update({ time, remind_enabled: remindEnabled })
          .eq('id', existingId);
        if (updErr) console.warn(`[ensurePatientDoseSlots] update(${label}) 실패(계속):`, updErr);
      } else {
        // insert: 신규 온보딩/미이관 환자
        const { error: insErr } = await supabase
          .from('dose_slots')
          .insert({
            patient_id: patientId,
            time,
            label,
            sort_order: idx,
            remind_enabled: remindEnabled,
            remind_sound_id: null,
            track_enabled: key !== 'bedtime',
            track_intervals: trackIntervals,
            track_sound_id: null,
            is_active: true,
          } as any);
        if (insErr) console.warn(`[ensurePatientDoseSlots] insert(${label}) 실패(계속):`, insErr);
      }
    }

    // 캐시 무효화 — 직후 읽기 경로가 새 슬롯을 보게.
    invalidateDoseSlotsCache(patientId);
  } catch (e) {
    console.warn('[ensurePatientDoseSlots] 예외(계속):', e);
  }
}

/**
 * 약↔슬롯 M:N(medication_dose_slots) 을 legacy meal_times 기준으로 재배정한다.
 * delete-then-insert: 해당 약의 기존 매핑을 모두 지우고 meal_times 각 키를 슬롯 id 로 재삽입.
 *
 * ⚠️ 선행조건: ensurePatientDoseSlots 로 환자 dose_slots 가 먼저 보장돼 있어야 한다.
 *    (여기서는 label→dose_slot.id 매핑만 수행, 슬롯 생성은 하지 않음.)
 *
 * @param patientId  약 소유 환자 id
 * @param medicationId 대상 medications.id
 * @param mealTimes  medications.meal_times (legacy 슬롯 키 배열)
 */
export async function syncMedicationDoseSlots(
  patientId: string,
  medicationId: string,
  mealTimes: LegacyMealKey[]
): Promise<void> {
  if (!patientId || !medicationId) return;
  try {
    // 환자 슬롯 조회(캐시 우회 — 방금 ensure 했을 수 있으므로 신선한 매핑 필요).
    invalidateDoseSlotsCache(patientId);
    const slots = await fetchPatientDoseSlots(patientId);

    // label(legacyKey) → dose_slot.id 매핑.
    const keyToId = new Map<LegacyMealKey, string>();
    slots.forEach((s) => {
      if (s.legacyKey && s.id) keyToId.set(s.legacyKey, s.id);
    });

    // 기존 매핑 전체 삭제.
    const { error: delErr } = await supabase
      .from('medication_dose_slots')
      .delete()
      .eq('medication_id', medicationId);
    if (delErr) console.warn('[syncMedicationDoseSlots] delete 실패(계속):', delErr);

    // meal_times → 슬롯 id 재배정(중복/매핑실패 제거).
    const slotIds = [...new Set(
      mealTimes
        .map((k) => keyToId.get(k))
        .filter((id): id is string => !!id)
    )];

    if (slotIds.length > 0) {
      const rows = slotIds.map((dose_slot_id) => ({ medication_id: medicationId, dose_slot_id }));
      const { error: insErr } = await supabase
        .from('medication_dose_slots')
        .insert(rows as any);
      if (insErr) console.warn('[syncMedicationDoseSlots] insert 실패(계속):', insErr);
    }
  } catch (e) {
    console.warn('[syncMedicationDoseSlots] 예외(계속):', e);
  }
}
