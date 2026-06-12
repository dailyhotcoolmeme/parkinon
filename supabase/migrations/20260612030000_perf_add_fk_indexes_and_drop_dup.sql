-- 성능(출시 전 검수): 인덱스 없는 FK 컬럼 22개에 인덱스 추가 + 중복 인덱스 1개 제거.
-- 추가/정리 작업이라 RLS·접근 로직에는 영향 없음. (라이브 적용됨 — 저장소 추적용)
CREATE INDEX IF NOT EXISTS idx_alarm_sound_prefs_custom_sound_id ON public.alarm_sound_prefs(custom_sound_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id ON public.comment_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_author_id ON public.comments(author_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON public.comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_custom_sounds_recorded_by ON public.custom_sounds(recorded_by);
CREATE INDEX IF NOT EXISTS idx_effect_tracking_queue_sound_id ON public.effect_tracking_queue(sound_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_logged_by ON public.exercise_logs(logged_by);
CREATE INDEX IF NOT EXISTS idx_med_logs_logged_by ON public.med_logs(logged_by);
CREATE INDEX IF NOT EXISTS idx_med_logs_medication_id ON public.med_logs(medication_id);
CREATE INDEX IF NOT EXISTS idx_media_logs_logged_by ON public.media_logs(logged_by);
CREATE INDEX IF NOT EXISTS idx_media_logs_patient_id ON public.media_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_appointments_patient_id ON public.medical_appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_record_medications_medical_record_id ON public.medical_record_medications(medical_record_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient_id ON public.medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_medications_patient_id ON public.medications(patient_id);
CREATE INDEX IF NOT EXISTS idx_missed_med_sound_prefs_first_sound_id ON public.missed_med_sound_prefs(first_sound_id);
CREATE INDEX IF NOT EXISTS idx_missed_med_sound_prefs_second_sound_id ON public.missed_med_sound_prefs(second_sound_id);
CREATE INDEX IF NOT EXISTS idx_on_off_logs_logged_by ON public.on_off_logs(logged_by);
CREATE INDEX IF NOT EXISTS idx_patient_group_members_user_id ON public.patient_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON public.post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON public.posts(author_id);
CREATE INDEX IF NOT EXISTS idx_symptom_notes_patient_id ON public.symptom_notes(patient_id);

DROP INDEX IF EXISTS public.notification_logs_user_id_created_at_idx;
