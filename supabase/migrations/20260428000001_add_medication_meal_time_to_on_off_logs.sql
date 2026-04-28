-- on_off_logs에 medication_meal_time 컬럼 추가
-- 몸상태 기록이 어느 약(아침/점심/저녁/취침)에 대한 것인지 저장

ALTER TABLE on_off_logs
ADD COLUMN IF NOT EXISTS medication_meal_time TEXT;
