-- 개발자 일기 마지막 서명 줄을 admin에서 편집 가능하게: signature_ko/en 컬럼 추가.
-- 기존 행(id=1)은 앱에 하드코딩돼 있던 값으로 채워 현행 동작 유지.
ALTER TABLE public.dev_letter
  ADD COLUMN IF NOT EXISTS signature_ko text NOT NULL DEFAULT '2026년 7월 3일(금) 개발자 올림',
  ADD COLUMN IF NOT EXISTS signature_en text NOT NULL DEFAULT 'July 3, 2026 — From the developer';
