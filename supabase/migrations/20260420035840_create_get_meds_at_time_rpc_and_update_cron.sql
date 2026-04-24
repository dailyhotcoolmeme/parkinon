-- get_meds_at_time RPC 함수
-- 특정 시간(HH:MM)에 복약 예정인 환자 목록과 meal_time 슬롯을 반환
-- notifications cron job에서 호출하여 푸시 대상 조회에 사용

CREATE OR REPLACE FUNCTION public.get_meds_at_time(target_time text)
RETURNS TABLE(patient_id text, meal_time text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    m.patient_id::TEXT,
    slot.key AS meal_time
  FROM medications m,
       jsonb_each_text(m.meal_schedules) AS slot(key, val)
  WHERE m.is_active = true
    AND slot.val = target_time
    AND slot.key = ANY(m.meal_times);
$$;
