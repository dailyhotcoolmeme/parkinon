import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  S3Client,
  DeleteObjectsCommand,
} from 'npm:@aws-sdk/client-s3@3'

// ────────────────────────────────────────────────────────────────────────────
// 역할(환자/보호자) 변경 Edge Function
//
//  · 보호자 → 환자 : DB RPC(change_role_purge) 만 호출 (삭제 없음).
//  · 환자 → 보호자 : (confirm=true 필수)
//       1) 환자가 쌓은 미디어의 R2 파일을 "정확히 그 키만" 삭제
//          (delete-account 처럼 prefix 통삭제하면 커뮤니티 사진·가족 목소리 알림음까지
//           지워지므로, 삭제되는 건강기록 행이 참조하는 키만 수집해 지운다.)
//       2) DB RPC 로 환자 기록 전체 삭제 + 역할 강등 (원자적).
//
//  요청: POST { new_role: 'patient'|'caregiver', confirm?: boolean }
//  응답: RPC 가 돌려주는 { ok, code, message } (+ 환자→보호자면 r2 통계)
// ────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** 저장값(공개 URL 또는 key)에서 정규화된 R2 key(parkinon/...) 추출. 실패 시 null. (앱 r2Get.extractR2Key 와 동일 규칙) */
function extractR2Key(keyOrUrl: string | null | undefined): string | null {
  if (typeof keyOrUrl !== 'string' || keyOrUrl.length === 0) return null
  const s = keyOrUrl
  if (s.startsWith('parkinon/')) return s.split('?')[0]
  const idx = s.indexOf('parkinon/')
  if (idx < 0) return null
  return s.slice(idx).split('?')[0]
}

/** 주어진 key 목록만 R2 에서 삭제. 실패해도 throw 하지 않고 통계 반환(DB 가 source of truth). */
async function deleteR2Keys(keys: string[]) {
  const stats = { requested: keys.length, deleted: 0, failed: 0, errors: [] as string[] }
  if (keys.length === 0) return stats

  const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT')
  const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID')
  const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')
  const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? 'parkinon-media'

  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    stats.errors.push('R2 환경변수 누락 — 객체 삭제 건너뜀')
    return stats
  }

  const R2 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })

  // DeleteObjects 는 한 번에 최대 1000개 → 청크 분할
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000)
    try {
      const resp: any = await R2.send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET_NAME,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }))
      const errCount = resp.Errors?.length ?? 0
      stats.deleted += chunk.length - errCount
      stats.failed += errCount
      if (errCount > 0) {
        for (const e of resp.Errors as any[]) stats.errors.push(`${e.Key}: ${e.Code} ${e.Message}`)
      }
    } catch (e) {
      stats.failed += chunk.length
      stats.errors.push(String(e))
    }
  }
  return stats
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    // 사용자 컨텍스트 클라이언트: RPC 의 auth.uid() 와 RLS(본인 기록 조회)가 동작하도록 JWT 사용.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const body = await req.json().catch(() => ({}))
    const newRole = body?.new_role
    const confirm = body?.confirm === true
    if (newRole !== 'patient' && newRole !== 'caregiver') {
      return new Response(JSON.stringify({ ok: false, code: 'error', message: '잘못된 역할이에요.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 현재 역할 확인 — R2 를 지우기 전에 전환 유효성부터 검사(잘못된 전환에 미디어를 지우지 않도록).
    const { data: me } = await userClient.from('users').select('role').eq('id', user.id).maybeSingle()
    const curRole = (me as any)?.role ?? null

    let r2Stats: Awaited<ReturnType<typeof deleteR2Keys>> | undefined

    // 환자 → 보호자 + 확인 완료일 때만 R2 삭제 수행.
    if (curRole === 'patient' && newRole === 'caregiver' && confirm) {
      const keys: string[] = []
      const { data: media } = await userClient.from('media_logs').select('r2_key').eq('patient_id', user.id)
      for (const r of (media ?? []) as any[]) {
        const k = extractR2Key(r?.r2_key)
        if (k) keys.push(k)
      }
      const { data: diary } = await userClient.from('diary_entries')
        .select('audio_r2_key, photo_urls').eq('patient_id', user.id)
      for (const r of (diary ?? []) as any[]) {
        const a = extractR2Key(r?.audio_r2_key)
        if (a) keys.push(a)
        for (const p of (Array.isArray(r?.photo_urls) ? r.photo_urls : [])) {
          const pk = extractR2Key(p)
          if (pk) keys.push(pk)
        }
      }
      // 방어: 본인 소유 경로만(`/${user.id}/` 포함) 삭제 — 다른 사용자/커뮤니티 파일 침범 차단.
      const safeKeys = Array.from(new Set(
        keys.filter((k) => k.startsWith('parkinon/') && k.includes(`/${user.id}/`)),
      ))
      r2Stats = await deleteR2Keys(safeKeys)
      console.log(`[change-role] R2 정리 user=${user.id}:`, JSON.stringify(r2Stats))
    }

    // DB RPC: 검증 + (환자→보호자면) 기록 완전 삭제 + 역할 변경 (원자적).
    const { data, error } = await userClient.rpc('change_role_purge', {
      p_new_role: newRole,
      p_confirm: confirm,
    })
    if (error) {
      console.error('[change-role] RPC 오류:', error)
      return new Response(JSON.stringify({ ok: false, code: 'error', message: '역할 변경 중 오류가 발생했어요.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const result = (data && typeof data === 'object') ? data : { ok: false, code: 'error', message: '알 수 없는 오류' }
    if (r2Stats) (result as any).r2 = { requested: r2Stats.requested, deleted: r2Stats.deleted, failed: r2Stats.failed }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[change-role] 오류:', e)
    return new Response(JSON.stringify({ ok: false, code: 'error', message: '역할 변경 중 오류가 발생했어요.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
