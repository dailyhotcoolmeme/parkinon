/**
 * useSlotMedications.ts
 * 복용 시각(슬롯) → 그 시각에 등록된 약 목록 조회 훅 (읽기 전용·보조 훅).
 *
 * 약효추적 시간 "안내"용으로만 쓰인다(DoseSlotSetList 박스2). 슬롯에 묶인 약 이름으로
 * 레보도파 계열 권장 시점을 글로 안내할 뿐, track_intervals 값을 바꾸지 않는다(비강제 — §3-C).
 *
 * 데이터 경로(MedicationManageScreen 1412~1426 공용화):
 *   medication_dose_slots(M:N) ⨯ medications → slotId → [{ name, ediCode, itemSeq }]
 *
 * - patientId 는 usePatientId(보호자→연동환자 해석)로 일관. RLS 로 본인+그룹 보호자 read 허용.
 * - medication_dose_slots / medications / dose_slots realtime 으로 약 추가·삭제·재배정 즉시 반영.
 * - 서버 푸시/큐 경로(queue-effect-tracking 등)와 무관 — 순수 읽기. OTA 호환.
 *
 * 사양 단일 진실 소스: docs/med_effect_tracking_recommendation_spec.md (슬롯 단위 안내 절)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { usePatientId } from './usePatientId';

/** 한 슬롯에 묶인 약 1건 (안내용 최소 필드) */
export interface SlotMedication {
  id: string;
  name: string;
  /** 건보 EDI코드(medications.drug_code) — pk_profile 보조 매칭/식별용(선택) */
  ediCode: string | null;
  /** 식약처 ITEM_SEQ(medications.item_seq) — 식약처 원문 링크용(선택) */
  itemSeq: string | null;
}

export interface UseSlotMedicationsReturn {
  /** slotId → 그 시각에 등록된 약 목록 */
  bySlot: Record<string, SlotMedication[]>;
  loading: boolean;
  refresh: () => Promise<void>;
}

async function fetchSlotMedications(
  patientId: string
): Promise<Record<string, SlotMedication[]>> {
  // 1) 환자의 활성 슬롯 id 목록.
  const { data: slotRows, error: slotErr } = await supabase
    .from('dose_slots')
    .select('id')
    .eq('patient_id', patientId)
    .eq('is_active', true);
  if (slotErr) throw slotErr;
  const slotIds = (slotRows ?? [])
    .map((r: any) => r.id)
    .filter((id: any): id is string => !!id);
  if (slotIds.length === 0) return {};

  // 2) 슬롯↔약 매핑.
  const { data: mapRows, error: mapErr } = await supabase
    .from('medication_dose_slots')
    .select('medication_id, dose_slot_id')
    .in('dose_slot_id', slotIds);
  if (mapErr) throw mapErr;
  const rows = mapRows ?? [];
  const medIds = [...new Set(rows.map((r: any) => r.medication_id).filter(Boolean))];
  if (medIds.length === 0) return {};

  // 3) 약 기본정보(활성만).
  const { data: medRows, error: medErr } = await supabase
    .from('medications')
    .select('id, name, drug_code, item_seq, is_active')
    .in('id', medIds);
  if (medErr) throw medErr;
  const medById = new Map<string, SlotMedication>();
  (medRows ?? []).forEach((m: any) => {
    if (m.is_active === false) return; // 중단(비활성) 약 제외
    medById.set(m.id, {
      id: m.id,
      name: m.name,
      ediCode: m.drug_code ?? null,
      itemSeq: m.item_seq ?? null,
    });
  });

  // 4) slotId → 약 목록 조립.
  const bySlot: Record<string, SlotMedication[]> = {};
  rows.forEach((r: any) => {
    const med = medById.get(r.medication_id);
    if (!med) return;
    const list = bySlot[r.dose_slot_id] ?? [];
    if (!list.some((x) => x.id === med.id)) list.push(med);
    bySlot[r.dose_slot_id] = list;
  });
  return bySlot;
}

export function useSlotMedications(): UseSlotMedicationsReturn {
  const { patientId, loading: patientLoading } = usePatientId();
  const [bySlot, setBySlot] = useState<Record<string, SlotMedication[]>>({});
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const rtChannelId = useRef(Math.random().toString(36).slice(2, 10));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // silent=true 면 loading 플래그를 건드리지 않고 bySlot 만 조용히 갱신한다.
  // realtime(약-슬롯 연결 변경) 재조회는 silent 로 돈다 → DoseSlotSetList 의 체크리스트
  // 편집 시트가 열린 동안 자기 자신이 한 토글 쓰기 echo 로 loading 이 true→false 깜빡이며
  // 시드/분기 로직이 churn 되어 시트가 리마운트/깜빡이던 문제를 막는다(낙관적 상태 우선).
  // 초기 로드/명시 refresh 는 non-silent 라 "불러오고 있어요" 안내는 그대로 동작.
  const load = useCallback(
    async (silent = false) => {
      if (patientLoading) return;
      if (!patientId) {
        if (mounted.current) {
          setBySlot({});
          setLoading(false);
        }
        return;
      }
      if (!silent && mounted.current) setLoading(true);
      try {
        const next = await fetchSlotMedications(patientId);
        if (mounted.current) setBySlot(next);
      } catch (e) {
        console.warn('[useSlotMedications] fetch failed (treating as an empty map):', e);
        if (mounted.current) setBySlot({});
      } finally {
        if (!silent && mounted.current) setLoading(false);
      }
    },
    [patientId, patientLoading],
  );

  useEffect(() => {
    load();
  }, [load]);

  // 약 추가·삭제·슬롯 재배정·슬롯 변경 → 안내 즉시 갱신.
  useEffect(() => {
    if (!patientId) return;
    const suffix = rtChannelId.current;
    const ch1 = supabase
      .channel(`slot-meds-mds-${patientId}-${suffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medication_dose_slots' },
        () => load(true), // silent — loading 깜빡임 없이 bySlot 만 갱신(자기 토글 echo 포함)
      )
      .subscribe();
    const ch2 = supabase
      .channel(`slot-meds-meds-${patientId}-${suffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medications', filter: `patient_id=eq.${patientId}` },
        () => load(true), // silent — 동일 이유
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, [patientId, load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return {
    bySlot,
    loading: loading || patientLoading,
    refresh,
  };
}
