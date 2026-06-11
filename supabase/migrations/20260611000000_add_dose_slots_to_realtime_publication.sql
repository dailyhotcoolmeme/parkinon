-- dose_slots 변경을 realtime(postgres_changes)으로 구독 가능하게 publication에 추가.
-- (보호자가 환자 dose_slots 수정 시 환자 기기 즉시 반영 / 반대도. useDoseSlots의 realtime 구독이
--  이 publication 없이는 이벤트를 전혀 못 받아 즉시 반영이 안 됐음.)
alter publication supabase_realtime add table public.dose_slots;

-- 필터(patient_id)가 모든 이벤트(특히 UPDATE/DELETE)에서 동작하도록 전체 행 복제.
alter table public.dose_slots replica identity full;
