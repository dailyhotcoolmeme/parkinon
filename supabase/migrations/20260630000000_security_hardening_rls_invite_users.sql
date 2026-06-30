-- ============================================================================
-- 파킨온 보안 강화 마이그레이션 (멱등)
-- 목표: RLS/권한 구멍 차단하되 신규가입/가족연동/피드 정상 흐름 보존.
-- (프로덕션 ref avqaflxufyadgzjiojkk 에 apply_migration 으로 이미 적용됨 —
--  본 파일은 동일 내용의 형상관리용. 재실행해도 안전.)
-- ============================================================================

-- ── 0) patient_groups: created_by 추가 + invite_code 컬럼 확장 ──────────────
-- created_by: INSERT...RETURNING(return=representation) 시 "방금 만든 그룹"을
--   생성자가 읽을 수 있게 (멤버십 INSERT 이전이라 멤버-read 정책으로는 안 보임).
ALTER TABLE public.patient_groups ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.patient_groups ALTER COLUMN created_by SET DEFAULT auth.uid();

-- invite_code char(6) -> varchar(12) (8자리 코드 수용, 멱등)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='patient_groups'
      AND column_name='invite_code'
      AND (data_type='character' OR character_maximum_length IS NULL OR character_maximum_length < 12)
  ) THEN
    ALTER TABLE public.patient_groups
      ALTER COLUMN invite_code TYPE varchar(12) USING NULLIF(trim(invite_code), '');
  END IF;
END $$;

-- ── 정책/트리거가 참조하는 SECURITY DEFINER 헬퍼 (RLS 우회) ──────────────────
-- "p_gid 가 NULL, 또는 p_uid 가 이미 멤버, 또는 그 그룹에 p_uid 외 다른 멤버가
--  없을 때" true. (남의 그룹에 끼어들기 차단 / 본인 빈·단독 그룹은 허용)
CREATE OR REPLACE FUNCTION public._pgm_user_can_adopt_group(p_uid uuid, p_gid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p_gid IS NULL
     OR EXISTS (SELECT 1 FROM patient_group_members WHERE group_id = p_gid AND user_id = p_uid)
     OR NOT EXISTS (SELECT 1 FROM patient_group_members WHERE group_id = p_gid AND user_id <> p_uid);
$$;
REVOKE ALL ON FUNCTION public._pgm_user_can_adopt_group(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._pgm_user_can_adopt_group(uuid, uuid) TO authenticated;

-- ── 🔴1) patient_group_members INSERT: 본인 + 빈/단독 그룹만 ─────────────────
-- 남의(이미 다른 멤버가 있는) 그룹에 자기삽입 차단. 신규 그룹 생성 후 self 추가
-- (빈 그룹) + 멱등 재시도(자기 행만 존재)는 허용. 보호자 합류는 SECURITY DEFINER
-- join_family_by_code(RLS 우회)가 처리.
-- ※ with_check 가 patient_group_members 를 직접 서브쿼리하면 RLS 무한재귀가 나므로
--   반드시 DEFINER 헬퍼(_pgm_user_can_adopt_group)로 평가한다.
DROP POLICY IF EXISTS pgm_insert_auth ON public.patient_group_members;
DROP POLICY IF EXISTS pgm_insert_self_empty_group ON public.patient_group_members;
CREATE POLICY pgm_insert_self_empty_group ON public.patient_group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public._pgm_user_can_adopt_group(user_id, group_id)
  );

-- ── 🔴2) public_user_profiles 뷰: 쓰기 권한 회수(SELECT만 유지) ──────────────
-- 단순뷰는 updatable → anon/authenticated 가 RLS 우회로 users 변조 가능했음.
-- 피드 작성자 이름/역할 표시를 위해 SELECT(id,name,role)만 유지.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_user_profiles FROM anon, authenticated;

-- ── 🔴3) patient_groups SELECT: 광범위 "초대코드 조회" 제거 ──────────────────
-- 코드->그룹 조회는 DEFINER RPC(lookup_group_id_by_invite_code,
-- get_invite_patient_masked_name, join_family_by_code)가 처리.
-- 본인 그룹(멤버) + 본인이 방금 생성한 그룹(created_by)만 SELECT 허용.
DROP POLICY IF EXISTS "patient_groups: 초대코드 조회" ON public.patient_groups;
DROP POLICY IF EXISTS "patient_groups: 멤버 read" ON public.patient_groups;
CREATE POLICY "patient_groups: 멤버 read" ON public.patient_groups
  FOR SELECT TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.patient_group_members m
      WHERE m.group_id = patient_groups.id AND m.user_id = (SELECT auth.uid())
    )
  );

