-- ─────────────────────────────────────────────────────────────────────────
-- remove_family_member(p_target_user_id uuid)
--   "선택한 상대 1명(1개 링크)만" 가족 연동 해제. (SECURITY DEFINER)
--
-- 버그 배경:
--   기존 클라 leaveGroup() 은 "호출자 본인"을 그룹에서 뺐다. 환자 1 : 보호자 N
--   구조에서 환자가 보호자 A 하나만 해제하려 해도 호출자(환자)가 그룹을 떠나
--   보호자 A·B 링크가 모두 끊기고, 두 보호자는 환자 없는 그룹에 고아로 남았다.
--
-- RLS 제약(왜 RPC 여야 하는가):
--   patient_group_members: pgm_delete_own = user_id = auth.uid() → 남의 멤버십 삭제 불가.
--   users:                 users_update_own = id = auth.uid()   → 남의 patient_group_id null 불가.
--   따라서 "환자가 특정 보호자를 끊는" 교차 삭제는 SECURITY DEFINER RPC 필수.
--
-- 동작(방향별):
--   · 호출자=환자, 대상=보호자 → 그 보호자 1명만 그룹에서 제거(다른 보호자·환자 유지).
--   · 호출자=보호자          → 본인만 그룹에서 나감(환자·다른 보호자 유지).
--                              (보호자는 담당 환자 1명뿐이므로 "환자와 연결 해제" = 본인 이탈)
--   · 마지막 1명까지 빠져 그룹이 비면 빈 그룹 정리.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_family_member(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      uuid := auth.uid();
  v_group       uuid;
  v_caller_role text;
  v_remove_user uuid;
  v_remaining   int;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated',
      'message', '로그인이 필요해요.');
  END IF;

  -- 호출자의 그룹/역할 (한 유저는 하나의 그룹에만 속함)
  SELECT group_id, role INTO v_group, v_caller_role
  FROM patient_group_members
  WHERE user_id = v_caller
  LIMIT 1;

  IF v_group IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_in_group',
      'message', '연동된 가족이 없어요.');
  END IF;

  -- 대상이 같은 그룹 멤버인지 확인 (이미 해제된 경우 방어)
  IF NOT EXISTS (
    SELECT 1 FROM patient_group_members
    WHERE group_id = v_group AND user_id = p_target_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'target_not_in_group',
      'message', '이미 해제된 가족이에요.');
  END IF;

  -- 누구를 그룹에서 뺄지 결정
  IF v_caller_role = 'patient' THEN
    IF p_target_user_id = v_caller THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_target',
        'message', '본인은 해제 대상이 될 수 없어요.');
    END IF;
    -- 환자가 특정 보호자를 해제 → 그 보호자만 제거
    v_remove_user := p_target_user_id;
  ELSE
    -- 보호자가 해제 → 본인만 그룹에서 나감 (환자·다른 보호자 그대로)
    v_remove_user := v_caller;
  END IF;

  -- 딱 그 1명만 제거
  DELETE FROM patient_group_members
  WHERE group_id = v_group AND user_id = v_remove_user;

  UPDATE users
  SET patient_group_id = NULL
  WHERE id = v_remove_user AND patient_group_id = v_group;

  -- 아무도 안 남으면 빈 그룹 정리
  SELECT count(*) INTO v_remaining
  FROM patient_group_members WHERE group_id = v_group;

  IF v_remaining = 0 THEN
    DELETE FROM patient_groups WHERE id = v_group;
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'removed',
    'removed_user_id', v_remove_user,
    'group_deleted', (v_remaining = 0),
    'message', '가족 연결을 해제했어요.');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.remove_family_member(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.remove_family_member(uuid) TO authenticated;
