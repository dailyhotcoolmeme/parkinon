import { supabase } from '../lib/supabase';

/**
 * 알림 핸들러 디버깅용 임시 로깅 헬퍼.
 * - 비로그인 시 skip (RLS 통과 못함)
 * - 실패해도 silent — 앱 동작에 절대 영향 주면 안 됨
 * - fire-and-forget 권장 (await 없이 호출)
 */
export async function logNotificationEvent(params: {
  userId: string | null;
  notifId?: string;
  notifType?: string;
  event: string;
  payload?: any;
  isColdStart?: boolean;
}): Promise<void> {
  try {
    if (!params.userId) return;
    await supabase.from('notification_debug_logs' as any).insert({
      user_id: params.userId,
      notif_id: params.notifId ?? null,
      notif_type: params.notifType ?? null,
      event: params.event,
      payload: params.payload ?? null,
      is_cold_start: params.isColdStart ?? null,
    });
  } catch (e) {
    // silent: 로깅 실패는 앱 동작에 영향 없음
  }
}
