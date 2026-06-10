-- =====================================================================
-- 약 복용 모델 재설계 2단계 — 기존 데이터 이관 (비파괴, 추가만) (parkinon)
-- 근거: docs/medication_dose_model_redesign_spec.md §B(마이그 SQL 초안)·§8·§9-2
--
-- 범위(오직 INSERT/UPDATE):
--   1) users.meal_schedules(jsonb) → dose_slots 행 생성 (환자별 멱등 가드)
--   2) medications.meal_times(슬롯키 배열) → medication_dose_slots 배정 (is_active만)
--   3) med_logs.meal_time(슬롯키) → dose_slot_id 역매핑 (NULL인 행만)
--   4) on_off_logs.medication_meal_time(슬롯키) → dose_slot_id 역매핑 (NULL인 행만)
--
-- 기존 컬럼(meal_time / medication_meal_time / meal_schedules / measurements 등)
--   무변경(읽기만). 전부 멱등: 재실행해도 중복 생성·중복 매핑 없음.
--
-- 슬롯키→label 매핑: morning='아침' lunch='점심' dinner='저녁' bedtime='취침'
-- sort_order: morning=0 lunch=1 dinner=2 bedtime=3
-- =====================================================================

BEGIN;

-- ─── 1) dose_slots 생성 ──────────────────────────────────────────────────────
-- 각 환자의 users.meal_schedules(jsonb {slotKey: "HH:MM"})를 dose_slots 행으로.
-- 멱등 가드: 해당 patient_id에 dose_slots가 이미 존재하면 그 환자는 통째로 스킵.
INSERT INTO public.dose_slots (
  patient_id, "time", label, sort_order,
  remind_enabled, remind_sound_id,
  track_enabled, track_intervals, track_sound_id
)
SELECT
  u.id AS patient_id,
  (ms.value #>> '{}')::time AS "time",
  CASE ms.key
    WHEN 'morning' THEN '아침'
    WHEN 'lunch'   THEN '점심'
    WHEN 'dinner'  THEN '저녁'
    WHEN 'bedtime' THEN '취침'
    ELSE ms.key
  END AS label,
  CASE ms.key
    WHEN 'morning' THEN 0
    WHEN 'lunch'   THEN 1
    WHEN 'dinner'  THEN 2
    WHEN 'bedtime' THEN 3
    ELSE 99
  END AS sort_order,
  -- 복용 알림 on/off: med_time_notif_prefs->>key, 없으면 true
  COALESCE((u.med_time_notif_prefs ->> ms.key)::boolean, true) AS remind_enabled,
  -- 복용 알림 소리: med_time_sound_prefs->>key, 빈문자열은 null
  NULLIF(u.med_time_sound_prefs ->> ms.key, '') AS remind_sound_id,
  -- 약효추적 on/off: 취침 슬롯은 기본 추적 제외(기존 동작 보존)
  (ms.key <> 'bedtime') AS track_enabled,
  -- 추적 시각(분) 배열: med_notif_prefs(전역) 중 enabled=true인 minutes,
  --   하나도 없으면 기본값 '{0,30,120}'
  COALESCE(
    (
      SELECT array_agg((p->>'minutes')::int ORDER BY (p->>'minutes')::int)
      FROM jsonb_array_elements(COALESCE(u.med_notif_prefs, '[]'::jsonb)) AS p
      WHERE COALESCE((p->>'enabled')::boolean, false) = true
        AND p ? 'minutes'
    ),
    '{0,30,120}'::int[]
  ) AS track_intervals,
  NULL::text AS track_sound_id
FROM public.users u
CROSS JOIN LATERAL jsonb_each(COALESCE(u.meal_schedules, '{}'::jsonb)) AS ms(key, value)
WHERE u.role = 'patient'
  AND u.meal_schedules IS NOT NULL
  AND NULLIF(ms.value #>> '{}', '') IS NOT NULL
  -- 환자별 멱등 가드: 이미 dose_slots가 있으면 스킵
  AND NOT EXISTS (
    SELECT 1 FROM public.dose_slots ds WHERE ds.patient_id = u.id
  );

-- ─── 2) medication_dose_slots 배정 ──────────────────────────────────────────
-- medications.meal_times(슬롯키 배열) → 같은 환자의 동일 label dose_slot.
-- is_active=true 약만. ON CONFLICT DO NOTHING (PK=(medication_id,dose_slot_id)).
INSERT INTO public.medication_dose_slots (medication_id, dose_slot_id)
SELECT DISTINCT m.id, ds.id
FROM public.medications m
CROSS JOIN LATERAL unnest(m.meal_times) AS mt(slot_key)
JOIN public.dose_slots ds
  ON ds.patient_id = m.patient_id
 AND ds.label = CASE mt.slot_key
       WHEN 'morning' THEN '아침'
       WHEN 'lunch'   THEN '점심'
       WHEN 'dinner'  THEN '저녁'
       WHEN 'bedtime' THEN '취침'
       ELSE NULL
     END
WHERE m.is_active = true
  AND m.meal_times IS NOT NULL
ON CONFLICT (medication_id, dose_slot_id) DO NOTHING;

-- ─── 3) med_logs.dose_slot_id 역매핑 ────────────────────────────────────────
-- ml.meal_time(슬롯키) → label → 같은 환자 dose_slot. NULL인 행만.
-- 주의: med_logs는 슬롯 단위 기록이라 medication_id가 NULL(전 행 확인). 따라서
--       medication 경유가 아니라 med_logs.patient_id로 직접 매핑한다.
UPDATE public.med_logs ml
SET dose_slot_id = ds.id
FROM public.dose_slots ds
WHERE ml.dose_slot_id IS NULL
  AND ml.meal_time IS NOT NULL
  AND ds.patient_id = ml.patient_id
  AND ds.label = CASE ml.meal_time::text
        WHEN 'morning' THEN '아침'
        WHEN 'lunch'   THEN '점심'
        WHEN 'dinner'  THEN '저녁'
        WHEN 'bedtime' THEN '취침'
        ELSE NULL
      END;

-- ─── 4) on_off_logs.dose_slot_id 역매핑 (슬롯별 통계 재설계용) ──────────────
-- on_off_logs.medication_meal_time(슬롯키 TEXT) → label → 같은 환자 dose_slot.
-- NULL인 행만. medication_meal_time이 NULL/비표준이면 매핑 안 되어 스킵됨.
UPDATE public.on_off_logs ol
SET dose_slot_id = ds.id
FROM public.dose_slots ds
WHERE ol.dose_slot_id IS NULL
  AND ol.medication_meal_time IS NOT NULL
  AND ds.patient_id = ol.patient_id
  AND ds.label = CASE ol.medication_meal_time
        WHEN 'morning' THEN '아침'
        WHEN 'lunch'   THEN '점심'
        WHEN 'dinner'  THEN '저녁'
        WHEN 'bedtime' THEN '취침'
        ELSE NULL
      END;

COMMIT;
