-- get_meds_at_time RPC 함수 수정
-- medications 테이블 외에 users 테이블의 meal_schedules도 조회하여
-- 약 등록 없는 환자도 알림 대상에 포함

CREATE OR REPLACE FUNCTION public.get_meds_at_time(target_time text)
RETURNS TABLE(patient_id text, meal_time text)
LANGUAGE sql
STABLE
AS $$
  -- medications 테이블에서 조회 (기존 로직)
  SELECT DISTINCT
    m.patient_id::TEXT,
    slot.key AS meal_time
  FROM medications m,
       jsonb_each_text(m.meal_schedules) AS slot(key, val)
  WHERE m.is_active = true
    AND slot.val = target_time
    AND slot.key = ANY(m.meal_times)

  UNION

  -- users 테이블에서 조회 (약 미등록 환자 대응)
  -- medications가 없거나 is_active=false인 환자만 포함
  SELECT DISTINCT
    u.id::TEXT AS patient_id,
    slot.key AS meal_time
  FROM users u,
       jsonb_each_text(u.meal_schedules) AS slot(key, val)
  WHERE u.role = 'patient'
    AND u.meal_schedules IS NOT NULL
    AND slot.val = target_time
    AND NOT EXISTS (
      SELECT 1
      FROM medications m
      WHERE m.patient_id = u.id
        AND m.is_active = true
        AND m.meal_times @> ARRAY[slot.key]::text[]
    );
$$;

COMMENT ON FUNCTION public.get_meds_at_time(text) IS '특정 시간에 복약 알림을 받을 환자 목록 반환 (medications + users.meal_schedules 통합 조회)';
