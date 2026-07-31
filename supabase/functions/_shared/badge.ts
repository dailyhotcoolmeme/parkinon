// 홈 화면 앱 아이콘의 숫자 배지.
//
// 왜 서버에서 실어 보내야 하나:
//   앱이 켜져 있을 때는 앱이 직접 배지를 맞춘다(NotificationBadgeContext).
//   그런데 앱이 꺼져 있을 때 알림이 오면 그 시점엔 앱이 아무것도 못 한다.
//   그래서 푸시 payload 에 badge 값을 함께 보내야 OS 가 아이콘에 숫자를 찍는다.
//
// 값은 "아직 안 읽은 알림 수 + 지금 보내는 1건"이다.
//   notification_logs 행이 언제 들어가느냐가 함수마다 달라서, 세는 시점에 따라
//   방금 보낸 것이 포함될 수도 아닐 수도 있다. 항상 보내기 직전에 세고 +1 하면
//   순서와 무관하게 일치한다.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** 이 사용자의 안 읽은 알림 수 + 1. 조회 실패 시 undefined(배지를 건드리지 않음). */
export async function nextBadgeCount(
  supabase: SupabaseClient,
  userId: string | null | undefined,
): Promise<number | undefined> {
  if (!userId) return undefined;
  try {
    const { count, error } = await supabase
      .from('notification_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) return undefined;
    return (count ?? 0) + 1;
  } catch {
    return undefined;
  }
}

/**
 * 푸시 토큰으로 수신자를 찾아 배지 수를 구한다.
 *
 * 왜 토큰으로 찾나:
 *   sendPush 는 함수마다 시그니처가 달라서 userId 를 새로 넘기려면 호출부를 전부
 *   고쳐야 한다(8개 함수 · 십수 곳). 알림 발송 경로는 가장 위험한 코드라 손대는 범위를
 *   줄이는 편이 안전하다 — 토큰은 이미 sendPush 가 받고 있으므로 그것만으로 찾는다.
 *   조회가 실패하면 undefined 를 돌려 배지를 건드리지 않는다(발송은 그대로 진행).
 */
export async function nextBadgeCountByToken(
  supabase: SupabaseClient,
  pushToken: string | null | undefined,
): Promise<number | undefined> {
  if (!pushToken) return undefined;
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('push_token', pushToken)
      .maybeSingle();
    const uid = (data as { id?: string } | null)?.id;
    if (!uid) return undefined;
    return await nextBadgeCount(supabase, uid);
  } catch {
    return undefined;
  }
}
