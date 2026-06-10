-- =====================================================================
-- 백엔드 보안 종합 강화 마이그레이션 (parkinon)
--
-- 다루는 항목:
--   C4: users RLS 축소 — 전체 인증유저 read 제거, 본인 + 같은 환자그룹 멤버 한정
--   H3: SECURITY DEFINER 함수의 anon EXECUTE 권한 회수
--   M1: trigger / RPC 함수에 search_path 보강
--   M5: users UPDATE 정책에 WITH CHECK 추가
--   M6: medications 보호자 UPDATE/DELETE 권한 회수 (조회만 가능)
--   M7: anon 의 INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 권한 회수
--       (게스트 SELECT 가 명시 허용된 테이블에 한해 anon SELECT 만 유지)
--
-- 절대 보존 사항:
--   - 게스트 모드 피드 조회 정책 (posts/comments/post_media/news_feed:
--     guest_select_*  policies) — 직전 작업으로 추가된 정책 유지
--   - 동작 중인 기능(약 복용·몸상태·운동·측정·피드 등) 정상 동작
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- M7: anon GRANT 정리
-- 전체 public 테이블에 대해 anon 의 쓰기 권한(INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER) 회수. SELECT 는 회수하지 않음 (기존 정상 anon SELECT
-- 정책이 있는 테이블만 RLS 가 가드).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon',
      r.tablename
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- M7-extra: anon SELECT 권한도 명시적으로 정리.
-- guest_select_* 정책이 존재하는 테이블은 SELECT 유지, 그 외 회수.
-- ---------------------------------------------------------------------
-- 게스트 SELECT 허용 테이블 (직전 작업으로 정의됨):
--   news_feed, posts, comments, post_media
-- 그 외 테이블에서는 anon SELECT 회수.
DO $$
DECLARE
  r RECORD;
  guest_allowed TEXT[] := ARRAY[
    'news_feed','posts','comments','post_media'
  ];
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> ALL (guest_allowed)
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', r.tablename);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- C4: users 테이블 RLS 축소
-- ---------------------------------------------------------------------
-- 전체 인증유저 read 정책 제거
DROP POLICY IF EXISTS "users: 인증 유저 read" ON public.users;
-- 게스트용 정책 제거 (anon 에 SELECT GRANT 가 사라졌으므로 동작 안 하지만
-- 미래 위험 차단을 위해 정책 자체도 삭제)
DROP POLICY IF EXISTS guest_select_users_safe ON public.users;
-- 중복 select 정책도 제거 후 단일화
DROP POLICY IF EXISTS users_select_own ON public.users;

CREATE POLICY users_select_self_or_group
  ON public.users
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR is_same_patient_group(id)
  );

-- M5: users UPDATE 정책 WITH CHECK 추가 + 정책 정리
-- 본인 update 정책: 기존 with_check 보강 (이미 같음)
DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- "같은 그룹 보호자 update" 정책 — 환자 본인 데이터를 보호자가 수정하는 흐름은
-- 위험. 현재 with_check 가 NULL 이라 검증 없이 임의 컬럼 변경 가능했음.
-- 안전 default: 정책 자체 제거. (보호자가 환자 정보를 바꿔야 하는 흐름이
-- 필요해지면 별도 SECURITY DEFINER RPC 로 화이트리스트 컬럼만 허용).
DROP POLICY IF EXISTS "users: 같은 그룹 보호자 update" ON public.users;

-- ---------------------------------------------------------------------
-- M6: medications 보호자 UPDATE/DELETE 제한 — 조회만 가능
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "medications: update" ON public.medications;
DROP POLICY IF EXISTS "medications: delete" ON public.medications;

CREATE POLICY medications_update_self
  ON public.medications
  FOR UPDATE
  TO authenticated
  USING (patient_id = auth.uid())
  WITH CHECK (patient_id = auth.uid());

CREATE POLICY medications_delete_self
  ON public.medications
  FOR DELETE
  TO authenticated
  USING (patient_id = auth.uid());

-- ---------------------------------------------------------------------
-- H3: SECURITY DEFINER 함수 anon EXECUTE 권한 회수
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.disconnect_family_group(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.disconnect_family_group(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_view_count(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_view_count(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_same_group(uuid, uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_same_group(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_same_patient_group(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_same_patient_group(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- M1: SECURITY DEFINER 트리거 함수 search_path 보강
-- (보유 트리거 함수 중 search_path 가 NULL 인 것)
-- ---------------------------------------------------------------------
ALTER FUNCTION public.sync_post_like_count()    SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_comment_like_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_post_comment_count() SET search_path = public, pg_temp;

-- M1-extra: SECURITY DEFINER 가 아닌 일반 함수도 안정성 향상 차원에서 search_path 고정.
-- update_updated_at, set_ended_at_on_deactivate, get_meds_at_time
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'set_ended_at_on_deactivate'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.set_ended_at_on_deactivate() SET search_path = public, pg_temp';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_meds_at_time'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.get_meds_at_time(text) SET search_path = public, pg_temp';
  END IF;
END
$$;

COMMIT;
