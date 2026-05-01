-- =============================================
-- 카카오 SDK 도입 마이그레이션
-- =============================================
-- public.users 테이블 점검:
--   ✓ kakao_id text unique  → 이미 존재 (supabase_schema.sql L13)
--
-- 본 마이그레이션은 카카오 SDK 도입에 따라 선택적으로 추가할 수 있는
-- nickname / profile_image_url 컬럼을 추가합니다.
--
-- ⚠️ 현재 Edge Function(kakao-auth)은 nickname을 public.users.name 으로,
--    profile_image_url을 auth.users.user_metadata.profile_image_url 으로 저장합니다.
--    따라서 아래 컬럼 추가는 "필수 아님". 향후 프로필 화면에서 활용 시 적용하세요.
-- =============================================

-- nickname / profile_image_url 컬럼 (선택 적용)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

-- kakao_id 인덱스 (이미 unique 제약으로 인덱스가 자동 생성되지만 명시적 보강)
CREATE INDEX IF NOT EXISTS idx_users_kakao_id ON public.users (kakao_id);
