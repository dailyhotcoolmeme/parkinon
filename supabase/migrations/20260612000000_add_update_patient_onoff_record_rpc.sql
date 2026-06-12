-- =====================================================================
-- 약효추적(on_off_logs) 기록 수정 RPC
--
-- 약효추적 기록 카드의 '수정'(연필) → 입력 팝업 수정 모드 → 이 RPC 로 update.
-- cancel_patient_record 와 동일한 권한 게이트(본인 또는 동거 보호자)를 적용한다.
-- (직접 update 는 RLS/크로스유저 때문에 막히므로 SECURITY DEFINER RPC 경유)
--
-- 전달된 값(non-null)만 갱신 → 해당 기록에 없던 항목(수면/변비 등)은 그대로 보존.
--   수정 팝업은 그 기록에 실제 있던 단계만 노출하므로, 없는 항목은 null 로 전달됨.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.update_patient_onoff_record(
  p_record_id uuid,
  p_body_state integer,
  p_mood integer,
  p_sleep_quality integer,
  p_constipation boolean
)
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
  select patient_id into v_patient_id from public.on_off_logs where id = p_record_id;
  if v_patient_id is null then
    raise exception 'record not found';
  end if;

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
    raise exception 'not authorized to update this record';
  end if;

  update public.on_off_logs
  set body_state    = coalesce(p_body_state, body_state),
      mood          = coalesce(p_mood, mood),
      sleep_quality = coalesce(p_sleep_quality, sleep_quality),
      constipation  = coalesce(p_constipation, constipation)
  where id = p_record_id;
end;
$function$;
