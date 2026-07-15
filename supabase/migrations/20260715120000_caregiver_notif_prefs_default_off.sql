-- 보호자 알림 기본 OFF (오너 결정 2026-07-15): 신규 계정의 caregiver_notif_prefs 컬럼 기본값을 전부 false로.
-- 빈 객체({})는 발송부가 "미설정=ON(opt-out)"으로 해석하므로, 모든 키를 명시적으로 false로 둔다.
ALTER TABLE public.users
  ALTER COLUMN caregiver_notif_prefs
  SET DEFAULT '{"med_taken": false, "med_missed": false, "missed_first": false, "missed_second": false, "body_state": false, "mood": false, "exercise": false, "measurement_completed": false, "sleep": false, "constipation": false}'::jsonb;
