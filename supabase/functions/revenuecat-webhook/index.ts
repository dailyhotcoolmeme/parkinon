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

/**
 * 갱신 유예 — 앱(SubscriptionContext.RENEWAL_GRACE_MS)과 같은 값을 쓴다.
 * 만료 직후 이 시간 안의 EXPIRATION 은 "갱신 진행 중"으로 보고 강등을 보류한다.
 * 두 값이 어긋나면 앱은 프리미엄인데 서버는 free 인 구간이 생기므로 함께 바꿀 것.
 */
const RENEWAL_GRACE_MS = 3 * 60 * 1000 // 3분 — 앱과 동일 값 유지

const ACTIVATE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  // 스토어 API 로 구독이 연장되거나, Google 이 갱신 청구를 24시간 미만 지연시킬 때 발생.
  // 처리하지 않으면 DB 만료일이 옛 값으로 남아 결제 중인 사용자가 조기 강등된다.
  'SUBSCRIPTION_EXTENDED',
])

// RevenueCat 조회용 공개 SDK 키(클라이언트에 이미 박혀 있는 공개 값. 비밀 아님).
// TRANSFER 이벤트에는 만료일이 없어서, 이전받은 사용자의 현재 권한을 직접 조회해야 한다.
const RC_PUBLIC_KEY = Deno.env.get('REVENUECAT_PUBLIC_KEY') ?? 'goog_uaXvxBhEdIaKrxJgpKGktHZPbKf'

/** 해당 app_user_id 의 premium 권한 현재 상태. 조회 실패 시 null(=판단 보류). */
async function fetchPremiumState(
  appUserId: string,
): Promise<{ active: boolean; expiresMs: number | null } | null> {
  try {
    const r = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      { headers: { Authorization: `Bearer ${RC_PUBLIC_KEY}`, 'X-Platform': 'android' } },
    )
    if (!r.ok) return null
    const j = await r.json()
    const ent = j?.subscriber?.entitlements?.[PREMIUM_ENTITLEMENT]
    if (!ent) return { active: false, expiresMs: null }
    const expiresMs = ent.expires_date ? new Date(ent.expires_date).getTime() : null
    return { active: expiresMs === null || expiresMs > Date.now(), expiresMs }
  } catch {
    return null
  }
}

