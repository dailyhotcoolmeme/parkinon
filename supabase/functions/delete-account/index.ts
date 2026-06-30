import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from 'npm:@aws-sdk/client-s3@3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 사용자별 R2 객체 일괄 삭제
//   - 반드시 user_id 가 포함된 prefix 만 사용 (다른 사용자 파일 침범 방지)
//   - ListObjectsV2 페이지네이션 처리
//   - DeleteObjects 는 한 번에 최대 1000 개
//   - 실패해도 throw 하지 않고 통계 반환 (DB 가 source of truth)
async function deleteUserR2Objects(userId: string) {
  const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT')
  const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID')
  const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')
  const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? 'parkinon-media'

  const stats = {
    listed: 0,
    deleted: 0,
    failed: 0,
    errors: [] as string[],
  }

  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    stats.errors.push('R2 환경변수 누락 — 객체 삭제 건너뜀')
    return stats
  }

  // 안전장치: user_id 형식 검증 (UUID 만 허용 — prefix 인젝션 방지)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(userId)) {
    stats.errors.push('user_id 형식 비정상 — 객체 삭제 중단')
    return stats
  }

  const R2 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })

  // 사용자가 업로드하는 모든 미디어 prefix (r2Upload.ts 와 동기화 유지)
  //   - videos : 몸상태·운동·일기 영상 (parkinon/videos/{userId}/...)
  //   - photos : 몸상태 사진 + 게시글 사진(post_media) (parkinon/photos/{userId}/...)
  //   - sounds : 가족 목소리 알림음 + 일기 음성 녹음 (parkinon/sounds/{userId}/...)
  const prefixes = [
    `parkinon/videos/${userId}/`,
    `parkinon/photos/${userId}/`,
    `parkinon/sounds/${userId}/`,
  ]

  for (const Prefix of prefixes) {
    let ContinuationToken: string | undefined = undefined
    do {
      try {
        const list: any = await R2.send(new ListObjectsV2Command({
          Bucket: R2_BUCKET_NAME,
          Prefix,
          ContinuationToken,
          MaxKeys: 1000,
        }))

        const contents = list.Contents ?? []
        stats.listed += contents.length

        if (contents.length > 0) {
          // 한 번 더 prefix 검증 — 안전장치
          const keys = contents
            .map((o: any) => o.Key as string | undefined)
            .filter((k: string | undefined): k is string =>
              typeof k === 'string' && k.startsWith(Prefix),
            )

          if (keys.length > 0) {
            // DeleteObjects 는 최대 1000개이므로 listed 1000과 동일
            const delResp: any = await R2.send(new DeleteObjectsCommand({
              Bucket: R2_BUCKET_NAME,
              Delete: {
                Objects: keys.map((Key: string) => ({ Key })),
                Quiet: true,
              },
            }))

            const deletedCount = (delResp.Deleted?.length ?? 0)
            // Quiet=true 면 Deleted 가 비어 있을 수 있으므로 요청 개수 - Errors 개수로 계산
            const errCount = (delResp.Errors?.length ?? 0)
            stats.deleted += keys.length - errCount + (deletedCount > 0 ? 0 : 0)
            stats.failed += errCount

            if (errCount > 0) {
              for (const e of delResp.Errors as any[]) {
                stats.errors.push(`${e.Key}: ${e.Code} ${e.Message}`)
              }
            }
          }
        }

        ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
      } catch (e) {
        stats.errors.push(`[${Prefix}] ${String(e)}`)
        // 이 prefix 는 중단하고 다음으로
        ContinuationToken = undefined
      }
    } while (ContinuationToken)
  }

  return stats
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // 요청한 유저의 JWT로 본인 확인
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    // Service role로 실제 삭제
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. R2 객체 삭제 (실패해도 DB 삭제는 진행)
    //    DB 삭제 전에 수행해야 r2_key 가 cascade 로 사라지더라도 영향 없음
    //    (현재 로직은 user_id prefix 기반이라 DB 조회 불필요)
    let r2Stats: Awaited<ReturnType<typeof deleteUserR2Objects>>
    try {
      r2Stats = await deleteUserR2Objects(user.id)
      console.log(`[delete-account] R2 정리 결과 user=${user.id}:`, JSON.stringify(r2Stats))
    } catch (e) {
      // 어떤 경우에도 DB 삭제를 막지 않음
      console.error('[delete-account] R2 정리 예외:', e)
      r2Stats = { listed: 0, deleted: 0, failed: 0, errors: [String(e)] }
    }

    // 2. users 테이블 데이터 삭제 (CASCADE로 연관 데이터 함께 삭제)
    const { error: usersDeleteError } = await supabaseAdmin.from('users').delete().eq('id', user.id)
    if (usersDeleteError) throw usersDeleteError

    // 3. Auth 계정 삭제
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError

    const partial = r2Stats.failed > 0 || r2Stats.errors.length > 0
    return new Response(JSON.stringify({
      success: true,
      r2: {
        listed: r2Stats.listed,
        deleted: r2Stats.deleted,
        failed: r2Stats.failed,
        partial,
      },
      message: partial
        ? '탈퇴가 완료되었습니다. 일부 파일은 정리가 지연될 수 있습니다.'
        : '탈퇴가 완료되었습니다.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[delete-account] 오류:', e)
    // 보안: 내부 에러 문자열을 클라이언트에 노출하지 않음(상세는 로그에만).
    return new Response(JSON.stringify({ error: '계정 삭제 중 오류가 발생했습니다.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
