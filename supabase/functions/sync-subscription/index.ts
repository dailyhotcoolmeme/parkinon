// 구독 상태 즉시 동기화 — 앱이 구매/복원 직후 호출한다.
//
// 왜 필요한가:
//   구독 정본은 patient_groups.subscription_tier 이고, 그 값은 RevenueCat 웹훅이 채운다.
//   그런데 웹훅은 비동기라 (1) 늦게 오거나 (2) 아예 안 오는 경우가 있다.
//   특히 복원(restore)은 이미 그 계정이 권한을 갖고 있으면 RevenueCat 이 보낼 이벤트가 없어
//   웹훅이 영원히 안 온다 → 앱은 계속 free. (실측 2026-07-27: 이전은 됐는데 앱은 무료 화면)
//   그래서 앱이 직접 "지금 내 권한 어떻게 되냐"고 물어 서버가 RevenueCat 을 조회해 확정한다.
//
// 보안: 티어는 요청 본문이 아니라 RevenueCat 조회 결과로만 정해진다. 호출자는 자기 자신의
//   권한만 반영할 수 있다(user id 를 JWT 에서 뽑는다). 클라이언트가 값을 속일 여지가 없다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const PREMIUM_ENTITLEMENT = 'premium'
const RC_PUBLIC_KEY = Deno.env.get('REVENUECAT_PUBLIC_KEY') ?? 'goog_uaXvxBhEdIaKrxJgpKGktHZPbKf'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

/** RevenueCat 에서 이 사용자의 premium 권한 + 스토어 구독 식별자를 가져온다. */
async function fetchState(appUserId: string): Promise<{
  active: boolean
  expiresMs: number | null
  txnId: string | null
} | null> {
  const r = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${RC_PUBLIC_KEY}`, 'X-Platform': 'android' } },
  )
  if (!r.ok) return null
  const j = await r.json()
  const sub = j?.subscriber
  const ent = sub?.entitlements?.[PREMIUM_ENTITLEMENT]
  if (!ent) return { active: false, expiresMs: null, txnId: null }

  const expiresMs = ent.expires_date ? new Date(ent.expires_date).getTime() : null
  // 구독 식별자: 갱신마다 "..0", "..1" 이 붙으므로 원 주문번호만 남긴다.
  // 웹훅의 original_transaction_id 와 같은 값이어야 "한 구독 = 한 그룹" 정리가 맞물린다.
  const productId: string | undefined = ent.product_identifier
  const raw: string | null =
    (productId && sub?.subscriptions?.[productId]?.store_transaction_id) ?? null
  const txnId = raw ? raw.split('..')[0] : null

  return { active: expiresMs === null || expiresMs > Date.now(), expiresMs, txnId }
}

/**
 * 그룹이 없으면 만들어 붙인다.
 * ⚠️ 여기서 직접 insert 하지 않는다 — patient_groups.invite_code 는 NOT NULL + UNIQUE 라
 *   코드 생성·충돌 재시도가 필요하다. DB 함수에 원자적으로 맡긴다.
 */
async function ensureGroupFor(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('ensure_group_for_user', { p_user_id: userId })
  if (error) {
    console.error('[sync-subscription] 그룹 확보 실패:', error)
    return null
  }
  return (data as string | null) ?? null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'unauthorized' }, 401)

  const { data: authData, error: authErr } = await supabase.auth.getUser(token)
  const userId = authData?.user?.id
  if (authErr || !userId) return json({ error: 'unauthorized' }, 401)

  let state: Awaited<ReturnType<typeof fetchState>>
  try {
    state = await fetchState(userId)
  } catch (e) {
    console.error('[sync-subscription] RevenueCat 조회 실패:', e)
    return json({ error: 'revenuecat unavailable' }, 502)
  }
  // 조회 실패(네트워크·장애)면 아무것도 바꾸지 않는다. 잘못된 값으로 덮는 것보다 낫다.
  if (!state) return json({ error: 'revenuecat unavailable' }, 502)

  // 권한 없음 → 강등하지 않는다. 만료 판정은 웹훅(EXPIRATION)이 유예 규칙까지 보고 처리한다.
  // 여기서 내리면 갱신 공백에 호출된 것만으로 결제 중인 사용자가 무료로 떨어질 수 있다.
  if (!state.active) return json({ premium: false, synced: false })

  const groupId = await ensureGroupFor(userId)
  if (!groupId) return json({ error: 'no group' }, 500)

  const nowIso = new Date().toISOString()
  const expiresIso = state.expiresMs ? new Date(state.expiresMs).toISOString() : null

  const { error: upErr } = await supabase
    .from('patient_groups')
    .update({
      subscription_tier: 'premium',
      subscription_expires_at: expiresIso,
      subscription_payer_user_id: userId,
      subscription_original_txn_id: state.txnId,
      revenuecat_synced_at: nowIso,
    })
    .eq('id', groupId)
  if (upErr) {
    console.error('[sync-subscription] 그룹 갱신 실패:', upErr)
    return json({ error: 'update failed' }, 500)
  }

  // 같은 구독이 붙어 있던 다른 그룹은 내린다(구독 1개로 2그룹 프리미엄 방지).
  if (state.txnId) {
    await supabase
      .from('patient_groups')
      .update({ subscription_tier: 'free', subscription_expires_at: null, revenuecat_synced_at: nowIso })
      .eq('subscription_original_txn_id', state.txnId)
      .neq('id', groupId)
  }

  return json({ premium: true, synced: true, groupId, expiresAt: expiresIso })
})
