// 환불 정합성 보정 — Google Play 에 직접 환불 목록을 물어 프리미엄을 회수한다.
//
// 왜 필요한가:
//   환불이 앱에 반영되는 경로는 RevenueCat 웹훅뿐인데, 그건 Play 실시간 개발자 알림(RTDN)
//   설정에 의존한다. 설정이 빠지거나 끊기면 환불받은 사용자가 프리미엄을 계속 쓴다.
//   Google 의 voidedpurchases API 는 우리 서비스 계정으로 직접 조회되므로, 이걸 정본으로
//   삼아 주기적으로 회수한다. RevenueCat 상태와 무관하게 동작하는 안전망이다.
//
// 호출: pg_cron 이 CRON_SECRET 헤더와 함께 주기 호출.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const PACKAGE_NAME = Deno.env.get('ANDROID_PACKAGE_NAME') ?? 'com.ourmine.parkinon'
/** Play Developer API 용 서비스 계정 키(JSON 문자열). */
const SA_KEY_RAW = Deno.env.get('GOOGLE_PLAY_SA_KEY') ?? ''

/**
 * 조회 범위. Google 이 30일을 넘는 startTime 을 400 으로 거부하므로 그 안쪽으로 둔다
 * ("Start time must be within [30] days of data"). 이보다 오래된 환불은 이미 만료로
 * 정리됐다고 본다(월 구독 기준 한 주기가 지났다).
 */
const LOOKBACK_DAYS = 29

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PEM(PKCS#8) → CryptoKey */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0))
  return await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** 서비스 계정 JWT 로 Play Developer API 액세스 토큰 발급. */
async function googleAccessToken(): Promise<string | null> {
  if (!SA_KEY_RAW) return null
  const sa = JSON.parse(SA_KEY_RAW)
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })))
  const key = await importKey(sa.private_key)
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`),
  )
  const assertion = `${header}.${claim}.${b64url(new Uint8Array(sig))}`

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!r.ok) {
    console.error('[reconcile-refunds] failed to issue a token:', await r.text())
    return null
  }
  return (await r.json()).access_token ?? null
}

/**
 * 최근 환불 주문번호 집합(갱신분 "..N" 접미사는 떼어 원 주문번호로 모은다).
 * ⚠️ 조회에 실패하면 빈 집합이 아니라 예외를 던진다. 빈 집합으로 돌려주면
 *   "환불 없음" 과 구분되지 않아, 조회가 깨진 채로 정상처럼 보인다.
 */
async function voidedOrderIds(token: string): Promise<Set<string>> {
  const start = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const ids = new Set<string>()
  let token_ = ''
  for (let page = 0; page < 20; page++) {
    const url = new URL(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/voidedpurchases`,
    )
    url.searchParams.set('startTime', String(start))
    url.searchParams.set('maxResults', '1000')
    url.searchParams.set('type', '1') // 구독 포함
    if (token_) url.searchParams.set('token', token_)

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) {
      throw new Error(`voidedpurchases ${r.status}: ${(await r.text()).slice(0, 300)}`)
    }
    const j = await r.json()
    for (const v of j.voidedPurchases ?? []) {
      const oid: string = v.orderId ?? ''
      if (oid) ids.add(oid.split('..')[0])
    }
    token_ = j.tokenPagination?.nextPageToken ?? ''
    if (!token_) break
  }
  return ids
}

const PREMIUM_ENTITLEMENT = 'premium'
const RC_PUBLIC_KEY = Deno.env.get('REVENUECAT_PUBLIC_KEY') ?? 'goog_uaXvxBhEdIaKrxJgpKGktHZPbKf'
/** 갱신 공백에 잘못 강등하지 않도록 두는 여유(앱·웹훅과 동일 값). */
const RENEWAL_GRACE_MS = 3 * 60 * 1000

/**
 * 프리미엄으로 남아 있는 그룹의 실제 권한을 RevenueCat 에 대조해 회수한다.
 *
 * 왜 필요한가: 환불+회수(revoke)는 Google 의 환불 목록에 바로 안 뜨는데(실측 2026-07-27:
 * 회수 4분 뒤에도 미노출), RevenueCat 의 권한 상태에는 즉시 반영된다. 웹훅이 유실되거나
 * 가드에 걸려 버려지는 경우까지 덮으려면 상태를 직접 대조하는 경로가 하나 더 있어야 한다.
 */
