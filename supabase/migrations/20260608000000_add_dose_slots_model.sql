-- =====================================================================
-- 약 복용 모델 재설계 1단계 — 비파괴 DB 스키마 추가 (parkinon)
-- 근거: docs/medication_dose_model_redesign_spec.md §8(구현 설계 핵심), §9-1
--
-- 범위(오직 추가): dose_slots / medication_dose_slots 신규 테이블,
--   med_logs.dose_slot_id, on_off_logs.dose_slot_id,
--   effect_tracking_queue.dose_slot_id(+sound_id 멱등 가드).
-- 기존 컬럼/함수/RPC 무변경. 데이터 이관 없음(2단계). 전부 IF NOT EXISTS 멱등.
--
-- RLS: medications 정책 패턴 그대로 따름
--   (환자 본인 = patient_id = auth.uid(), 보호자 read = is_same_group()).
-- =====================================================================

BEGIN;

-- ─── 1) dose_slots : 환자 단위 복용 시각 리스트(단일 출처) ───────────────────────
CREATE TABLE IF NOT EXISTS public.dose_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  time            time NOT NULL,
  label           text,
  sort_order      int  NOT NULL DEFAULT 0,
  remind_enabled  boolean NOT NULL DEFAULT true,
  remind_sound_id text,
  track_enabled   boolean NOT NULL DEFAULT true,
  track_intervals int[] NOT NULL DEFAULT '{0,30,120}',
  track_sound_id  text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dose_slots_patient_active
  ON public.dose_slots(patient_id) WHERE is_active;

COMMENT ON TABLE  public.dose_slots IS '환자 단위 복용 시각 리스트(세트). 복용 알림 + 약효추적 설정 1세트';
COMMENT ON COLUMN public.dose_slots.track_intervals IS '약효추적 시각(분). 0=복용 직후, 30=30분 후 등';

-- updated_at 자동 갱신 트리거 (update_updated_at() 기존 함수 재사용)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_updated_at' AND p.pronargs=0
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname='trg_dose_slots_updated_at'
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_dose_slots_updated_at BEFORE UPDATE ON public.dose_slots
             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()';
  END IF;
END $$;

ALTER TABLE public.dose_slots ENABLE ROW LEVEL SECURITY;

-- medications 패턴 그대로: 환자 본인 read + 같은 그룹 보호자 read
DROP POLICY IF EXISTS "dose_slots: 환자 본인 read" ON public.dose_slots;
CREATE POLICY "dose_slots: 환자 본인 read"
  ON public.dose_slots FOR SELECT TO authenticated
  USING (patient_id = auth.uid());

DROP POLICY IF EXISTS "dose_slots: 같은 그룹 보호자 read" ON public.dose_slots;
CREATE POLICY "dose_slots: 같은 그룹 보호자 read"
  ON public.dose_slots FOR SELECT TO authenticated
  USING (is_same_group(auth.uid(), patient_id));

-- 쓰기: 환자 본인 + 같은 그룹 보호자 (보호자→환자 쓰기 허용; 약시간표 대리 설정)
DROP POLICY IF EXISTS "dose_slots: insert" ON public.dose_slots;
CREATE POLICY "dose_slots: insert"
  ON public.dose_slots FOR INSERT TO authenticated
  WITH CHECK (patient_id = auth.uid() OR is_same_group(auth.uid(), patient_id));

DROP POLICY IF EXISTS "dose_slots: update" ON public.dose_slots;
CREATE POLICY "dose_slots: update"
  ON public.dose_slots FOR UPDATE TO authenticated
  USING (patient_id = auth.uid() OR is_same_group(auth.uid(), patient_id))
  WITH CHECK (patient_id = auth.uid() OR is_same_group(auth.uid(), patient_id));

DROP POLICY IF EXISTS "dose_slots: delete" ON public.dose_slots;
CREATE POLICY "dose_slots: delete"
  ON public.dose_slots FOR DELETE TO authenticated
  USING (patient_id = auth.uid() OR is_same_group(auth.uid(), patient_id));

