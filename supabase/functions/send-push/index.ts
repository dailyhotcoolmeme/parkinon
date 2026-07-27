import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ---------------------------------------------------------------
    // C3: 호출자 인증 필수.
    //   - 본인 push_token 으로 보내는 경우(셀프 알림) 허용
    //   - 같은 patient_group 멤버의 push_token 으로 보내는 경우 허용
    //   - 그 외는 403
    // ---------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 호출자 검증용 클라이언트 (anon + Authorization 헤더로 JWT 검사)
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { to, title, body, data, categoryId } = await req.json();

    if (!to || !title) {
      return new Response(
        JSON.stringify({ error: 'to and title fields are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (typeof to !== 'string') {
      return new Response(
        JSON.stringify({ error: 'to must be a string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 권한 검증: 호출자의 patient_group_id 조회 + 토큰 소유자의 patient_group_id 조회
    // service role 로 cross-user 조회 (RLS 우회) — 본 함수 내부에서만 사용.
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const [{ data: callerRow, error: callerErr }, { data: ownerRow, error: ownerErr }] =
      await Promise.all([
        adminClient
          .from('users')
          .select('id, patient_group_id, push_token')
          .eq('id', user.id)
          .maybeSingle(),
        adminClient
          .from('users')
          .select('id, patient_group_id, push_token, notification_enabled')
          .eq('push_token', to)
          .maybeSingle(),
      ]);

    if (callerErr) {
      console.error('send-push caller lookup error:', callerErr);
      return new Response(
        JSON.stringify({ error: 'permission check failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (ownerErr) {
      console.error('send-push owner lookup error:', ownerErr);
      return new Response(
        JSON.stringify({ error: 'permission check failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!ownerRow) {
      return new Response(
        JSON.stringify({ error: '알 수 없는 수신자 토큰입니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const isSelf = ownerRow.id === user.id;
    const sameGroup =
      !!callerRow?.patient_group_id &&
      !!ownerRow.patient_group_id &&
      callerRow.patient_group_id === ownerRow.patient_group_id;

    if (!isSelf && !sameGroup) {
      return new Response(
        JSON.stringify({ error: '해당 수신자에게 알림을 보낼 권한이 없습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 전체 알림 마스터 게이트: 수신자가 전체 알림 OFF(notification_enabled=false)면 발송 스킵.
    // (개별 토글 caregiver_notif_prefs 는 호출 측 훅에서 이미 존중 — 여기선 마스터만 추가 차단)
    // notify-measurement-completed / send-medication-reminders 와 동일한 정책.
    // 스킵 시 푸시도 안 보내고 notification_logs 에도 남기지 않는다(알림함 일관성).
    if ((ownerRow as any)?.notification_enabled === false) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'notifications_disabled' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 디지털 바이오마커 MVP-A Phase 4 — categoryId 옵션 전달 지원.
    const message: Record<string, unknown> = {
      to,
      sound: 'default',
      title,
      body: body ?? '',
      data: data ?? {},
      priority: 'high',
      channelId: 'default',
    };
    if (typeof categoryId === 'string' && categoryId.length > 0) {
      message.categoryId = categoryId;
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();

    // 수신자 알림함(notification_logs)에 기록 — 보호자 종 아이콘 알림 내역용.
    // 환자 알림은 서버 크론(logNotification)이 남기지만, 보호자행 알림은 이 함수만
    // 거치므로 여기서 service role 로 기록한다(RLS 우회).
    try {
      await adminClient.from('notification_logs').insert({
        user_id: ownerRow.id,
        type: (data && typeof data.type === 'string' && data.type) ? data.type : 'push',
        title,
        body: body ?? '',
        data: data ?? {},
      });
    } catch (logErr) {
      console.error('send-push notification_logs insert error:', logErr);
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('send-push error:', err);
    return new Response(
      JSON.stringify({ error: err.message ?? '전송 실패' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
