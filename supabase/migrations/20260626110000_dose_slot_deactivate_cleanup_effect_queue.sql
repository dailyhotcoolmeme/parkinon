-- =====================================================================
-- dose_slot 비활성화(soft delete) 시 미발송 약효추적 큐 자동 정리
--
-- 문제(진단 완료):
--   알림 설정에서 dose_slot 을 삭제하면 행을 지우지 않고 is_active=false 로
--   soft delete 한다. 그러나 그 슬롯이 만들어 둔 effect_tracking_queue(약효추적
--   알림)의 미발송 행이 정리되지 않는다.
--     - effect_tracking_queue.dose_slot_id FK 는 ON DELETE SET NULL 인데
--       soft delete 는 row 를 실제 삭제하지 않으므로 SET NULL 이 발동하지 않음.
--     - 발송 크론(process-notification-queue)도 슬롯 유효성을 보지 않아
--       슬롯을 지웠는데도 30분/2시간 약효추적 알림이 그대로 발송됨.
--
-- 해법(방어선 1 — DB 트리거, 서버 권위):
--   dose_slots 에 AFTER UPDATE 트리거를 둔다. is_active 가 true→false 로 바뀌면
--   그 슬롯의 미발송 큐(sent_at IS NULL)를 즉시 DELETE 한다.
--   트리거 함수는 SECURITY DEFINER 로 RLS 를 우회한다 —
--   effect_tracking_queue 에는 DELETE RLS 정책이 없어 클라 직접 delete 는
--   막히므로(선례: 20260609000000), 트리거가 서버 권위로 안전하게 정리한다.
--   이미 발송된(sent_at 채워진) 행은 통계/history 보존을 위해 건드리지 않는다.
--
-- 멱등: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS 후 재생성.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cleanup_effect_queue_on_dose_slot_deactivate()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
begin
  -- is_active 가 true → false 로 바뀐 경우에만 정리.
  if old.is_active = true and new.is_active = false then
    delete from public.effect_tracking_queue
    where dose_slot_id = new.id
      and sent_at is null;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_dose_slots_cleanup_effect_queue ON public.dose_slots;

CREATE TRIGGER trg_dose_slots_cleanup_effect_queue
  AFTER UPDATE OF is_active ON public.dose_slots
  FOR EACH ROW
  WHEN (old.is_active = true AND new.is_active = false)
  EXECUTE FUNCTION public.cleanup_effect_queue_on_dose_slot_deactivate();
