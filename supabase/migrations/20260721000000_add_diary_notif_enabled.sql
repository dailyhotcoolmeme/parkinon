-- 가족 일기 알림 수신 토글 (오너 결정 2026-07-21): 기본 ON.
--   환자·보호자 모두 받으므로 caregiver_notif_prefs(보호자 전용)와 별개 컬럼으로 둔다.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS diary_notif_enabled boolean NOT NULL DEFAULT true;
