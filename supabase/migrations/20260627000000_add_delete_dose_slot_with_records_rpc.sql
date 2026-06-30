-- =====================================================================
-- 복용시간대(dose_slot) "기록도 함께 삭제" 서버 권위 RPC
--
-- 목적:
--   알림 설정에서 복용시간대(dose_slot)를 삭제할 때 사용자가 "기록도 함께
--   삭제"를 택하면, 그 슬롯에 딸린 모든 기록을 한 트랜잭션으로 정리한다.
--   클라이언트 직접 delete 는 effect_tracking_queue 등에 DELETE RLS 정책이
--   없거나 크로스유저 게이트에 막히므로(선례: 20260609000000), 서버 권위
--   SECURITY DEFINER RPC 한 곳에서 RLS 를 우회해 일괄 정리한다.
--
-- 권한검증(파괴적 작업 — cancel_patient_record / update_patient_notif_prefs 와
--   동일 게이트): 호출자 본인(=슬롯 환자) 또는 '동거(separate 아님) 보호자'만
--   허용. 따로 거주 보호자는 대신 삭제 불가. SECURITY DEFINER 로 RLS 를
--   우회하되, 이 게이트로 남의 데이터는 절대 못 지운다.
--
-- 삭제 대상(스키마 확인 결과):
--   - effect_tracking_queue : dose_slot_id = 슬롯  또는  med_log_id ∈ 슬롯의 med_logs
--                             (발송/미발송 무관 — 그 슬롯 것 전부)
--   - on_off_logs           : dose_slot_id = 슬롯  또는  med_log_id ∈ 슬롯의 med_logs
--   - med_logs              : dose_slot_id = 슬롯
--   - medication_dose_slots : dose_slot_id = 슬롯 (약↔슬롯 링크)
--   ※ effect_tracking_queue / on_off_logs 의 med_log_id FK 는 ON DELETE SET NULL
--     이므로, med_logs 를 지우기 '전에' med_log_id 기준 삭제를 먼저 수행해야
--     매칭이 유실되지 않는다 → 삭제 순서: 큐·약효기록 → med_logs → 링크 → 슬롯.
--
-- dose_slots 자체는 기존 표준(soft delete: is_active=false)으로 처리.
--   이 update 는 기존 트리거 trg_dose_slots_cleanup_effect_queue 를 발동시켜
--   미발송 큐를 한 번 더 정리하지만(멱등), 위에서 이미 제거되므로 no-op.
--
-- 멱등: CREATE OR REPLACE FUNCTION. 전체 본문은 단일 함수 = 단일 트랜잭션.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.delete_dose_slot_with_records(p_dose_slot_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_patient_id uuid;
  v_caller uuid := auth.uid();
  v_allowed boolean := false;
begin
  -- 1) 슬롯의 환자 확인 (존재하지 않으면 중단)
  select patient_id into v_patient_id
  from public.dose_slots
  where id = p_dose_slot_id;

  if v_patient_id is null then
    raise exception 'dose slot not found';
  end if;

  -- 2) 권한검증 — 본인 또는 동거 보호자만 (cancel_patient_record 와 동일 게이트)
  if v_caller = v_patient_id then
    v_allowed := true;
  elsif exists (
    select 1
    from patient_group_members cg
    join patient_group_members pt on cg.group_id = pt.group_id
    join public.users u on u.id = cg.user_id
    where cg.user_id = v_caller and cg.role = 'caregiver'
      and pt.user_id = v_patient_id and pt.role = 'patient'
      and u.residence_type is distinct from 'separate'
  ) then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'not authorized to delete this dose slot';
  end if;

  -- 3) 약효추적 큐 삭제 (슬롯 기준 + 그 슬롯 복용에 딸린 큐, 발송/미발송 전부)
  delete from public.effect_tracking_queue q
  where q.dose_slot_id = p_dose_slot_id
     or q.med_log_id in (
       select m.id from public.med_logs m where m.dose_slot_id = p_dose_slot_id
     );

  -- 4) 약효추적 기록(on_off_logs) 삭제 (슬롯 기준 + 그 슬롯 복용에 딸린 기록)
  delete from public.on_off_logs o
  where o.dose_slot_id = p_dose_slot_id
     or o.med_log_id in (
       select m.id from public.med_logs m where m.dose_slot_id = p_dose_slot_id
     );

  -- 5) 복용 기록(med_logs) 삭제
  delete from public.med_logs m
  where m.dose_slot_id = p_dose_slot_id;

  -- 6) 약 ↔ 슬롯 링크 삭제
  delete from public.medication_dose_slots l
  where l.dose_slot_id = p_dose_slot_id;

  -- 7) 슬롯 soft delete (기존 표준). 트리거가 미발송 큐를 한 번 더 정리(멱등).
  update public.dose_slots
  set is_active = false
  where id = p_dose_slot_id;
end;
$function$;

-- 권한: 익명 실행 차단, 인증 사용자에게만 허용 (선례: 20260612010000)
REVOKE ALL ON FUNCTION public.delete_dose_slot_with_records(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_dose_slot_with_records(uuid) TO authenticated;
