-- 기존 고정시간 미복용 크론 4개 삭제
-- (약 미복용 알림이 send-medication-reminders Edge Function에서 통합 처리되므로 불필요)
SELECT cron.unschedule('parkinon-missed-morning');
SELECT cron.unschedule('parkinon-missed-lunch');
SELECT cron.unschedule('parkinon-missed-dinner');
SELECT cron.unschedule('parkinon-missed-bedtime');
