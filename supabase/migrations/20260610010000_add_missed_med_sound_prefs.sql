-- 약 미복용 알림 전용 알림음 설정 (환자 본인 전역, 시각별 아님)
-- 1차(복용시간+10분)·2차(+20분)를 각각 따로 지정. null=기본음.
CREATE TABLE IF NOT EXISTS public.missed_med_sound_prefs (
  user_id        uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  first_sound_id  uuid REFERENCES public.custom_sounds(id) ON DELETE SET NULL,
  second_sound_id uuid REFERENCES public.custom_sounds(id) ON DELETE SET NULL,
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE public.missed_med_sound_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own missed med sound prefs"
  ON public.missed_med_sound_prefs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own missed med sound prefs"
  ON public.missed_med_sound_prefs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own missed med sound prefs"
  ON public.missed_med_sound_prefs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own missed med sound prefs"
  ON public.missed_med_sound_prefs
  FOR DELETE
  USING (auth.uid() = user_id);
