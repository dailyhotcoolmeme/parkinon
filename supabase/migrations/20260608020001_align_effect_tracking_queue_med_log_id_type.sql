-- =====================================================================
-- 약 복용 모델 재설계 3단계 — effect_tracking_queue.med_log_id 타입 정합화
-- 근거: docs/medication_dose_model_redesign_spec.md §9-1(⚠️drift), §8
--
-- 문제(drift): effect_tracking_queue.med_log_id = text 이나
--   med_logs.id = uuid. 신규 큐 식별 기준(med_log_id 1:1)을 안전하게 쓰려면
--   타입 정합 필요.
--
-- 안전성 검증(2026-06-08, 라이브 SELECT):
--   - effect_tracking_queue 총 153행 중 med_log_id 채워진 행 = 0
--     → text→uuid 캐스팅으로 손실될 데이터 없음.
--   - med_log_id에 기존 FK 없음(pkey/dose_slot_id/sound_id FK만 존재).
--
-- 동작: 빈 컬럼이므로 USING NULLIF + ::uuid 캐스팅(빈문자열 방어)으로 안전 전환.
--   이후 med_logs(id) ON DELETE SET NULL FK 부여(복용기록 삭제 시 큐 보존).
--
-- 멱등: 이미 uuid면 ALTER TYPE no-op처럼 동작하도록 DO 가드. FK는 IF NOT EXISTS.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_type text;
BEGIN
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'effect_tracking_queue'
    AND column_name = 'med_log_id';

  IF v_type = 'text' THEN
    -- 빈 문자열을 NULL로 변환 후 uuid 캐스팅 (현재 전 행 NULL이므로 무손실)
    EXECUTE $ddl$
      ALTER TABLE public.effect_tracking_queue
        ALTER COLUMN med_log_id TYPE uuid
        USING NULLIF(med_log_id, '')::uuid
    $ddl$;
  END IF;
END $$;

-- med_logs(id) 참조 FK (복용기록 삭제 시 큐는 보존 → SET NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'effect_tracking_queue_med_log_id_fkey'
      AND conrelid = 'public.effect_tracking_queue'::regclass
  ) THEN
    ALTER TABLE public.effect_tracking_queue
      ADD CONSTRAINT effect_tracking_queue_med_log_id_fkey
      FOREIGN KEY (med_log_id) REFERENCES public.med_logs(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.effect_tracking_queue.med_log_id IS
  '복용기록 1:1 식별(신규 dose_slot 경로 중복제거 기준). med_logs(id) uuid 참조.';

COMMIT;
