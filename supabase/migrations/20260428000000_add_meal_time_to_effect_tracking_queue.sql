-- effect_tracking_queue에 meal_time 컬럼 추가
-- 약효 추적 알림이 어느 약(아침/점심/저녁)에 대한 것인지 저장

ALTER TABLE effect_tracking_queue
ADD COLUMN IF NOT EXISTS meal_time TEXT;
