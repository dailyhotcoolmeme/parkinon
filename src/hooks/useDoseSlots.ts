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
import type { AlarmMode } from '../constants/presetAlarmSounds';
import { usePatientId } from './usePatientId';
import {
  LEGACY_SLOT_ORDER,
  LEGACY_SLOT_META,
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
  /** 복약 알림 방식: basic|sound30|alarm (알림마다 개별) */
  remindAlarmMode: AlarmMode;
  trackEnabled: boolean;
  trackIntervals: number[];
  trackSoundId: string | null;
  /** 약효추적 알림 방식: basic|sound30|alarm */
  trackAlarmMode: AlarmMode;
  legacyKey: LegacyMealKey | null;
  /** dose_slots 테이블 행에서 온 슬롯인지(true) legacy 폴백 가상 슬롯인지(false) */
  isReal: boolean;
}

export interface UseDoseSlotsReturn {
  slots: DoseSlot[];
  /** dose_slots 행이 1개 이상 있으면 true → 폴백 분기의 단일 기준 */
  hasDoseSlots: boolean;
  /** 슬롯 조회가 실패해 slots 가 비었는지(=판정 불가). 게이팅이 통과 처리하는 신호. */
  slotsError: boolean;
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
    remindAlarmMode: ((row as any).remind_alarm_mode ?? 'basic') as AlarmMode,
    trackEnabled: row.track_enabled,
    trackIntervals: row.track_intervals ?? [],
    trackSoundId: row.track_sound_id,
    trackAlarmMode: ((row as any).track_alarm_mode ?? 'basic') as AlarmMode,
    // 언어 무관 키가 단일 진실(2026-07-29 i18n 구조 변경).
    legacyKey: ((row as any).legacy_key as LegacyMealKey | null),
    isReal: true,
  };
}

function sortSlots(slots: DoseSlot[]): DoseSlot[] {
  // 시각(time) 오름차순 우선 정렬 — 추가한 슬롯이 sort_order(=max+1)로 항상 맨 뒤에
  // 붙던 문제 수정. 이제 저장 순서와 무관하게 "이른 시각이 위"로 표시된다.
  // (동일 시각이면 sort_order 로 안정 정렬.) 표준 4슬롯도 08<12<18<22 라 순서 유지됨.
  return [...slots].sort((a, b) => {
    const ta = slotSortValue(a.time);
    const tb = slotSortValue(b.time);
    if (ta !== tb) return ta - tb;
    return a.sortOrder - b.sortOrder;
  });
}

// ─── 모듈 레벨 가벼운 캐시 (patientId → slots) ────────────────────────────────
// 약 관리에서 변경 후 invalidate 가능하게 refresh + invalidateDoseSlotsCache 제공.
const slotsCache = new Map<string, DoseSlot[]>();
// 표시/라벨 전용 캐시 — 비활성(soft delete) 슬롯까지 포함한 결과를 별도로 보관.
// 활성 전용 slotsCache 와 절대 섞지 않는다(게이팅/스케줄에 삭제 슬롯이 새지 않게).
const labelSlotsCache = new Map<string, DoseSlot[]>();

export function invalidateDoseSlotsCache(patientId?: string): void {
  if (patientId) {
    slotsCache.delete(patientId);
    labelSlotsCache.delete(patientId);
  } else {
    slotsCache.clear();
    labelSlotsCache.clear();
  }
}

