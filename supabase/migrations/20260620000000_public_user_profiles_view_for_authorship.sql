-- 커뮤니티 작성자 이름 공개 경로 (회귀 수정)
-- 배경: 2026-05-28 security_hardening.sql 의 users SELECT RLS(본인/같은 환자그룹)로
--   author:users(name) 조인이 타 그룹/미연동 사용자에게 null → 게시글/댓글 작성자가 "알 수 없음".
--   게스트(anon)는 이름이 보이는데 로그인 회원은 못 보는 역전 상태였음.
--
-- 결정: 작성자 표시 정보(id·name·role)만 모든 로그인 회원+게스트에게 공개.
--   민감정보(kakao_id/push_token/birth_year/gender/diagnosis_year 등)는 계속 차단.
--
-- 핵심 제약: authenticated 는 본인 프로필 편집 등에서 users 를 select * 로 읽으므로,
--   authenticated 에 USING(true) 정책을 추가하면 select * 로 전 유저 민감정보가 노출됨 → 금지.
--   따라서 users 테이블의 기존 RLS·컬럼 노출은 일절 건드리지 않고,
--   컬럼을 구조적으로 통제하는 별도 경로(뷰)로만 이름을 공개한다.
--
-- 안전성 근거:
--   - 뷰는 postgres 소유 + security_invoker = off(기본) → 뷰 소유자 권한으로 underlying users RLS 우회.
--   - 그러나 SELECT 목록이 id·name·role 3컬럼뿐이라 민감컬럼은 구조적으로 노출 불가
--     (PostgREST 에서 public_user_profiles.kakao_id 등 요청 시 42703 컬럼 없음).
--   - users 테이블 RLS(users_select_self_or_group)와 컬럼 GRANT 는 변경하지 않음 →
--     authenticated 가 users 를 직접 select * 해도 여전히 타인 민감정보 못 봄.
--   - posts.author_id / comments.author_id → users(id) FK 가 존재하므로 PostgREST 가
--     author:public_user_profiles(name) 임베드를 자동 추론 (검증 완료).

CREATE OR REPLACE VIEW public.public_user_profiles
WITH (security_invoker = off)
AS
  SELECT u.id, u.name, u.role
  FROM public.users u;

ALTER VIEW public.public_user_profiles OWNER TO postgres;

-- 모든 로그인 회원 + 게스트(anon) 에게 작성자 이름이 보이도록
GRANT SELECT ON public.public_user_profiles TO authenticated, anon;

COMMENT ON VIEW public.public_user_profiles IS
  '커뮤니티 작성자 표시용 안전 공개 뷰. id·name·role 3컬럼만 노출(민감컬럼 없음). security_invoker=off 라 users RLS 우회. posts/comments.author_id 임베드용.';

-- PostgREST 스키마 캐시 리로드 (새 뷰/관계 인식)
NOTIFY pgrst, 'reload schema';
