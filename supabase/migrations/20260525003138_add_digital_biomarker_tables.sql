-- 디지털 바이오마커 MVP-A Phase 1
-- 측정(손가락 두드리기 / 반응속도) 데이터 모델 + 본인 baseline + RLS
-- 참고: docs/digital_biomarker_mvpA_spec.md §8 (데이터 모델)
-- 본 마이그레이션은 신규 테이블만 추가하므로 기존 테이블·RLS 무영향.

-- ─── measurements ────────────────────────────────────────────────────────────
-- 측정 시도 단위. type=tap(손가락 두드리기) / reaction(반응속도)
-- med_phase: 30m/2h(약효추적 알림 시점), self_initiated(메뉴 자율 측정), other(예비)
CREATE TABLE IF NOT EXISTS public.measurements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('tap', 'reaction')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  med_intake_id   uuid REFERENCES public.med_logs(id) ON DELETE SET NULL,
  med_phase       text NOT NULL DEFAULT 'other'
                    CHECK (med_phase IN ('30m', '2h', 'self_initiated', 'other')),
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurements_user_started
  ON public.measurements(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_med_intake
  ON public.measurements(med_intake_id);

COMMENT ON TABLE  public.measurements IS '디지털 바이오마커 측정 시도 단위 (탭핑·반응속도)';
COMMENT ON COLUMN public.measurements.med_phase IS '복용 시점 라벨: 30m/2h/self_initiated/other';
COMMENT ON COLUMN public.measurements.context   IS '기기/세션 컨텍스트(jsonb)';

ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;

-- 환자 본인 SELECT
CREATE POLICY "measurements: 환자 본인 read"
  ON public.measurements
  FOR SELECT
  USING (user_id = auth.uid());

-- 같은 patient_group 보호자 SELECT
CREATE POLICY "measurements: 같은 그룹 보호자 read"
  ON public.measurements
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.patient_group_members pgm1
      JOIN public.patient_group_members pgm2 ON pgm1.group_id = pgm2.group_id
      WHERE pgm1.user_id = auth.uid()
        AND pgm2.user_id = measurements.user_id
    )
  );

-- 환자 본인 INSERT
CREATE POLICY "measurements: 환자 본인 insert"
  ON public.measurements
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 같은 patient_group 보호자 INSERT (대리 측정은 §5.3에 따라 클라가 차단하지만
-- 정책상 보호자가 row를 만들 수는 있도록 약/몸상태 패턴과 동일하게 둔다)
CREATE POLICY "measurements: 같은 그룹 보호자 insert"
  ON public.measurements
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patient_group_members pgm1
      JOIN public.patient_group_members pgm2 ON pgm1.group_id = pgm2.group_id
      WHERE pgm1.user_id = auth.uid()
        AND pgm2.user_id = measurements.user_id
    )
  );

-- 본인 soft delete(deleted_at) 갱신
CREATE POLICY "measurements: 환자 본인 update"
  ON public.measurements
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── measurement_features ────────────────────────────────────────────────────
-- 측정에서 산출한 feature(탭 수·평균 RT·CV 등). 신원·진단 정보 아님.
CREATE TABLE IF NOT EXISTS public.measurement_features (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id  uuid NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  feature_key     text NOT NULL,
  value_numeric   numeric,
  value_jsonb     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (measurement_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_measurement_features_measurement
  ON public.measurement_features(measurement_id);
CREATE INDEX IF NOT EXISTS idx_measurement_features_key
  ON public.measurement_features(feature_key);

COMMENT ON TABLE public.measurement_features IS '측정 결과 feature (tap_count, iti_mean_ms, rt_mean_ms 등)';

ALTER TABLE public.measurement_features ENABLE ROW LEVEL SECURITY;

-- 환자 본인 또는 같은 그룹 보호자 SELECT (measurements join)
CREATE POLICY "measurement_features: 본인 또는 보호자 read"
  ON public.measurement_features
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.measurements m
      WHERE m.id = measurement_features.measurement_id
        AND (
          m.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.patient_group_members pgm1
            JOIN public.patient_group_members pgm2 ON pgm1.group_id = pgm2.group_id
            WHERE pgm1.user_id = auth.uid()
              AND pgm2.user_id = m.user_id
          )
        )
    )
  );

-- 환자 본인 또는 같은 그룹 보호자 INSERT (measurements join)
CREATE POLICY "measurement_features: 본인 또는 보호자 insert"
  ON public.measurement_features
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.measurements m
      WHERE m.id = measurement_features.measurement_id
        AND (
          m.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.patient_group_members pgm1
            JOIN public.patient_group_members pgm2 ON pgm1.group_id = pgm2.group_id
            WHERE pgm1.user_id = auth.uid()
              AND pgm2.user_id = m.user_id
          )
        )
    )
  );

-- ─── baseline_stats ──────────────────────────────────────────────────────────
-- 본인 rolling baseline (Welford 점진식으로 cumulative 갱신, Phase 3에서 30일 윈도우)
CREATE TABLE IF NOT EXISTS public.baseline_stats (
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_key  text NOT NULL,
  mean         numeric NOT NULL DEFAULT 0,
  sd           numeric NOT NULL DEFAULT 0,
  n            integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_key)
);

COMMENT ON TABLE  public.baseline_stats IS '사용자별 feature baseline (Welford 누적 mean/sd/n)';
COMMENT ON COLUMN public.baseline_stats.n IS '누적 표본 수. 14 이상일 때만 화면에서 평균 비교 활성(§6.1)';

ALTER TABLE public.baseline_stats ENABLE ROW LEVEL SECURITY;

-- 환자 본인 SELECT
CREATE POLICY "baseline_stats: 환자 본인 read"
  ON public.baseline_stats
  FOR SELECT
  USING (user_id = auth.uid());

-- 같은 patient_group 보호자 SELECT
CREATE POLICY "baseline_stats: 같은 그룹 보호자 read"
  ON public.baseline_stats
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.patient_group_members pgm1
      JOIN public.patient_group_members pgm2 ON pgm1.group_id = pgm2.group_id
      WHERE pgm1.user_id = auth.uid()
        AND pgm2.user_id = baseline_stats.user_id
    )
  );

-- 환자 본인 INSERT/UPDATE (upsert)
CREATE POLICY "baseline_stats: 환자 본인 insert"
  ON public.baseline_stats
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "baseline_stats: 환자 본인 update"
  ON public.baseline_stats
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
