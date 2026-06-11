-- 보호자(role='caregiver')가 잘못 들고 있는 dose_slots 비활성화 + get_meds_at_time이 실제 환자만 대상.
-- (한민석=보호자인데 dose_slots 보유 → 미복용 알림이 '한민석님 미복용'으로 보호자에게 가던 버그)
update public.dose_slots ds set is_active = false
where ds.is_active = true
  and exists (select 1 from public.users u where u.id = ds.patient_id and u.role = 'caregiver');
-- get_meds_at_time 의 role 필터는 이후 20260611020000 에서 dose_slots-authoritative 와 함께 최종 정의.