-- INSERT 정책: created_by 스푸핑 방지(기본값이 auth.uid()라 정상 흐름은 통과)
DROP POLICY IF EXISTS "patient_groups: 인증 유저 insert" ON public.patient_groups;
CREATE POLICY "patient_groups: 인증 유저 insert" ON public.patient_groups
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND created_by = (SELECT auth.uid()));

-- ── 🟡4) 초대코드 강화: 만료 강제 + 시도 제한 ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_join_attempts (
  uid uuid PRIMARY KEY,
  fail_count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.family_join_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_join_attempts FROM anon, authenticated;

-- 코드->그룹id 조회 RPC (FamilyCheckScreen 직접 SELECT 대체, 만료 강제)
CREATE OR REPLACE FUNCTION public.lookup_group_id_by_invite_code(p_code text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id FROM patient_groups
  WHERE invite_code = p_code
    AND invite_code_expires_at IS NOT NULL
    AND invite_code_expires_at > now()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.lookup_group_id_by_invite_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lookup_group_id_by_invite_code(text) TO authenticated;

-- 마스킹 환자명 RPC: 만료 강제(NULL=영구 금지)
CREATE OR REPLACE FUNCTION public.get_invite_patient_masked_name(p_code text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN char_length(u.name) <= 1 THEN u.name
    WHEN char_length(u.name) = 2 THEN left(u.name, 1) || '*'
    ELSE left(u.name, 1) || repeat('*', char_length(u.name) - 2) || right(u.name, 1)
  END
  FROM patient_groups pg
  JOIN patient_group_members pgm ON pgm.group_id = pg.id AND pgm.role = 'patient'
  JOIN users u ON u.id = pgm.user_id
  WHERE pg.invite_code = p_code
    AND pg.invite_code_expires_at IS NOT NULL
    AND pg.invite_code_expires_at > now()
  LIMIT 1;
$$;

-- join_family_by_code: 만료 강제 + 시도 제한(10회/10분/유저). 기존 로직 보존.
CREATE OR REPLACE FUNCTION public.join_family_by_code(p_code text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_my_role       text;
  v_my_group      uuid;
  v_target_group  uuid;
  v_target_has_patient   boolean;
  v_my_group_has_patient boolean;
  v_caregiver     record;
  v_fail          int;
  v_win           timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'error', 'message', '로그인이 필요해요.');
  END IF;

  -- ── 시도 제한(brute-force 방어): 10분 창에서 invalid_code 10회 초과 차단 ──
  INSERT INTO family_join_attempts(uid) VALUES (v_uid) ON CONFLICT (uid) DO NOTHING;
  SELECT fail_count, window_start INTO v_fail, v_win
    FROM family_join_attempts WHERE uid = v_uid FOR UPDATE;
  IF v_win < now() - interval '10 minutes' THEN
    UPDATE family_join_attempts SET fail_count = 0, window_start = now(), updated_at = now()
      WHERE uid = v_uid;
    v_fail := 0;
  END IF;
  IF v_fail >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited',
      'message', '시도가 너무 많아요. 잠시 후 다시 시도해주세요.');
  END IF;

  -- 입력자 정보
  SELECT role, patient_group_id INTO v_my_role, v_my_group
  FROM users WHERE id = v_uid;

  -- ── 사실 1: 발급 그룹 (유효+미만료, 만료 강제) ──
  SELECT id INTO v_target_group
  FROM patient_groups
  WHERE invite_code = p_code
    AND invite_code_expires_at IS NOT NULL
    AND invite_code_expires_at > now()
  LIMIT 1;

  IF v_target_group IS NULL THEN
    UPDATE family_join_attempts SET fail_count = fail_count + 1, updated_at = now()
      WHERE uid = v_uid;
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_code',
      'message', '유효하지 않은 코드예요. 다시 확인해주세요.');
  END IF;

  -- 이미 같은 그룹
  IF v_my_group IS NOT NULL AND v_my_group = v_target_group THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_member',
      'message', '이미 연동된 가족이에요.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM patient_group_members
    WHERE group_id = v_target_group AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_member',
      'message', '이미 연동된 가족이에요.');
  END IF;

  -- ── 사실 2/3: 환자 유무 ──
  v_target_has_patient := EXISTS (
    SELECT 1 FROM patient_group_members
    WHERE group_id = v_target_group AND role = 'patient');
  v_my_group_has_patient := v_my_group IS NOT NULL AND EXISTS (
    SELECT 1 FROM patient_group_members
    WHERE group_id = v_my_group AND role = 'patient');

  -- 분기 A: 입력자가 환자
  IF v_my_role = 'patient' THEN
    IF v_target_has_patient THEN
      RETURN jsonb_build_object('ok', false, 'code', 'two_patients',
        'message', '환자 두 분은 한 가족으로 묶을 수 없어요. 환자 한 분을 중심으로 보호자들이 함께 연결돼요.');
    END IF;

    IF v_my_group_has_patient THEN
      FOR v_caregiver IN
        SELECT user_id FROM patient_group_members
        WHERE group_id = v_target_group AND role = 'caregiver'
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM patient_group_members
          WHERE group_id = v_my_group AND user_id = v_caregiver.user_id
        ) THEN
          UPDATE patient_group_members
            SET group_id = v_my_group
            WHERE group_id = v_target_group AND user_id = v_caregiver.user_id;
          UPDATE users
            SET patient_group_id = v_my_group
            WHERE id = v_caregiver.user_id;
        ELSE
          DELETE FROM patient_group_members
            WHERE group_id = v_target_group AND user_id = v_caregiver.user_id;
        END IF;
      END LOOP;

      IF NOT EXISTS (SELECT 1 FROM patient_group_members WHERE group_id = v_target_group) THEN
        DELETE FROM patient_groups WHERE id = v_target_group;
      END IF;

      UPDATE family_join_attempts SET fail_count = 0, window_start = now(), updated_at = now()
        WHERE uid = v_uid;
      RETURN jsonb_build_object('ok', true, 'code', 'merged_caregivers',
        'message', '가족 연동이 완료됐어요.');
    END IF;

    PERFORM _fl_move_self_into_group(v_uid, v_target_group, v_my_group, 'patient');
    UPDATE family_join_attempts SET fail_count = 0, window_start = now(), updated_at = now()
      WHERE uid = v_uid;
    RETURN jsonb_build_object('ok', true, 'code', 'joined',
      'message', '가족 연동이 완료됐어요.');
  END IF;

  -- 분기 B: 입력자가 보호자 (또는 role 미설정)
  IF v_my_group_has_patient AND NOT p_force THEN
    RETURN jsonb_build_object('ok', false, 'code', 'need_confirm_switch',
      'message', '지금 다른 가족과 연결돼 있어요. 새 가족으로 바꾸면 기존 연결이 끊겨요. 바꾸시겠어요?');
  END IF;

  PERFORM _fl_move_self_into_group(v_uid, v_target_group, v_my_group, COALESCE(v_my_role, 'caregiver'));
  UPDATE family_join_attempts SET fail_count = 0, window_start = now(), updated_at = now()
    WHERE uid = v_uid;
  RETURN jsonb_build_object('ok', true, 'code', 'joined',
    'message', '가족 연동이 완료됐어요.');

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'two_patients',
      'message', '환자 두 분은 한 가족으로 묶을 수 없어요. 환자 한 분을 중심으로 보호자들이 함께 연결돼요.');
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'code', 'error',
      'message', '연동 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
