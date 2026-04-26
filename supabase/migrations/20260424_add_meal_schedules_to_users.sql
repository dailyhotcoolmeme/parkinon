-- users 테이블에 meal_schedules 컬럼 추가
-- 약 등록 없이도 복용 시간 기반 알림을 발송하기 위해 필요

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS meal_schedules jsonb DEFAULT '{"morning": "08:00", "lunch": "12:00", "dinner": "18:00", "bedtime": "22:00"}'::jsonb;

COMMENT ON COLUMN public.users.meal_schedules IS '환자 기본 복용 시간 설정 (약 등록 없이도 알림 발송 가능)';

-- 기존 환자들에게 기본값 설정 (NULL인 경우에만)
UPDATE public.users
SET meal_schedules = '{"morning": "08:00", "lunch": "12:00", "dinner": "18:00", "bedtime": "22:00"}'::jsonb
WHERE role = 'patient' AND meal_schedules IS NULL;
