import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    // JWT 검증 (anon client로 getUser 호출)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await anonClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 요청 바디 파싱
    const { patient_id, push_token, meal_time, notif_settings } = await req.json()

    if (!patient_id || !push_token || !Array.isArray(notif_settings)) {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 취침약은 약효 추적 알림 없음 (야간 수면 방해 방지)
    if (meal_time === 'bedtime') {
      return new Response(JSON.stringify({ queued: 0, skipped: 'bedtime' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // service_role 클라이언트 (DB 쓰기)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 같은 meal_time의 미발송 항목만 삭제 (다른 식사의 추적 알림은 유지)
    await serviceClient
      .from('effect_tracking_queue')
      .delete()
      .eq('patient_id', patient_id)
      .eq('meal_time', meal_time)
      .is('sent_at', null)

    // enabled: true 이고 minutes > 0 인 항목만 처리
    const validItems = (notif_settings as Array<{ minutes: number; enabled: boolean }>)
      .filter((n) => n.enabled && n.minutes > 0)

    if (validItems.length === 0) {
      return new Response(JSON.stringify({ queued: 0 }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const now = Date.now()
    const rows = validItems.map((n) => ({
      patient_id,
      push_token,
      meal_time: meal_time ?? null,
      interval_minutes: n.minutes,
      send_at: new Date(now + n.minutes * 60 * 1000).toISOString(),
      sent_at: null,
    }))

    const { error: insertError } = await serviceClient
      .from('effect_tracking_queue')
      .insert(rows)

    if (insertError) {
      console.error('[queue-effect-tracking] INSERT 오류:', insertError)
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ queued: rows.length }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[queue-effect-tracking] 예외:', e)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
