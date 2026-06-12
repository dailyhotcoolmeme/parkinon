-- (⑧) update_patient_notif_prefs 권한 게이트 강화 (출시 전 검수 반영, 라이브 적용됨).
-- 기존: is_same_patient_group()만 확인 → 따로 거주 보호자도 환자 알림 스케줄 덮어쓰기 가능.
-- 변경: cancel_patient_record / update_patient_onoff_record 와 동일하게
--       본인 또는 '동거(separate 아님) 보호자'만 허용. (사양: 따로 거주 보호자는 대신 입력 불가)
CREATE OR REPLACE FUNCTION public.update_patient_notif_prefs(p_patient_id uuid, p_prefs jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_caller = p_patient_id then
    v_allowed := true;
  elsif exists (
    select 1
    from patient_group_members cg
    join patient_group_members pt on cg.group_id = pt.group_id
    join public.users u on u.id = cg.user_id
    where cg.user_id = v_caller and cg.role = 'caregiver'
      and pt.user_id = p_patient_id and pt.role = 'patient'
      and u.residence_type is distinct from 'separate'
  ) then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'not authorized to update this patient notif prefs';
  end if;

  update public.users
  set
    med_time_notif_prefs = coalesce(p_prefs->'med_time_notif_prefs', med_time_notif_prefs),
    med_notif_prefs      = coalesce(p_prefs->'med_notif_prefs', med_notif_prefs),
    exercise_notif_prefs = coalesce(p_prefs->'exercise_notif_prefs', exercise_notif_prefs),
    meal_schedules       = coalesce(p_prefs->'meal_schedules', meal_schedules),
    notification_enabled = coalesce((p_prefs->>'notification_enabled')::boolean, notification_enabled)
  where id = p_patient_id;
end;
$function$;
