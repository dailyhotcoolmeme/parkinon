-- ────────────────────────────────────────────────────────────────────────────
-- 역할(환자/보호자) 변경 RPC
--
-- 배경: users.role 은 온보딩 완료 후 트리거(enforce_users_protected_columns)로 잠겨 있다.
--       이 함수는 SECURITY DEFINER(소유자=postgres) 로 실행되어 current_user 가
--       'authenticated' 가 아니므로 그 트리거 가드를 통과한다(신뢰된 경로).
--
-- 규칙:
--   · 보호자 → 환자 : 그룹에 이미 환자가 있으면 불가(환자 2명 금지). 기록 삭제 없음.
--   · 환자 → 보호자 : p_confirm=true 필수. 환자로서 쌓은 "모든" 건강기록을 완전 삭제한 뒤 강등.
--       (오너 결정 2026-07-15: 보관하지 않고 완전 삭제. 앱에서 삭제 전 2단계 경고 + 내려받기 제공.)
--
-- ⚠️ R2 미디어 파일 삭제는 SQL 에서 불가 → 이 RPC 호출 전에 change-role Edge Function 이
--    media_logs.r2_key / diary_entries.audio_r2_key / photo_urls 를 수집해 R2 에서 먼저 지운다.
--
-- 삭제 집합(라이브 DB 확정): patient_id 를 가진 14개 테이블 + measurements(user_id).
-- FK 주의: med_logs.medication_id → medications 는 NO ACTION(차단) → med_logs 를 먼저 삭제.
--          그 외 내부 FK 는 전부 SET NULL 또는 CASCADE 라 순서 무관.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.change_role_purge(p_new_role text, p_confirm boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_cur_role text;
  v_group    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'error', 'message', '로그인이 필요해요.');
  END IF;
  IF p_new_role NOT IN ('patient', 'caregiver') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'error', 'message', '잘못된 역할이에요.');
  END IF;

  SELECT role, patient_group_id INTO v_cur_role, v_group FROM users WHERE id = v_uid;

  IF v_cur_role = p_new_role THEN
    RETURN jsonb_build_object('ok', false, 'code', 'same_role', 'message', '이미 해당 역할이에요.');
  END IF;

  -- ── 보호자 → 환자 ─────────────────────────────────────────────────────────
  IF p_new_role = 'patient' THEN
    -- 환자 2명 금지: 그룹에 나 말고 다른 환자가 이미 있으면 차단.
    IF v_group IS NOT NULL AND EXISTS (
      SELECT 1 FROM patient_group_members
      WHERE group_id = v_group AND role = 'patient' AND user_id <> v_uid
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'two_patients',
        'message', '이 가족엔 이미 환자가 있어 환자로 바꿀 수 없어요. 환자는 한 분만 가능해요.');
    END IF;

    UPDATE users SET role = 'patient' WHERE id = v_uid;
    UPDATE patient_group_members SET role = 'patient' WHERE user_id = v_uid;
    RETURN jsonb_build_object('ok', true, 'code', 'changed_to_patient',
      'message', '역할이 환자로 변경됐어요.');
  END IF;

  -- ── 환자 → 보호자 (건강기록 완전 삭제) ────────────────────────────────────
  IF NOT p_confirm THEN
    RETURN jsonb_build_object('ok', false, 'code', 'need_confirm', 'message', '확인이 필요해요.');
  END IF;

  -- med_logs 를 medications 보다 먼저(NO ACTION). 그 외는 SET NULL/CASCADE 라 순서 무관.
  DELETE FROM effect_tracking_queue WHERE patient_id = v_uid;
  DELETE FROM on_off_logs           WHERE patient_id = v_uid;
  DELETE FROM measurements          WHERE user_id   = v_uid;
  DELETE FROM med_logs              WHERE patient_id = v_uid;
  DELETE FROM media_logs            WHERE patient_id = v_uid;
  DELETE FROM diary_entries         WHERE patient_id = v_uid;
  DELETE FROM symptom_notes         WHERE patient_id = v_uid;
  DELETE FROM exercise_logs         WHERE patient_id = v_uid;
  DELETE FROM medication_history    WHERE patient_id = v_uid;
  DELETE FROM prescriptions         WHERE patient_id = v_uid;
  DELETE FROM medical_appointments  WHERE patient_id = v_uid;
  DELETE FROM medical_records       WHERE patient_id = v_uid;
  DELETE FROM med_flow_debug        WHERE patient_id = v_uid;
  DELETE FROM dose_slots            WHERE patient_id = v_uid;
  DELETE FROM medications           WHERE patient_id = v_uid;

  UPDATE users SET role = 'caregiver' WHERE id = v_uid;
  UPDATE patient_group_members SET role = 'caregiver' WHERE user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'code', 'changed_to_caregiver',
    'message', '역할이 보호자로 변경됐어요.');
END;
$function$;

REVOKE ALL ON FUNCTION public.change_role_purge(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.change_role_purge(text, boolean) TO authenticated;
