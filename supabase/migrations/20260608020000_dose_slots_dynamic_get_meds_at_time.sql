-- =====================================================================
-- 약 복용 모델 재설계 3단계 — 서버 dose_slot 동적화 (RPC) (parkinon)
-- 근거: docs/medication_dose_model_redesign_spec.md §8, §9-3
--
-- 목적: get_meds_at_time RPC가 dose_slots(신규)도 조회하도록 확장.
--   - 신규 dose_slots 행조회 분기 추가 (is_active AND remind_enabled, time 매칭)
--   - 반환에 dose_slot_id / label / "time" 컬럼 추가 (구버전 호환 위해
--     기존 meal_time 컬럼/형태는 그대로 유지)
--   - dose_slots로 이관된 환자는 dose_slot 분기가 우선(legacy 분기에서 제외)
--     → 같은 시각 중복 알림 방지. 미이관 환자는 기존 legacy 분기로 계속 동작.
--
-- ⚠️ 라이브 backward-compat:
--   - 구버전 send-medication-reminders는 row.patient_id / row.meal_time 만 읽음.
--     legacy 분기는 dose_slot으로 대체된 (patient_id, time)만 빼고 100% 동일.
--   - dose_slot 분기는 호환을 위해 meal_time 컬럼에도 label 역매핑 값을 채움
--     (아침/점심/저녁/취침 label → morning/lunch/dinner/bedtime). label이 표준
--     4종이 아니면 meal_time=NULL (구버전이 MEAL_LABELS[null]=undefined로
--     깨질 수 있으나, 표준 4슬롯 이관 데이터는 항상 매핑됨. 비표준 라벨은
--     신버전 클라 전환(4단계) 이후에만 생성됨).
--
-- 멱등: DROP FUNCTION IF EXISTS + CREATE. 반환 시그니처 변경 위해 DROP 필요
--   (CREATE OR REPLACE는 RETURNS TABLE 컬럼 변경 불가).
-- =====================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_meds_at_time(text);

CREATE OR REPLACE FUNCTION public.get_meds_at_time(target_time text)
RETURNS TABLE(
  patient_id   text,
  meal_time    text,
  dose_slot_id uuid,
  label        text,
  "time"       text
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ─── (A) 신규: dose_slots 행조회 ──────────────────────────────────
  -- is_active AND remind_enabled 인 슬롯을 시각 매칭. 시각 비교는
  -- HH:MM 단위(초 무시)로 target_time(HH:MM)과 맞춘다.
  SELECT DISTINCT
    ds.patient_id::TEXT,
    -- 구버전 호환: 표준 4라벨이면 meal_time 슬롯키로 역매핑, 아니면 NULL
    CASE ds.label
      WHEN '아침' THEN 'morning'
      WHEN '점심' THEN 'lunch'
      WHEN '저녁' THEN 'dinner'
      WHEN '취침' THEN 'bedtime'
      ELSE NULL
    END AS meal_time,
    ds.id   AS dose_slot_id,
    ds.label,
    to_char(ds.time, 'HH24:MI') AS "time"
  FROM dose_slots ds
  WHERE ds.is_active = true
    AND ds.remind_enabled = true
    AND to_char(ds.time, 'HH24:MI') = target_time

  UNION

  -- ─── (B) legacy: medications.meal_schedules (구버전 보존) ─────────
  -- 단, 같은 환자가 같은 시각에 active dose_slot을 가지면 (A)가 우선 → 제외.
  SELECT DISTINCT
    m.patient_id::TEXT,
    slot.key AS meal_time,
    NULL::uuid AS dose_slot_id,
    NULL::text AS label,
    slot.val  AS "time"
  FROM medications m,
       jsonb_each_text(m.meal_schedules) AS slot(key, val)
  WHERE m.is_active = true
    AND slot.val = target_time
    AND slot.key = ANY(m.meal_times)
    AND NOT EXISTS (
      SELECT 1 FROM dose_slots ds
      WHERE ds.patient_id = m.patient_id
        AND ds.is_active = true
        AND ds.remind_enabled = true
        AND to_char(ds.time, 'HH24:MI') = target_time
    )

  UNION

  -- ─── (C) legacy: users.meal_schedules (약 미등록 환자, 구버전 보존) ─
  SELECT DISTINCT
    u.id::TEXT AS patient_id,
    slot.key AS meal_time,
    NULL::uuid AS dose_slot_id,
    NULL::text AS label,
    slot.val  AS "time"
  FROM users u,
       jsonb_each_text(u.meal_schedules) AS slot(key, val)
  WHERE u.role = 'patient'
    AND u.meal_schedules IS NOT NULL
    AND slot.val = target_time
    AND NOT EXISTS (
      SELECT 1
      FROM medications m
      WHERE m.patient_id = u.id
        AND m.is_active = true
        AND m.meal_times @> ARRAY[slot.key]::text[]
    )
    AND NOT EXISTS (
      SELECT 1 FROM dose_slots ds
      WHERE ds.patient_id = u.id
        AND ds.is_active = true
        AND ds.remind_enabled = true
        AND to_char(ds.time, 'HH24:MI') = target_time
    );
$function$;

COMMENT ON FUNCTION public.get_meds_at_time(text) IS
  '특정 시각 복약 알림 대상 반환. dose_slots(신규) 우선 + medications/users.meal_schedules(legacy) 통합. dose_slot_id/label/time 컬럼은 신규 경로용, meal_time은 구버전 호환용.';

COMMIT;
