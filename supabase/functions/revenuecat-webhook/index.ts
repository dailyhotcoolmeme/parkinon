// RevenueCat webhook — 구매/갱신/만료 이벤트를 받아 가족 그룹의 구독 티어를 갱신.
// 구독은 그룹(patient_group) 단위: 구매자(app_user_id = Supabase users.id)가 속한 그룹을
// premium 으로 승격/강등한다.
//
// RevenueCat 대시보드 → Integrations → Webhooks 에 이 함수 URL 등록하고,
//   Authorization 헤더 값에 REVENUECAT_WEBHOOK_SECRET 과 동일한 문자열을 설정한다.
//
// 이벤트 타입(https://www.revenuecat.com/docs/webhooks/event-types-and-fields):
//  - 활성화: INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, UNCANCELLATION, NON_RENEWING_PURCHASE
//  - 강등:   EXPIRATION
//  - 무시:   CANCELLATION(자동갱신만 끔, 기간 끝까지 유지), BILLING_ISSUE(유예), TEST 등
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? ''
const PREMIUM_ENTITLEMENT = 'premium'

const ACTIVATE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
])

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // 인증: RevenueCat 대시보드에 설정한 Authorization 헤더 값과 대조.
  if (WEBHOOK_SECRET) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== WEBHOOK_SECRET) return new Response('unauthorized', { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  const event = body?.event
  if (!event) return new Response('no event', { status: 200 })

  const type: string = event.type ?? ''
  const appUserId: string = event.app_user_id ?? ''
  const entitlementIds: string[] = event.entitlement_ids ?? []
  const expirationMs: number | null = event.expiration_at_ms ?? null

  // premium entitlement 과 무관한 이벤트는 무시.
  if (entitlementIds.length && !entitlementIds.includes(PREMIUM_ENTITLEMENT)) {
    return new Response('ignored (other entitlement)', { status: 200 })
  }
  if (!appUserId) return new Response('no app_user_id', { status: 200 })

  // 구매자 → 그룹 찾기.
  const { data: userRow } = await supabase
    .from('users')
    .select('patient_group_id')
    .eq('id', appUserId)
    .maybeSingle()
  const groupId = userRow?.patient_group_id
  if (!groupId) return new Response('no group for user', { status: 200 })

  const nowIso = new Date().toISOString()

  if (ACTIVATE_TYPES.has(type)) {
    const expiresIso = expirationMs ? new Date(expirationMs).toISOString() : null
    await supabase
      .from('patient_groups')
      .update({
        subscription_tier: 'premium',
        subscription_expires_at: expiresIso,
        subscription_payer_user_id: appUserId,
        revenuecat_synced_at: nowIso,
      })
      .eq('id', groupId)
    return new Response('activated', { status: 200 })
  }

  if (type === 'EXPIRATION') {
    await supabase
      .from('patient_groups')
      .update({
        subscription_tier: 'free',
        revenuecat_synced_at: nowIso,
      })
      .eq('id', groupId)
    return new Response('expired', { status: 200 })
  }

  // CANCELLATION(기간 끝까지 유지)·BILLING_ISSUE(유예)·TEST 등은 상태 변경 없음.
  return new Response('no-op', { status: 200 })
})
