-- Raise pg_net HTTP timeout for notification cron jobs from default 5000ms to 30000ms.
--
-- Root cause: the cron commands called net.http_post() without timeout_milliseconds,
-- so pg_net used its 5000ms default. send-medication-reminders was observed running up
-- to 5061ms and net._http_response had 6 rows with NULL status_code (= request timed out).
-- As the patient count grows this would make on-time / missed-dose alerts drop intermittently.
--
-- Only the command's net.http_post call is changed (adds timeout_milliseconds:=30000).
-- Schedule (* * * * *), target function URL, and active state are intentionally preserved.
-- 30s keeps each run comfortably inside the 1-minute cron interval.

-- parkinon-med-time (jobid 10) -> send-medication-reminders
SELECT cron.alter_job(
  job_id := 10,
  command := $cmd$SELECT net.http_post(
    url:='https://avqaflxufyadgzjiojkk.supabase.co/functions/v1/send-medication-reminders',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cWFmbHh1ZnlhZGd6amlvamtrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDgwMTQ5MywiZXhwIjoyMDkwMzc3NDkzfQ.Gm40LP_iLyyP_gfE8qxlern6NjqMmMObqHZmmgDZHVc"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds:=30000
  )$cmd$
);

-- parkinon-effect-queue (jobid 9) -> process-notification-queue
SELECT cron.alter_job(
  job_id := 9,
  command := $cmd$SELECT net.http_post(url:='https://avqaflxufyadgzjiojkk.supabase.co/functions/v1/process-notification-queue', headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cWFmbHh1ZnlhZGd6amlvamtrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDgwMTQ5MywiZXhwIjoyMDkwMzc3NDkzfQ.Gm40LP_iLyyP_gfE8qxlern6NjqMmMObqHZmmgDZHVc"}'::jsonb, body:='{}'::jsonb, timeout_milliseconds:=30000)$cmd$
);

-- parkinon-appointment (jobid 11) -> send-appointment-reminders
SELECT cron.alter_job(
  job_id := 11,
  command := $cmd$select net.http_post(
      url:='https://avqaflxufyadgzjiojkk.supabase.co/functions/v1/send-appointment-reminders',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cWFmbHh1ZnlhZGd6amlvamtrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDgwMTQ5MywiZXhwIjoyMDkwMzc3NDkzfQ.Gm40LP_iLyyP_gfE8qxlern6NjqMmMObqHZmmgDZHVc"}'::jsonb,
      body:='{}'::jsonb,
      timeout_milliseconds:=30000
  )$cmd$
);