async function fetchDoseSlots(patientId: string): Promise<DoseSlot[]> {
  const { data, error } = await supabase
    .from('dose_slots')
    .select('*')
    .eq('patient_id', patientId)
    .eq('is_active', true)
    .order('time', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[useDoseSlots] fetch error:', error);
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

// ─── 표시/라벨 전용 슬롯 조회 (비활성 포함) ───────────────────────────────────
// "기록은 남기기"로 soft delete 된 슬롯의 label/time 도 함께 읽어, 과거 기록이
// 자기 슬롯의 원래 시간대 이름으로 계속 렌더되게 한다(라벨 보존).
//
// ⚠️ 라벨 해석(과거 기록 리스트/트렌드)에만 쓸 것.
//    쓰기/판정/스케줄/오늘 현황 카드/게이팅(getLastActiveSlotId 등)에는 절대 쓰지 말 것 —
//    삭제된 슬롯이 설정/오늘카드/알림에 되살아난다. 그 경로는 fetchPatientDoseSlots(활성 전용).
//
// trade-off: soft delete 된 슬롯의 현재 label/time 을 사용하므로, 나중에 슬롯 시각을
//    수정하면 그 슬롯의 과거 기록도 새 시각 라벨로 보일 수 있다(알려진 절충).
async function fetchLabelDoseSlots(patientId: string): Promise<DoseSlot[]> {
  const { data, error } = await supabase
    .from('dose_slots')
    .select('*')
    .eq('patient_id', patientId)
    // is_active 필터 없음 — 비활성(삭제) 슬롯도 라벨 복원용으로 포함.
    .order('time', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[useDoseSlots] label fetch error:', error);
    throw error;
  }

  const slots = sortSlots((data ?? []).map(rowToDoseSlot));
  labelSlotsCache.set(patientId, slots);
  return slots;
}

/**
 * 훅 바깥에서 "표시/라벨용"(비활성 포함) 환자 dose_slots 를 읽는 진입점.
 * - 별도 캐시(labelSlotsCache) 사용. invalidateDoseSlotsCache 가 함께 무효화한다.
 * - 오류 시 [] 반환 → 호출처는 resolveDisplaySlots 로 legacy 폴백.
 *
 * ⚠️ 라벨 해석 전용. 활성 전용 로직에는 fetchPatientDoseSlots 를 쓸 것.
 */
export async function fetchPatientLabelDoseSlots(patientId: string): Promise<DoseSlot[]> {
  if (!patientId) return [];
  if (labelSlotsCache.has(patientId)) return labelSlotsCache.get(patientId)!;
  try {
    return await fetchLabelDoseSlots(patientId);
  } catch {
    return [];
  }
}

/**
 * "등록 완료(setupComplete)" 판정 — 그 환자/그룹에 활성(is_active) dose_slot 이
 * 1개 이상이면 true. 약 유무는 무관(스펙 §38: 시간대만으로 게이트 해제).
 *
 * 훅 바깥(async)에서 쓰는 진입점. 모듈 캐시를 재사용/갱신한다.
 * 오류 시 false 반환(보수적 — 등록 안 된 것으로 간주). 게이팅(B차)에서 import.
 *
 * @param patientId 대상 환자 id (보호자면 연동 환자 id 를 정확히 전달)
 */
export async function fetchPatientSetupComplete(patientId: string): Promise<boolean> {
  if (!patientId) return false;
  try {
    const slots = await fetchPatientDoseSlots(patientId);
    return slots.length > 0;
  } catch {
    return false;
  }
}

/**
 * 등록 완료(setupComplete) 상태 훅 — 게이팅(B차)에서 "기록 차단 해제" 여부 판단용.
 * - setupComplete: 활성 dose_slot 1개 이상이면 true.
 * - usePatientId 로 보호자→연동 환자 일관성 유지(그룹 단위 판정).
 * - dose_slots realtime 으로 슬롯 추가/삭제 즉시 반영.
 *
 * ⚠️ 이번 차수(B 이전)에는 차단 적용 안 함 — 헬퍼/훅만 export. 차단은 B차.
 */
export function useSetupComplete(): {
  setupComplete: boolean;
  /** 아직 판정 불가(로딩 중이거나 슬롯 조회 실패). 게이팅은 이때 막지 말고 통과시킨다. */
  setupUnknown: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { slots, hasDoseSlots, slotsError, loading, refresh } = useDoseSlots();
  const setupComplete = hasDoseSlots || slots.length > 0;
  // 로딩 중이거나 조회 실패면 "확정 0" 이 아니므로 판정 불가 → 게이팅 통과.
  const setupUnknown = loading || slotsError;
  return { setupComplete, setupUnknown, loading, refresh };
}

export function useDoseSlots(): UseDoseSlotsReturn {
  const { patientId, loading: patientLoading } = usePatientId();
  const [slots, setSlots] = useState<DoseSlot[]>([]);
  const [loading, setLoading] = useState(true);
  // 슬롯 조회가 실패해 slots 가 비었는지(=판정 불가) vs 정말 0개인지 구분용.
  // 게이팅(B차)이 "조회 실패는 통과, 확정 0 만 차단" 하도록 한다(오차단 방지).
  const [slotsError, setSlotsError] = useState(false);
  const mounted = useRef(true);
  // realtime 채널 이름은 훅 인스턴스마다 고유해야 한다. (여러 화면이 같은 환자의
  // useDoseSlots 를 동시에 쓰면 같은 이름의 채널을 재사용 → subscribe 후 .on() 추가
  // 시도로 크래시) 인스턴스별 고유 suffix 로 충돌 방지.
  const rtChannelId = useRef(Math.random().toString(36).slice(2, 10));

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
        if (mounted.current) {
          setSlots(next);
          setSlotsError(false); // 조회 성공 → 빈 배열이면 "확정 0"
        }
      } catch {
        if (mounted.current) {
          setSlots([]);
          setSlotsError(true); // 조회 실패 → "판정 불가"(게이트 통과시킴)
        }
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
      .channel(`dose-slots-rt-${patientId}-${rtChannelId.current}`)
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
    slotsError,
    loading: loading || patientLoading,
    getSlotById,
    getSlotByLegacyKey,
    refresh,
  };
}

/**
 * 그날 활성 슬롯 중 시간이 가장 늦은(마지막) 슬롯의 id 를 반환.
 *
 * 변비(constipation) 게이팅 전용 — "마지막 복용 슬롯의 기록일 때만 변비를 묻는다".
 * - 시간(HH:MM) 최댓값 기준, 동률이면 sortOrder 큰 것.
 * - 파싱 불가/빈 time 슬롯은 정렬에서 제외(Infinity 로 맨 뒤 가지 않도록).
 * - id 가 null 인 legacy 가상 슬롯은 식별 불가하므로 제외(legacy 경로는 meal_time 게이팅 사용).
 *
 * @param slots resolveDisplaySlots / useDoseSlots().slots 결과
 * @returns 마지막 활성 실제 슬롯의 id, 없으면 null
 */
export function getLastActiveSlotId(slots: DoseSlot[]): string | null {
  let best: DoseSlot | null = null;
  let bestTime = -Infinity;
  for (const s of slots) {
    if (!s.id) continue; // legacy 가상 슬롯(id null) 제외
    const t = slotSortValue(s.time);
    if (!Number.isFinite(t)) continue; // 파싱 불가 time 제외
    if (t > bestTime || (t === bestTime && best && s.sortOrder > best.sortOrder)) {
      best = s;
      bestTime = t;
    }
  }
  return best?.id ?? null;
}

/**
 * 그날 활성 슬롯 중 시간이 가장 이른(첫) 슬롯의 id 를 반환.
 *
 * 수면(sleep) 게이팅 전용 — "그날 첫 복용 슬롯의 기록일 때만 수면을 묻는다".
 * getLastActiveSlotId 의 대칭형(min/max 만 반대):
 * - 시간(HH:MM) 최솟값 기준, 동률이면 sortOrder 작은 것.
 * - 파싱 불가/빈 time 슬롯은 정렬에서 제외(Infinity 로 맨 뒤 가지 않도록).
 * - id 가 null 인 legacy 가상 슬롯은 식별 불가하므로 제외(legacy 경로는 meal_time 게이팅 사용).
 *
 * @param slots resolveDisplaySlots / useDoseSlots().slots 결과
 * @returns 첫 활성 실제 슬롯의 id, 없으면 null
 */
export function getFirstActiveSlotId(slots: DoseSlot[]): string | null {
  let best: DoseSlot | null = null;
  let bestTime = Infinity;
  for (const s of slots) {
    if (!s.id) continue; // legacy 가상 슬롯(id null) 제외
    const t = slotSortValue(s.time);
    if (!Number.isFinite(t)) continue; // 파싱 불가 time 제외
    if (t < bestTime || (t === bestTime && best && s.sortOrder < best.sortOrder)) {
      best = s;
      bestTime = t;
    }
  }
  return best?.id ?? null;
}

/**
 * 그날 약효추적(med-effect tracking) 시점의 경계(분, 자정 기준)를 계산 — 변비/수면 게이팅 전용.
 *
 * 활성 실제 슬롯(id 있음 + trackEnabled + trackIntervals 비어있지 않음)별로
 *   "약효추적 시점 = 슬롯시각 + interval" 을 모두 펼친 뒤:
 *   - firstTrackingMin : 그날 가장 이른 약효추적 시점 = min over slots (시각 + min(intervals))  → 수면 게이팅용
 *   - lastTrackingMin  : 그날 가장 늦은 약효추적 시점 = max over slots (시각 + max(intervals))  → 변비 게이팅용
 *
 * ⚠️ 슬롯별 interval 이 달라 "가장 늦은 약효추적"이 "가장 늦은 슬롯"과 다를 수 있으므로
 *    단순 슬롯 시각 비교가 아니라 (시각+interval) 합으로 비교한다.
 *    예) 18:00[30,120] 과 21:00[30] → last = max(18:00+120=20:00, 21:00+30=21:30)=21:30.
 *
 * - id 가 null 인 legacy 가상 슬롯, 추적 OFF, 빈 interval, 파싱 불가 시각은 제외.
 * - 약효추적이 하나도 없으면 둘 다 null(게이팅 측에서 "표시 안 함"으로 처리).
 *
 * @param slots resolveDisplaySlots / useDoseSlots().slots 결과
 */
export function getTrackingDayBounds(
  slots: DoseSlot[]
): { firstTrackingMin: number | null; lastTrackingMin: number | null } {
  let first = Infinity;
  let last = -Infinity;
  for (const s of slots) {
    if (!s.id) continue; // legacy 가상 슬롯(id null) 제외
    if (!s.trackEnabled) continue; // 추적 OFF 슬롯은 약효추적 시점 없음
    const intervals = s.trackIntervals ?? [];
    if (intervals.length === 0) continue;
    const base = slotSortValue(s.time);
    if (!Number.isFinite(base)) continue; // 파싱 불가 시각 제외
    first = Math.min(first, base + Math.min(...intervals));
    last = Math.max(last, base + Math.max(...intervals));
  }
  return {
    firstTrackingMin: Number.isFinite(first) ? first : null,
    lastTrackingMin: Number.isFinite(last) ? last : null,
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
      label: null, // 표시명은 legacyKey/time 에서 만든다
      sortOrder: idx,
      remindEnabled: prefs ? prefs[key] !== false : true,
      remindSoundId: null,
      remindAlarmMode: 'basic',
      trackEnabled: key !== 'bedtime', // 기존: 취침약 자동 추적 제외
      trackIntervals: [],
      trackSoundId: null,
      trackAlarmMode: 'basic',
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
      .select('id, label, legacy_key')
      .eq('patient_id', patientId);

    if (selErr) {
      console.warn('[ensurePatientDoseSlots] select failed (continuing):', selErr);
      return;
    }

    // legacy_key 로 매칭한다(언어 무관).
    const byKey = new Map<string, string>();   // legacy_key → id
    (existing ?? []).forEach((r) => {
      const lk = (r as any).legacy_key as string | null;
      if (lk) byKey.set(lk, r.id);
    });

    const trackIntervals = defaultTrackIntervals(notifMinutes);

    for (let idx = 0; idx < LEGACY_SLOT_ORDER.length; idx++) {
      const key = LEGACY_SLOT_ORDER[idx];
      const time = normalizeHhmm(sched[key]) || LEGACY_SLOT_META[key].defaultTime;
      // 기본 OFF (오너 결정 2026-07-15): 신규 환자의 프리셋 슬롯은 알림을 꺼진 채로 만든다.
      // → 약을 등록하지 않았는데 프리셋 시간에 유령 알림이 오는 문제 차단.
      //   사용자는 온보딩 직후 강제 이동되는 '복용시간 설정·알림' 화면에서 직접 켠다.
      //   (명시 prefs 가 오면 그대로 존중 — 이후 편집/이관 경로 보존)
      const remindEnabled = prefs ? prefs[key] !== false : false;

      const existingId = byKey.get(key);
      if (existingId) {
        // ⚠️ 시간 단일 소스 원칙(통합 복용 관리 재설계):
        //   dose_slots.time 은 "슬롯 편집(DoseSlotSetList)" 경로로만 변경한다.
        //   약 추가/수정/OCR 경로에서 흘러온 meal_schedules 로 기존 슬롯 time 을
        //   덮어쓰면 슬롯이 정본인데도 약쪽 값에 끌려가 divergence 가 생긴다.
        //   → 기존 슬롯은 그대로 둔다(time/remind_enabled update 안 함).
        //   (신규 환자 0슬롯일 때 아래 insert 로 4슬롯 생성만 수행.)
      } else {
        // insert: 신규 온보딩/미이관 환자
        const { error: insErr } = await supabase
          .from('dose_slots')
          .insert({
            patient_id: patientId,
            time,
            // 언어 무관 키가 단일 진실. label(한글)은 더 이상 쓰지 않는다 —
            // 표시명은 legacy_key/시각에서 만든다(2026-07-30 오너 확정).
            legacy_key: key,
            sort_order: idx,
            remind_enabled: remindEnabled,
            remind_sound_id: null,
            // 기본 OFF (오너 결정 2026-07-15): 약효추적도 꺼진 채로 시작 → 설정 화면에서 직접 켠다.
            track_enabled: false,
            track_intervals: trackIntervals,
            track_sound_id: null,
            is_active: true,
          } as any);
        if (insErr) console.warn(`[ensurePatientDoseSlots] insert(${key}) failed (continuing):`, insErr);
      }
    }

    // 캐시 무효화 — 직후 읽기 경로가 새 슬롯을 보게.
    invalidateDoseSlotsCache(patientId);
  } catch (e) {
    console.warn('[ensurePatientDoseSlots] exception (continuing):', e);
  }
}

/**
 * 약 1개를 "선택된 슬롯 집합"에 정확히 배정한다(시각·meal_schedules 안 건드림).
 *
 * 통합 복용 관리 화면의 "약 넣기·빼기" 전용. dose_slot.time 은 절대 수정하지 않고
 * medication_dose_slots(M:N) 매핑만 set-reconcile 한다(delete-then-insert).
 *  - 슬롯 체크 = 그 슬롯에 약을 배정(insert), 해제 = 매핑 제거(delete).
 *  - slotIds 가 빈 배열이면 이 약의 모든 매핑 제거(어느 슬롯에도 안 먹음).
 * 멱등: 매번 전체 delete 후 현재 선택분만 insert.
 *
 * ⚠️ medications.meal_times/meal_schedules 는 표시/legacy 용 — 여기서 안 만짐.
 *    시간 단일 소스 = dose_slots(슬롯 편집에서만 변경).
 *
 * @param medicationId 대상 medications.id
 * @param slotIds      배정할 dose_slots.id 목록(현재 체크된 슬롯들)
 * @param patientId    캐시 무효화용(선택)
 */
export async function setMedicationSlots(
  medicationId: string,
  slotIds: string[],
  patientId?: string,
): Promise<void> {
  if (!medicationId) return;
  const ids = [...new Set(slotIds.filter(Boolean))];
  try {
    const { error: delErr } = await supabase
      .from('medication_dose_slots')
      .delete()
      .eq('medication_id', medicationId);
    if (delErr) throw delErr;

    if (ids.length > 0) {
      const rows = ids.map((dose_slot_id) => ({ medication_id: medicationId, dose_slot_id }));
      const { error: insErr } = await supabase
        .from('medication_dose_slots')
        .insert(rows as any);
      if (insErr) throw insErr;
    }
    if (patientId) invalidateDoseSlotsCache(patientId);
  } catch (e) {
    console.error('[setMedicationSlots] failed to save mapping:', e);
    throw e;
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
    if (delErr) console.warn('[syncMedicationDoseSlots] delete failed (continuing):', delErr);

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
      if (insErr) console.warn('[syncMedicationDoseSlots] insert failed (continuing):', insErr);
    }
  } catch (e) {
    console.warn('[syncMedicationDoseSlots] exception (continuing):', e);
  }
}
