-- Phase1-M1 (S0): users.timezone 신설.
-- 해외 출시 대비 사용자별 IANA 타임존 저장 컬럼.
-- 기존/국내 회귀 0을 위해 NOT NULL + DEFAULT 'Asia/Seoul'.
-- 기존 행은 DEFAULT로 자동 'Asia/Seoul' 백필됨(별도 UPDATE 불필요).
-- 이 단계는 컬럼 추가만 하며, 읽는 서버/클라 로직은 아직 없음(S2/S3에서 사용).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Seoul';
