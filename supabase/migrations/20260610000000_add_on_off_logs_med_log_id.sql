-- 약 복용 모델 7단계 선결 버그 수정용 스키마 보강 (비파괴)
-- 목적: on_off_logs(약효추적 기록)에 어느 복용(med_logs)의 약효인지 1:1로 붙이는
--       med_log_id 컬럼 추가. 이미 dose_slot_id는 20260608000000에서 추가됨.
--       med_log_id가 채워지면 "이 약효 기록 = 이 복용 직후/N분 후"가 명확해져
--       슬롯별/복용별 통계가 정확해진다.
--
-- 안전성:
--   - NULL 허용 (미이관·수동 입력 경로는 NULL — 깨지지 않음)
--   - FK ON DELETE SET NULL: 복용기록(med_logs)이 취소/삭제돼도 약효기록은 보존,
--     med_log_id만 NULL로 — 고아 참조 방지 + 약효 데이터 유실 방지.
--   - IF NOT EXISTS로 멱등.

ALTER TABLE public.on_off_logs
  ADD COLUMN IF NOT EXISTS med_log_id uuid
  REFERENCES public.med_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_on_off_logs_med_log_id
  ON public.on_off_logs(med_log_id);

COMMENT ON COLUMN public.on_off_logs.med_log_id IS
  '약효추적 기록이 어느 복용(med_logs)에 대한 것인지 1:1 매칭. 미이관/수동은 NULL.';
