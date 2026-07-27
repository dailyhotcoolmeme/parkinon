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

/**
 * 그룹이 없으면 만들어서 붙인다.
 * 구독은 그룹 단위로 저장되는데, 그룹은 (1) 환자 온보딩 완료 (2) 가족 연동에서 초대코드 생성
 * 두 경로에서만 만들어진다. 그래서 "보호자로 가입하고 아직 연동 안 한 사용자"나
 * "역할만 바꾼 사용자"는 그룹이 없고, 결제해도 권한을 붙일 곳이 없어 조용히 사라진다
 * (실측 2026-07-27: 결제는 되는데 앱은 계속 free. 웹훅은 200 으로 응답해 실패로도 안 잡힘).
 * → 결제 시점에 그룹을 만들어 결제 유실을 막는다. 나중에 초대코드로 합류하면
 *   join_family_by_code → _fl_move_self_into_group 이 이 그룹을 지우고 옮겨준다.
 */
async function ensureGroupFor(appUserId: string): Promise<string | null> {
  // ⚠️ 여기서 직접 insert 하지 않는다 — invite_code 는 NOT NULL + UNIQUE 라 코드 생성과
  //   충돌 재시도가 필요하다. 예전엔 insert({}) 로 시도해 항상 실패했고, 그 실패가 조용히
  //   무시돼 결제가 유실됐다(실측 2026-07-27). DB 함수에 원자적으로 맡긴다.
  const { data, error } = await supabase.rpc('ensure_group_for_user', { p_user_id: appUserId })
  if (error) {
    console.error('[revenuecat-webhook] 그룹 확보 실패:', error)
    return null
  }
  return (data as string | null) ?? null
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

  // ⚠️ 들어온 이벤트와 처리 결과를 반드시 남긴다.
  //   기록이 없으면 "결제는 됐는데 앱은 free" 같은 사고에서 어떤 이벤트가 왔는지조차
  //   확인할 수 없어 원인 규명이 불가능하다(실측 2026-07-27: 웹훅은 200 인데 DB 는 그대로).
  let result = 'unhandled'
  try {
    result = await handleEvent(body)
  } catch (e) {
    result = `error: ${e instanceof Error ? e.message : String(e)}`
    console.error('[revenuecat-webhook]', e)
  }
  try {
    await supabase.from('revenuecat_events').insert({
      event_type: body?.event?.type ?? null,
      app_user_id: body?.event?.app_user_id ?? null,
      result,
      payload: body,
    })
  } catch (e) {
    console.error('[revenuecat-webhook] 이벤트 로그 실패:', e)
  }
  return new Response(result, { status: 200 })
})