-- ─── 2) medication_dose_slots : 약 ↔ 복용시각 M:N ────────────────────────────
CREATE TABLE IF NOT EXISTS public.medication_dose_slots (
  medication_id uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  dose_slot_id  uuid NOT NULL REFERENCES public.dose_slots(id)  ON DELETE CASCADE,
  PRIMARY KEY (medication_id, dose_slot_id)
);

CREATE INDEX IF NOT EXISTS idx_medication_dose_slots_slot
  ON public.medication_dose_slots(dose_slot_id);

COMMENT ON TABLE public.medication_dose_slots IS '약 ↔ 복용시각(dose_slot) M:N 배정';

ALTER TABLE public.medication_dose_slots ENABLE ROW LEVEL SECURITY;

-- medications와 동일 접근: 부모 medication 행에 대한 medications RLS 가시성으로 게이트
-- (medication_features → measurements join 게이트 선례와 동일 구조)
DROP POLICY IF EXISTS "medication_dose_slots: read" ON public.medication_dose_slots;
CREATE POLICY "medication_dose_slots: read"
  ON public.medication_dose_slots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medications m
      WHERE m.id = medication_dose_slots.medication_id
        AND (m.patient_id = auth.uid() OR is_same_group(auth.uid(), m.patient_id))
    )
  );

DROP POLICY IF EXISTS "medication_dose_slots: insert" ON public.medication_dose_slots;
CREATE POLICY "medication_dose_slots: insert"
  ON public.medication_dose_slots FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medications m
      WHERE m.id = medication_dose_slots.medication_id
        AND (m.patient_id = auth.uid() OR is_same_group(auth.uid(), m.patient_id))
    )
  );

DROP POLICY IF EXISTS "medication_dose_slots: delete" ON public.medication_dose_slots;
CREATE POLICY "medication_dose_slots: delete"
  ON public.medication_dose_slots FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medications m
      WHERE m.id = medication_dose_slots.medication_id
        AND (m.patient_id = auth.uid() OR is_same_group(auth.uid(), m.patient_id))
    )
  );

-- ─── 3) med_logs.dose_slot_id ────────────────────────────────────────────────
ALTER TABLE public.med_logs
  ADD COLUMN IF NOT EXISTS dose_slot_id uuid
    REFERENCES public.dose_slots(id) ON DELETE SET NULL;

-- meal_time NOT NULL 완화 (legacy 슬롯 enum, dose_slot 기반에서는 nullable)
ALTER TABLE public.med_logs ALTER COLUMN meal_time DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_med_logs_dose_slot
  ON public.med_logs(dose_slot_id);

-- ─── 4) on_off_logs.dose_slot_id (슬롯별 통계 재설계용) ──────────────────────
ALTER TABLE public.on_off_logs
  ADD COLUMN IF NOT EXISTS dose_slot_id uuid
    REFERENCES public.dose_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_on_off_logs_dose_slot
  ON public.on_off_logs(dose_slot_id);

-- ─── 5) effect_tracking_queue.dose_slot_id + sound_id 멱등 가드 ──────────────
ALTER TABLE public.effect_tracking_queue
  ADD COLUMN IF NOT EXISTS dose_slot_id uuid
    REFERENCES public.dose_slots(id) ON DELETE SET NULL;

-- sound_id: DB 직접추가로 drift 상태일 수 있음(현재 uuid로 존재). 멱등 no-op.
ALTER TABLE public.effect_tracking_queue
  ADD COLUMN IF NOT EXISTS sound_id text;

CREATE INDEX IF NOT EXISTS idx_effect_tracking_queue_dose_slot
  ON public.effect_tracking_queue(dose_slot_id);

CREATE INDEX IF NOT EXISTS idx_effect_tracking_queue_med_log
  ON public.effect_tracking_queue(med_log_id);

COMMIT;
