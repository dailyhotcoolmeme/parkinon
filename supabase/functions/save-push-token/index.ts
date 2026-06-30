import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// service_role 키로 RLS 우회 클라이언트 생성
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 요청자 JWT로 user_id 확인 (anon 키 + 사용자 JWT)
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { push_token?: string; push_platform?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { push_token, push_platform } = body
  if (!push_token) {
    return new Response(JSON.stringify({ error: 'push_token required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // push_platform 검증(ios|android|web). 미전달/이상값이면 저장 생략(기존 값 보존).
  const platform =
    push_platform === 'ios' || push_platform === 'android' || push_platform === 'web'
      ? push_platform
      : undefined

  // service_role로 push_token(+platform) 저장 (RLS 우회)
  const { error } = await supabase
    .from('users')
    .update({ push_token, ...(platform ? { push_platform: platform } : {}) })
    .eq('id', user.id)

  if (error) {
    console.error('[save-push-token] DB 저장 실패:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log('[save-push-token] push_token 저장 성공 — user:', user.id)
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
