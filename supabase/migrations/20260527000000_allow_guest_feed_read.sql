-- 게스트(anon) 게시글·댓글·뉴스피드·작성자 정보 조회 허용
-- 기존 인증 유저 정책은 유지하고, anon 역할용 SELECT 정책만 신설한다.
-- users 테이블은 민감 컬럼이 많아 컬럼 단위 GRANT 로 안전 컬럼만 노출한다.

-- ============================================================
-- 1) posts
-- ============================================================
GRANT SELECT ON public.posts TO anon;

DROP POLICY IF EXISTS "guest_select_posts" ON public.posts;
CREATE POLICY "guest_select_posts" ON public.posts
  FOR SELECT TO anon USING (true);

-- ============================================================
-- 2) comments
-- ============================================================
GRANT SELECT ON public.comments TO anon;

DROP POLICY IF EXISTS "guest_select_comments" ON public.comments;
CREATE POLICY "guest_select_comments" ON public.comments
  FOR SELECT TO anon USING (true);

-- ============================================================
-- 3) news_feed
-- ============================================================
GRANT SELECT ON public.news_feed TO anon;

DROP POLICY IF EXISTS "guest_select_news_feed" ON public.news_feed;
CREATE POLICY "guest_select_news_feed" ON public.news_feed
  FOR SELECT TO anon USING (true);

-- ============================================================
-- 4) post_media
-- ============================================================
GRANT SELECT ON public.post_media TO anon;

DROP POLICY IF EXISTS "guest_select_post_media" ON public.post_media;
CREATE POLICY "guest_select_post_media" ON public.post_media
  FOR SELECT TO anon USING (true);

-- ============================================================
-- 5) users (안전 컬럼만 노출: id, name, role, created_at)
--    민감 컬럼 (kakao_id, push_token, birth_year, gender,
--    caregiver_relation, residence_type, diagnosis_year,
--    patient_group_id, *_notif_prefs, meal_schedules,
--    relation_note, sensitive_info_consented 등) 은 GRANT 제외
-- ============================================================
-- 중요: Supabase 기본 설정에서 anon 은 public 스키마 모든 테이블에 대해
-- 테이블 레벨 SELECT 권한을 보유하고 있어, 그대로 두면 RLS 만 열렸을 때
-- 모든 컬럼이 노출된다. anon 의 users 테이블 레벨 SELECT 를 회수한 뒤
-- 컬럼 단위로만 다시 부여한다. (authenticated 권한은 영향 없음)
REVOKE SELECT ON public.users FROM anon;
GRANT SELECT (id, name, role, created_at) ON public.users TO anon;

DROP POLICY IF EXISTS "guest_select_users_safe" ON public.users;
CREATE POLICY "guest_select_users_safe" ON public.users
  FOR SELECT TO anon USING (true);
