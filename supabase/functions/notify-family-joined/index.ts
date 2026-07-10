// 가족 연동(새 멤버 합류) → 같은 그룹의 '다른' 멤버들에게 푸시 (cross-user)
// 앱이 join_family_by_code 성공 직후 호출. 호출자 JWT = 새로 합류한 멤버.
//
// 절대 원칙(CLAUDE.md): cross-user 는 서버 푸시 필수(로컬 알림 대체 금지).
//
// 동작:
//   1) 호출자(JWT) = 새 멤버. users 에서 name, patient_group_id 조회.
//   2) 같은 group 의 다른 멤버(환자·보호자 모두, 호출자 제외) user_id 목록.
//   3) 각자 push_token / notification_enabled / language 조회 → 수신자 언어로 발송.
//   4) notification_logs 저장(미읽음).
//
// payload data: { type: 'family_joined', new_member_id, group_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function sendPush(
  to: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({ to, sound: 'default', title, body, data, priority: 'high', channelId: 'default' }),
    });
    const result = await res.json();
    console.log('[notify-family-joined] sendPush', JSON.stringify({ to: to.slice(0, 30), status: res.status, result }));
  } catch (e) {
    console.error('[notify-family-joined] sendPush error:', e);
  }
}

async function logNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('notification_logs').insert({
      user_id: userId, type: 'family_joined', title, body, data, read_at: null,
    });
  } catch (e) {
    console.warn('[notify-family-joined] logNotification 실패:', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // 인증: 호출자 = 새로 합류한 멤버
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1) 새 멤버 정보
    const { data: me } = await supabase
      .from('users')
      .select('name, patient_group_id')
      .eq('id', caller.id)
      .maybeSingle();
    const newMemberName = (me?.name ?? '').trim();
    const groupId = me?.patient_group_id ?? null;
    if (!groupId) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no_group' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) 같은 그룹의 '다른' 멤버
    const { data: members } = await supabase
      .from('patient_group_members')
      .select('user_id')
      .eq('group_id', groupId);
    const otherIds = (members ?? [])
      .map((m: any) => m?.user_id)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0 && id !== caller.id);
    if (otherIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no_other_members' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3) 수신자 push_token / notification_enabled / language
    const { data: users } = await supabase
      .from('users')
      .select('id, push_token, notification_enabled, language')
      .in('id', otherIds);

    const payload = { type: 'family_joined', new_member_id: caller.id, group_id: groupId };
    let sent = 0;
    let skipped = 0;

    for (const u of users ?? []) {
      const token = (u as any)?.push_token as string | null;
      if (!token || (u as any)?.notification_enabled === false) { skipped += 1; continue; }
      const isEn = (u as any)?.language === 'en';
      const title = isEn ? '👨‍👩‍👧 New family member' : '👨‍👩‍👧 새 가족이 연결되었어요';
      const body = isEn
        ? (newMemberName ? `${newMemberName} is now linked to your family.` : 'A new family member is now linked.')
        : (newMemberName ? `${newMemberName}님이 가족으로 연결되었어요.` : '새 가족이 연결되었어요.');
      await sendPush(token, title, body, payload);
      await logNotification((u as any).id, title, body, payload);
      sent += 1;
    }

    return new Response(JSON.stringify({ sent, skipped }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[notify-family-joined] fatal:', err);
    return new Response(JSON.stringify({ error: err?.message ?? 'failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
