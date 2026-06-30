-- medications.daily_count: 1일 복용 횟수(처방전 OCR에서 추출한 "1일 N회"의 N).
-- 슬롯 배정과 무관하게 약 자체가 보유하는 정보. 슬롯 약넣기 화면에서
-- "1일 N회 중 M개 슬롯 배정됨" 가이드 계산에 사용한다(빠뜨림 방지).
-- 불명확하면 NULL(가이드는 "배정: M개 슬롯"로 표기).
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS daily_count int NULL;

COMMENT ON COLUMN public.medications.daily_count IS '1일 복용 횟수(처방전 OCR 추출). NULL=불명확. 슬롯 자동배정에는 사용하지 않음.';
