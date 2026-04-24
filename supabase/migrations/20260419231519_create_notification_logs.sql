-- notification_logs 테이블 생성 및 RLS 정책
-- 사용자별 푸시 알림 이력 저장, 읽음 처리(read_at) 포함

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT '',
  title       text NOT NULL DEFAULT '',
  body        text,
  data        jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- 본인 알림만 조회
CREATE POLICY "users see own notifications"
  ON public.notification_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- 본인 알림만 삽입 (Edge Function은 service_role로 호출)
CREATE POLICY "users insert own notifications"
  ON public.notification_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 본인 알림만 수정 (read_at 업데이트용)
CREATE POLICY "users update own notifications"
  ON public.notification_logs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