/** 이벤트 처리. 반환값은 처리 결과 설명(응답 본문 겸 로그). */
async function handleEvent(body: any): Promise<string> {
  const event = body?.event
  if (!event) return 'no event'

  const type: string = event.type ?? ''
  const appUserId: string = event.app_user_id ?? ''
  const entitlementIds: string[] = event.entitlement_ids ?? []
  const expirationMs: number | null = event.expiration_at_ms ?? null

  // premium entitlement 과 무관한 이벤트는 무시.
  if (entitlementIds.length && !entitlementIds.includes(PREMIUM_ENTITLEMENT)) {
    return 'ignored (other entitlement)'
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
      // 넘겨받는 쪽에 그룹이 없으면 만들어서 붙인다. 없다고 건너뛰면 구독이 갈 곳을 잃는다
      // (실측 2026-07-27: RevenueCat 은 이전됐는데 DB 는 그룹이 없어 프리미엄이 안 붙음).
      const gid = await ensureGroupFor(uid)
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
    return `transfer handled (from=${fromIds.length}, to=${toIds.length})`
  }

  if (!appUserId) return 'no app_user_id'

  // 구매자 → 그룹 찾기.
  // 활성화 이벤트인데 그룹이 없으면 만들어서 붙인다(결제 유실 방지).
  // 그 외 이벤트(만료·해지 등)는 붙일 대상이 없으면 할 일도 없으므로 그냥 종료.
  const groupId = ACTIVATE_TYPES.has(type)
    ? await ensureGroupFor(appUserId)
    : await groupIdOf(appUserId)
  if (!groupId) return 'no group for user'

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
      return 'stale activation ignored'
    }
    const expiresIso = expirationMs ? new Date(expirationMs).toISOString() : null
    // 스토어 구독 식별자. 기기·계정 이전(TRANSFER) 후에도 같은 값이 유지되므로,
    // "이 구독이 지금 어느 그룹에 붙어 있는지"를 이걸로 추적한다.
    const txnId: string | null = event.original_transaction_id ?? event.transaction_id ?? null

    await supabase
      .from('patient_groups')
      .update({
        subscription_tier: 'premium',
        subscription_expires_at: expiresIso,
        subscription_payer_user_id: appUserId,
        subscription_original_txn_id: txnId,
        revenuecat_synced_at: nowIso,
      })
      .eq('id', groupId)

    // ⚠️ 같은 구독이 다른 그룹에 남아 있으면 내린다.
    //   계정을 옮겨 복원하면 새 그룹은 premium 이 되는데 옛 그룹이 그대로 남아,
    //   구독 하나로 두 그룹이 프리미엄을 쓰는 상태가 됐다(실측 2026-07-27).
    //   TRANSFER 이벤트 유무와 무관하게 활성화 시점에 정리하므로 경로에 상관없이 막힌다.
    if (txnId) {
      await supabase
        .from('patient_groups')
        .update({
          subscription_tier: 'free',
          subscription_expires_at: null,
          revenuecat_synced_at: nowIso,
        })
        .eq('subscription_original_txn_id', txnId)
        .neq('id', groupId)
    }
    return 'activated'
  }

  // ── 결제 실패(유예기간) · 해지 예약 ────────────────────────────────────────
  // 둘 다 "아직 접근을 유지해야 하는" 상태다.
  //  · BILLING_ISSUE / CANCELLATION(BILLING_ERROR): 카드 실패. 구글이 유예기간만큼
  //    만료일을 연장하므로 그 값을 반영해야 한다. 예전엔 두 이벤트를 모두 무시해서
  //    DB 만료일이 옛 기간에 머물렀고, 유예기간 중인 고객이 무료로 떨어졌다
  //    (실측 2026-07-27: Google=IN_GRACE_PERIOD 인데 앱은 결제창 노출).
  //  · CANCELLATION(UNSUBSCRIBE): 자동갱신만 끈 것. 기간 끝까지 유지가 맞다.
  // 어느 경우도 강등하지 않는다. 실제 접근 종료는 EXPIRATION 이 판단한다.
  //
  // ⚠️ 단, CANCELLATION 을 사유 구분 없이 "유지"로 처리하면 안 된다.
  //   환불(CUSTOMER_SUPPORT)·개발자 해지(DEVELOPER_INITIATED)도 같은 타입으로 오는데,
  //   이때 만료일을 세우면 이미 환불된 구독이 다시 premium 으로 살아난다
  //   (실측 2026-07-27: free 로 내린 직후 웹훅이 premium 으로 되돌림 — 오너 발견).
  //   접근을 유지해야 하는 사유만 화이트리스트로 둔다.
  const KEEP_ACCESS_CANCEL_REASONS = new Set([
    'UNSUBSCRIBE',      // 사용자가 자동갱신만 끔 → 남은 기간 유지
    'BILLING_ERROR',    // 결제 실패 → 유예기간 동안 유지
    'PRICE_INCREASE',   // 가격 인상 미동의 → 현 기간 끝까지 유지
  ])
  const cancelReason: string = event.cancel_reason ?? ''
  const keepAccess = type === 'BILLING_ISSUE' || KEEP_ACCESS_CANCEL_REASONS.has(cancelReason)

  if (type === 'CANCELLATION' && !keepAccess) {
    // 환불(CUSTOMER_SUPPORT)·개발자 해지(DEVELOPER_INITIATED) 등 접근을 유지하지 않는 사유.
    // ⚠️ EXPIRATION 에만 맡기면 안 된다 — 그 이벤트가 안 오거나 가드에 걸려 버려지면
    //   환불받은 사용자가 남은 기간 내내 프리미엄을 쓴다. 실제 권한을 확인해 끊는다.
    const live = await fetchPremiumState(appUserId)
    if (live && !live.active) {
      await supabase
        .from('patient_groups')
        .update({
          subscription_tier: 'free',
          subscription_expires_at: null,
          revenuecat_synced_at: nowIso,
        })
        .eq('id', groupId)
      try {
        await supabase.rpc('reset_group_custom_sounds', { p_group_id: groupId })
      } catch (e) {
        console.error('[revenuecat-webhook] reset_group_custom_sounds 실패:', e)
      }
      return `cancellation (${cancelReason || 'unknown'}): revoked`
    }
    return `cancellation (${cancelReason || 'unknown'}): no access grant`
  }

  if (type === 'BILLING_ISSUE' || type === 'CANCELLATION') {
    if (eventMs && eventMs > storedMs) {
      await supabase
        .from('patient_groups')
        .update({
          subscription_tier: 'premium',
          subscription_expires_at: new Date(eventMs).toISOString(),
          revenuecat_synced_at: nowIso,
        })
        .eq('id', groupId)
      return 'access kept, expiry refreshed'
    }
    return 'access kept, no expiry change'
  }

  if (type === 'EXPIRATION') {
    // ⚠️ 아래 보수적 가드(늦게 온 이벤트·갱신 중)보다 먼저, 실제 권한을 확인한다.
    //   환불+회수(revoke)는 기간이 한참 남은 구독을 즉시 끊는데, 그때 오는 EXPIRATION 은
    //   "만료시각 = 지금" 이라 저장된 만료일(미래)보다 과거로 보인다. 가드만 믿으면
    //   'stale expiration ignored' 로 버려지고, 환불받은 사용자가 남은 기간 내내
    //   프리미엄을 쓴다(실측 2026-07-27: 회수 직후 EXPIRATION 이 무시됨).
    //   RevenueCat 은 회수를 정확히 반영하므로, 권한이 없다고 하면 즉시 강등한다.
    const live = await fetchPremiumState(appUserId)
    if (live && !live.active) {
      await supabase
        .from('patient_groups')
        .update({
          subscription_tier: 'free',
          subscription_expires_at: null,
          revenuecat_synced_at: nowIso,
        })
        .eq('id', groupId)
      try {
        await supabase.rpc('reset_group_custom_sounds', { p_group_id: groupId })
      } catch (e) {
        console.error('[revenuecat-webhook] reset_group_custom_sounds 실패:', e)
      }
      return 'revoked (entitlement inactive)'
    }

    // 이 만료 이벤트가 "이미 갱신된 더 나중 기간"보다 과거면 지난 기간 것 → 강등하지 않는다.
    if (storedMs && eventMs && eventMs < storedMs) {
      return 'stale expiration ignored'
    }
    // 저장된 만료일이 아직 미래면(= 유효한 구독이 살아 있음) 역시 강등하지 않는다.
    if (storedMs > Date.now()) {
      return 'still active, expiration ignored'
    }
    // ⚠️ 갱신 진행 중일 수 있는 구간은 강등하지 않는다.
    //   갱신은 "이전 기간 EXPIRATION → 새 기간 RENEWAL" 순서로 오고 그 사이에 공백이 있다.
    //   방금 만료된 건을 즉시 free 로 내리면, 정상 결제 중인 사용자에게 결제창이 떴다가 사라진다
    //   (오너 실측 2026-07-27: 체험 종료 직후 20초). RENEWAL 이 곧 도착해 premium 을 재확정하고,
    //   진짜 해지된 구독은 만료일이 지난 채로 남아 앱이 자체 유예(RENEWAL_GRACE) 후 free 로 본다.
    if (eventMs && Date.now() - eventMs < RENEWAL_GRACE_MS) {
      return 'renewal in flight, expiration deferred'
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
    return 'expired'
  }

  // CANCELLATION(기간 끝까지 유지)·BILLING_ISSUE(유예)·TEST 등은 상태 변경 없음.
  return 'no-op'
}