async function reconcileAgainstRevenueCat(): Promise<number> {
  const { data: groups } = await supabase
    .from('patient_groups')
    .select('id, subscription_payer_user_id, subscription_expires_at')
    .eq('subscription_tier', 'premium')
    .not('subscription_payer_user_id', 'is', null)
  if (!groups?.length) return 0

  let revoked = 0
  for (const g of groups) {
    // 갱신 직후 공백에는 건드리지 않는다(만료일이 아직 여유 안에 있으면 판단 보류).
    const expMs = g.subscription_expires_at ? new Date(g.subscription_expires_at).getTime() : null
    if (expMs !== null && Math.abs(Date.now() - expMs) < RENEWAL_GRACE_MS) continue

    let active: boolean
    try {
      const r = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(g.subscription_payer_user_id!)}`,
        { headers: { Authorization: `Bearer ${RC_PUBLIC_KEY}`, 'X-Platform': 'android' } },
      )
      if (!r.ok) continue // 조회 실패 시 판단 보류 — 잘못 강등하는 것보다 낫다
      const j = await r.json()
      const ent = j?.subscriber?.entitlements?.[PREMIUM_ENTITLEMENT]
      const e = ent?.expires_date ? new Date(ent.expires_date).getTime() : null
      active = !!ent && (e === null || e > Date.now())
    } catch {
      continue
    }
    if (active) continue

    await supabase
      .from('patient_groups')
      .update({
        subscription_tier: 'free',
        subscription_expires_at: null,
        revenuecat_synced_at: new Date().toISOString(),
      })
      .eq('id', g.id)
    try {
      await supabase.rpc('reset_group_custom_sounds', { p_group_id: g.id })
    } catch (e) {
      console.error('[reconcile-refunds] reset_group_custom_sounds failed:', g.id, e)
    }
    await supabase.from('revenuecat_events').insert({
      event_type: 'ENTITLEMENT_RECONCILE',
      app_user_id: g.subscription_payer_user_id,
      result: 'revoked (entitlement inactive)',
      payload: { group: g.id },
    })
    revoked++
  }
  return revoked
}

Deno.serve(async (req: Request) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  // 권한 대조는 Google 자격증명 없이도 되므로 먼저 돌린다.
  const entRevoked = await reconcileAgainstRevenueCat()

  const token = await googleAccessToken()
  if (!token) return new Response(`entitlement revoked ${entRevoked}; no google credentials`, { status: 200 })

  let voided: Set<string>
  try {
    voided = await voidedOrderIds(token)
  } catch (e) {
    // 실패를 200 으로 감추면 안 된다. 환불 회수가 멈춘 걸 아무도 모르게 된다.
    console.error('[reconcile-refunds]', e)
    return new Response(`voided lookup failed: ${e instanceof Error ? e.message : e}`, { status: 502 })
  }
  if (voided.size === 0) {
    return new Response(`entitlement revoked ${entRevoked}; no voided purchases`, { status: 200 })
  }

  // 환불된 구독이 아직 프리미엄으로 붙어 있는 그룹만 회수한다.
  const { data: hit, error } = await supabase
    .from('patient_groups')
    .select('id, subscription_original_txn_id')
    .eq('subscription_tier', 'premium')
    .in('subscription_original_txn_id', [...voided])
  if (error) {
    console.error('[reconcile-refunds] lookup failed:', error)
    return new Response('query failed', { status: 500 })
  }
  if (!hit?.length) {
    return new Response(
      `entitlement revoked ${entRevoked}; checked ${voided.size} voided, nothing to revoke`,
      { status: 200 },
    )
  }

  const ids = hit.map((g) => g.id)
  await supabase
    .from('patient_groups')
    .update({
      subscription_tier: 'free',
      subscription_expires_at: null,
      revenuecat_synced_at: new Date().toISOString(),
    })
    .in('id', ids)

  // 프리미엄 전용 설정(커스텀 알림음) 원복 — 만료 처리와 동일하게 맞춘다.
  for (const gid of ids) {
    try {
      await supabase.rpc('reset_group_custom_sounds', { p_group_id: gid })
    } catch (e) {
      console.error('[reconcile-refunds] reset_group_custom_sounds failed:', gid, e)
    }
  }

  // 사후 추적을 위해 남긴다(웹훅 이벤트와 같은 표).
  await supabase.from('revenuecat_events').insert({
    event_type: 'REFUND_RECONCILE',
    app_user_id: null,
    result: `revoked ${ids.length} group(s)`,
    payload: { groups: hit },
  })

  return new Response(`entitlement revoked ${entRevoked}; voided revoked ${ids.length}`, { status: 200 })
})
