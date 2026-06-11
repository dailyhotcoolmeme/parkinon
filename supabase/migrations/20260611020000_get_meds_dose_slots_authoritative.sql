-- get_meds_at_time 최종 정의:
--  (1) 실제 환자(role='patient')의 슬롯/약만 알림 대상 — 보호자 stray dose_slots 제외.
--  (2) dose_slots 를 가진 환자는 legacy meal_schedules 를 완전히 무시 — 보호자가 슬롯 시각을
--      바꿔도 옛 legacy 시각에 이중/오발송되던 문제 제거(dose_slots = 단일 진실).
create or replace function public.get_meds_at_time(target_time text)
 returns table(patient_id text, meal_time text, dose_slot_id uuid, label text, "time" text)
 language sql stable set search_path to 'public', 'pg_temp'
as $function$
  select distinct ds.patient_id::text,
    case ds.label when '아침' then 'morning' when '점심' then 'lunch'
                  when '저녁' then 'dinner' when '취침' then 'bedtime' else null end,
    ds.id, ds.label, to_char(ds.time,'HH24:MI')
  from dose_slots ds
  where ds.is_active = true and ds.remind_enabled = true and to_char(ds.time,'HH24:MI') = target_time
    and exists (select 1 from users u where u.id = ds.patient_id and u.role = 'patient')
  union
  select distinct m.patient_id::text, slot.key, null::uuid, null::text, slot.val
  from medications m, jsonb_each_text(m.meal_schedules) as slot(key,val)
  where m.is_active = true and slot.val = target_time and slot.key = any(m.meal_times)
    and exists (select 1 from users u where u.id = m.patient_id and u.role = 'patient')
    and not exists (select 1 from dose_slots ds where ds.patient_id = m.patient_id and ds.is_active = true)
  union
  select distinct u.id::text, slot.key, null::uuid, null::text, slot.val
  from users u, jsonb_each_text(u.meal_schedules) as slot(key,val)
  where u.role = 'patient' and u.meal_schedules is not null and slot.val = target_time
    and not exists (select 1 from medications m where m.patient_id = u.id and m.is_active = true and m.meal_times @> array[slot.key]::text[])
    and not exists (select 1 from dose_slots ds where ds.patient_id = u.id and ds.is_active = true);
$function$;
