-- =====================================================================
-- 복용 기록 취소 시 약효추적 큐(effect_tracking_queue) 정리
--
-- 문제(라이브 재현):
--   홈 "오늘 복용 현황" 카드의 빨강 "취소" → handleCancelRecord →
--   cancelMedication(useMedication) → RPC cancel_patient_record 로 med_log 삭제.
--   이때 그 복용의 약효추적 큐(미발송)가 정리되지 않아,
--   effect_tracking_queue.med_log_id FK(ON DELETE SET NULL) 때문에
--   큐가 med_log_id=NULL '고아'로 남아 그대로 발송됨. → 취소했는데 알림 옴.
--
-- 근본 원인 2가지:
--   (1) effect_tracking_queue 에 DELETE RLS 정책이 없음(INSERT/SELECT/UPDATE만).
--       → 클라이언트 supabase.from('effect_tracking_queue').delete() 는
--         RLS 에 막혀 0행 영향(에러 없이 무효).
--   (2) 현재 쓰기 경로는 legacy(meal_time 기준)라 큐 행의 med_log_id 가 전부 NULL.
--       → .eq('med_log_id', medLogId) 매칭이 애초에 0행.
--
-- 해법:
--   취소를 처리하는 cancel_patient_record(SECURITY DEFINER, RLS 우회)에서
--   med_log 삭제 '이전에' 그 복용의 미발송 큐를 삭제한다.
--   두 경로 모두 커버:
--     (a) 신규 dose_slot 경로: med_log_id 1:1 매칭
--     (b) legacy meal_time 경로: (patient_id, meal_time) + send_at >= taken_at
--   미발송(sent_at IS NULL)만 삭제 → 발송 완료 건은 통계/history 보존.
--
-- 모든 취소 경로(오늘/과거, 환자/보호자)가 이 RPC 한 곳을 통과하므로 공통 정리됨.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cancel_patient_record(p_table text, p_record_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_patient_id uuid;
  v_caller uuid := auth.uid();
  v_allowed boolean := false;
  v_meal_time text;
  v_taken_at timestamptz;
begin
  if p_table not in ('med_logs', 'on_off_logs', 'exercise_logs') then
    raise exception 'invalid table';
  end if;

  execute format('select patient_id from public.%I where id = $1', p_table)
    into v_patient_id using p_record_id;
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
    raise exception 'not authorized to cancel this record';
  end if;

  -- 약 복용 기록 취소 시: 이 복용에 딸린 미발송 약효추적 큐를 먼저 정리.
  if p_table = 'med_logs' then
    select meal_time, taken_at into v_meal_time, v_taken_at
    from public.med_logs where id = p_record_id;

    -- (a) 신규 dose_slot 경로: med_log_id 1:1
    delete from public.effect_tracking_queue
    where med_log_id = p_record_id
      and sent_at is null;

    -- (b) legacy meal_time 경로: med_log_id 미연결 큐를 meal_time + 복용시각 이후로 한정
    if v_meal_time is not null then
      delete from public.effect_tracking_queue
      where med_log_id is null
        and patient_id = v_patient_id
        and meal_time = v_meal_time
        and sent_at is null
        and send_at >= v_taken_at;
    end if;
  end if;

  execute format('delete from public.%I where id = $1', p_table) using p_record_id;
end;
$function$;
