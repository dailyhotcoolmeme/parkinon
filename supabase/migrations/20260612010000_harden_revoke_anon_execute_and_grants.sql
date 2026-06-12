-- 보안 하드닝(출시 전 검수 반영): 하드닝 마이그레이션(20260528001018) 이후 추가된
-- RPC·테이블의 anon 권한 회수. 모두 RLS/내부 auth.uid() 체크로 현재도 막히지만 표면 제거.
-- (이미 라이브에 적용됨 — 저장소 추적용 기록)

-- (⑥) anon 이 실행 가능한 SECURITY DEFINER RPC → anon/PUBLIC EXECUTE 회수, authenticated 만 허용.
REVOKE EXECUTE ON FUNCTION public.cancel_patient_record(text, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.cancel_patient_record(text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_patient_onoff_record(uuid, integer, integer, integer, boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.update_patient_onoff_record(uuid, integer, integer, integer, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_custom_sound(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.delete_custom_sound(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_custom_sound(uuid, text, text, text, integer) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.update_custom_sound(uuid, text, text, text, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_patient_notif_prefs(uuid, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.update_patient_notif_prefs(uuid, jsonb) TO authenticated;

-- (⑦) 하드닝 이후 생성된 테이블에 잔존하는 anon 풀 write GRANT 회수.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT ON public.alarm_sound_prefs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT ON public.custom_sounds FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT ON public.dose_slots FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT ON public.medication_dose_slots FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT ON public.missed_med_sound_prefs FROM anon;