END;
$function$;

-- ── 🟡5) users 보호 컬럼(role/banned/patient_group_id) 변조 차단 트리거 ──────
-- 직접 REST PATCH(current_user='authenticated')에만 적용.
-- 신뢰된 SECURITY DEFINER RPC(join/admin 등, current_user='postgres') 경유는 통과.
CREATE OR REPLACE FUNCTION public.enforce_users_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF NEW.banned IS DISTINCT FROM OLD.banned
       OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
       OR NEW.banned_reason IS DISTINCT FROM OLD.banned_reason THEN
      RAISE EXCEPTION 'banned 상태는 사용자가 변경할 수 없습니다';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role AND COALESCE(OLD.onboarding_done, false) THEN
      RAISE EXCEPTION 'role 은 온보딩 완료 후 변경할 수 없습니다';
    END IF;
    IF NEW.patient_group_id IS DISTINCT FROM OLD.patient_group_id
       AND NOT public._pgm_user_can_adopt_group(NEW.id, NEW.patient_group_id) THEN
      RAISE EXCEPTION 'patient_group_id 는 본인이 속한 그룹만 가리킬 수 있습니다';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_users_protected_columns ON public.users;
CREATE TRIGGER trg_enforce_users_protected_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_users_protected_columns();

-- ── 🟡6) 트리거 전용 SECURITY DEFINER 함수 EXECUTE 회수(advisor 정리) ────────
-- 트리거는 EXECUTE 권한과 무관하게 동작 → 직접 RPC 노출만 제거.
REVOKE EXECUTE ON FUNCTION public.sync_comment_like_count() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_comment_count() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_like_count() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_medication_on_dose_slot_change() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_effect_queue_on_dose_slot_deactivate() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_hide_on_report_threshold() FROM public, anon, authenticated;