/** app_user_id → 그 사용자의 가족 그룹 id */
async function groupIdOf(appUserId: string): Promise<string | null> {
  const { data } = await supabase
    .from('users')
    .select('patient_group_id')
    .eq('id', appUserId)
    .maybeSingle()
  return data?.patient_group_id ?? null
}

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

  // ── TRANSFER: 구독이 다른 App User ID 로 이전됨 ─────────────────────────────
  // 기기 교체·재설치·복원 시 RevenueCat 이 권한을 다른 사용자로 옮기며 발생한다.
  // 처리하지 않으면 옛 그룹은 프리미엄이 남고 새 그룹은 승격되지 않는다.
  // 이 이벤트에는 app_user_id / 만료일이 없으므로 아래 공통 로직보다 먼저 처리한다.
  if (type === 'TRANSFER') {
    const fromIds: string[] = Array.isArray(event.transferred_from) ? event.transferred_from : []
    const toIds: string[] = Array.isArray(event.transferred_to) ? event.transferred_to : []
    const nowIsoT = new Date().toISOString()

    // 넘겨준 쪽: 그 사용자에게 권한이 실제로 없어졌는지 확인한 뒤에만 강등한다.
    for (const uid of fromIds) {
      const gid = await groupIdOf(uid)
      if (!gid) continue
      const state = await fetchPremiumState(uid)
      if (state?.active) continue // 아직 살아 있으면 건드리지 않음
      await supabase
        .from('patient_groups')
        .update({ subscription_tier: 'free', subscription_expires_at: null, revenuecat_synced_at: nowIsoT })
        .eq('id', gid)
    }

    // 넘겨받은 쪽: 현재 권한을 조회해 그대로 반영. 조회 실패 시 아무것도 하지 않는다
    // (곧 오는 RENEWAL 이 바로잡는다 — 잘못된 값을 쓰는 것보다 낫다).
    for (const uid of toIds) {
      const gid = await groupIdOf(uid)
      if (!gid) continue
      const state = await fetchPremiumState(uid)
      if (!state || !state.active) continue
      await supabase
        .from('patient_groups')
        .update({
          subscription_tier: 'premium',
          subscription_expires_at: state.expiresMs ? new Date(state.expiresMs).toISOString() : null,
          subscription_payer_user_id: uid,
          revenuecat_synced_at: nowIsoT,
        })
        .eq('id', gid)
    }
    return new Response(`transfer handled (from=${fromIds.length}, to=${toIds.length})`, { status: 200 })
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

  // ⚠️ 웹훅 도착 순서는 보장되지 않는다.
  //   갱신 시점에는 이전 기간의 EXPIRATION 과 새 기간의 RENEWAL 이 함께 발생하는데,
  //   RENEWAL 이 먼저 처리된 뒤 늦게 온 EXPIRATION 이 조건 없이 free 로 덮으면
  //   결제가 살아 있는데도 그룹이 강등된다(실측 2026-07-27: tier=free 인데 만료일은 미래).
  //   → 저장된 만료일(=이미 반영된 기간)과 이벤트의 만료일을 비교해 "지난 이벤트"는 버린다.
  const { data: groupRow } = await supabase
    .from('patient_groups')
    .select('subscription_expires_at')
    .eq('id', groupId)
    .maybeSingle()
  const storedMs = groupRow?.subscription_expires_at
    ? new Date(groupRow.subscription_expires_at).getTime()
    : 0
  const eventMs = expirationMs ?? 0

  if (ACTIVATE_TYPES.has(type)) {
    // 이미 더 나중 기간이 반영돼 있으면(늦게 도착한 옛 활성 이벤트) 무시.
    if (storedMs && eventMs && eventMs < storedMs) {
      return new Response('stale activation ignored', { status: 200 })
    }
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
    // 이 만료 이벤트가 "이미 갱신된 더 나중 기간"보다 과거면 지난 기간 것 → 강등하지 않는다.
    if (storedMs && eventMs && eventMs < storedMs) {
      return new Response('stale expiration ignored', { status: 200 })
    }
    // 저장된 만료일이 아직 미래면(= 유효한 구독이 살아 있음) 역시 강등하지 않는다.
    if (storedMs > Date.now()) {
      return new Response('still active, expiration ignored', { status: 200 })
    }
    // ⚠️ 갱신 진행 중일 수 있는 구간은 강등하지 않는다.
    //   갱신은 "이전 기간 EXPIRATION → 새 기간 RENEWAL" 순서로 오고 그 사이에 공백이 있다.
    //   방금 만료된 건을 즉시 free 로 내리면, 정상 결제 중인 사용자에게 결제창이 떴다가 사라진다
    //   (오너 실측 2026-07-27: 체험 종료 직후 20초). RENEWAL 이 곧 도착해 premium 을 재확정하고,
    //   진짜 해지된 구독은 만료일이 지난 채로 남아 앱이 자체 유예(RENEWAL_GRACE) 후 free 로 본다.
    if (eventMs && Date.now() - eventMs < RENEWAL_GRACE_MS) {
      return new Response('renewal in flight, expiration deferred', { status: 200 })
    }
    await supabase
      .from('patient_groups')
      .update({
        subscription_tier: 'free',
        // 강등 시 만료일도 같이 정리한다. 안 그러면 "free 인데 만료일은 미래"라는
        // 모순 상태가 남아 다음 이벤트 판정까지 꼬인다.
        subscription_expires_at: expirationMs ? new Date(expirationMs).toISOString() : null,
        revenuecat_synced_at: nowIso,
      })
      .eq('id', groupId)
    // 다운그레이드 → 커스텀 알림음(프리미엄 기능)을 기본음으로 되돌린다.
    // 녹음(custom_sounds)은 삭제 안 함(재구독 시 재선택). 실패해도 만료 처리 자체는 성공 응답.
    try {
      await supabase.rpc('reset_group_custom_sounds', { p_group_id: groupId })
    } catch (e) {
      console.error('[revenuecat-webhook] reset_group_custom_sounds 실패:', e)
    }
    return new Response('expired', { status: 200 })
  }

  // CANCELLATION(기간 끝까지 유지)·BILLING_ISSUE(유예)·TEST 등은 상태 변경 없음.
  return new Response('no-op', { status: 200 })
})
