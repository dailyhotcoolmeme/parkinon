/**
 * r2-get-url — R2 미디어 읽기용 URL 발급
 *
 * 아키텍처(Phase 2 — 워커 스트리밍 프록시):
 *   - 인가 통과 후, S3 presigned 대신 "Cloudflare 워커 URL + HMAC 토큰" 을 반환한다.
 *     워커(parkinon-media-proxy)가 R2 를 바인딩으로 직접 읽어 HEAD/GET/Range 를 모두
 *     정상 처리하므로, 영상(안드 ExoPlayer 의 HEAD 프리플라이트)도 깨지지 않는다.
 *   - 토큰 = HMAC-SHA256(R2_PROXY_SECRET, `${key}\n${exp}`) (hex). 워커와 동일 secret.
 *   - 폴백: R2_PROXY_HOST 또는 R2_PROXY_SECRET 미설정 시(워커 미배포 단계) 기존 S3 presigned
 *     GET URL 로 자동 폴백한다. → 워커 배포 + 두 시크릿 설정 전까지는 동작이 100% 동일.
 *
 *   ⚠️ 버킷은 아직 공개. 클라이언트가 리졸버 실패 시 원본 공개 URL 로 폴백하므로 안전망 유지.
 *
 * 입력: { key?: string, url?: string }  (둘 중 하나. url 이면 key 추출)
 * 인증: 사용자 JWT 필수(getUser).
 * 인가:
 *   - 커뮤니티 피드 사진(post_media 에 등록된 key/url): 로그인한 사용자 누구에게나 허용.
 *     (피드 사진은 모든 사용자에게 공개. photos/ prefix 가 의료·커뮤니티 혼재라
 *      소유자 매칭만으로는 타그룹 글이 403 되므로 post_media 등록 여부로 분기.)
 *   - videos/photos: key 의 {patient_id} 가 본인이거나 같은 patient_group 이면 허용(보호자 열람).
 *   - sounds: key 의 {uploader user id} 가 본인이거나 같은 patient_group 이면 허용
 *             (가족 목소리 알림음을 같은 그룹이 미리듣기 하는 흐름 허용).
 *   - 그 외 403.
 * 출력: { url: string, key: string }  (워커 URL+토큰, 또는 폴백 시 1시간 presigned GET)
 *
 * 참고: r2-upload / delete-r2-file 의 인증·prefix 검증 패턴 동일 적용.
 */
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

/** HMAC-SHA256(secret, message) → 소문자 hex. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 워커 프록시 URL 생성. R2_PROXY_HOST + R2_PROXY_SECRET 둘 다 있어야 한다.
 * 호스트는 workers.dev 서브도메인(예: parkinon-media-proxy.<sub>.workers.dev) 또는 커스텀 도메인.
 * 반환: https://<host>/<key>?token=<hex>&exp=<now+3600>  (없으면 null → presigned 폴백)
 */
async function buildWorkerUrl(key: string): Promise<string | null> {
  const host = (Deno.env.get('R2_PROXY_HOST') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const secret = Deno.env.get('R2_PROXY_SECRET') ?? '';
  if (!host || !secret) return null;
  const exp = Math.floor(Date.now() / 1000) + 3600; // 1시간
  const token = await hmacHex(secret, `${key}\n${exp}`);
  // key 의 슬래시는 path 구분자로 유지, 각 세그먼트만 인코딩.
  const encodedPath = key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `https://${host}/${encodedPath}?token=${token}&exp=${exp}`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 업로드와 동일한 key 패턴. videos/photos 는 {patient_id}, sounds 는 {uploader user id}.
const MEDIA_KEY_PATTERN =
  /^parkinon\/(videos|photos)\/([0-9a-fA-F-]{36})\/(\d{4})-(\d{2})\/[A-Za-z0-9_-]+\.(mp4|jpg|jpeg|png|heic)$/;
const SOUND_KEY_PATTERN =
  /^parkinon\/sounds\/([0-9a-fA-F-]{36})\/[A-Za-z0-9_-]+\.(m4a|caf|ogg|mp3|wav|aac)$/;

// 안전 화이트리스트: 모든 정상 R2 key 는 'parkinon/' 로 시작하고
// [A-Za-z0-9._/-] 문자만 포함한다(업로드 경로 규칙). 콤마·괄호·% ·공백 등
// PostgREST 필터 메타문자가 들어오면 거부 → .or()/.like() 필터 인젝션 차단.
const SAFE_KEY_PATTERN = /^parkinon\/[A-Za-z0-9._/-]+$/;

const PRESIGN_EXPIRES = 3600; // 1시간

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** 공개 URL 또는 key 문자열에서 정규화된 R2 key(parkinon/...) 를 추출. 실패 시 null. */
function extractKey(input: string): string | null {
  if (!input) return null;
  let s = input.trim();
  // 이미 key 형태면 그대로
  if (s.startsWith('parkinon/')) return s;
  // URL 이면 path 추출 후 'parkinon/' 부터 잘라냄
  try {
    const u = new URL(s);
    s = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } catch {
    // URL 이 아니면 그대로 두고 아래에서 인덱스로 시도
  }
  const idx = s.indexOf('parkinon/');
  if (idx >= 0) return s.slice(idx);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: '인증이 필요합니다.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ error: '인증이 필요합니다.' }, 401);
    }

    const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT');
    const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
    const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? 'parkinon-media';

    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      return json({ error: 'R2 환경변수가 설정되지 않았습니다.' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const raw = (body?.key ?? body?.url) as unknown;
    if (!raw || typeof raw !== 'string') {
      return json({ error: 'key 또는 url 이 필요합니다.' }, 400);
    }

    const key = extractKey(raw);
    if (!key) {
      return json({ error: 'key 형식이 올바르지 않습니다.' }, 400);
    }

    // ── 보안: DB 조회 이전에 key 화이트리스트 검증(필터 인젝션 차단) ──
    // 콤마/괄호/% 등 PostgREST 필터 메타문자가 섞인 key 는 즉시 거부한다.
    if (!SAFE_KEY_PATTERN.test(key)) {
      return json({ error: 'key 형식이 올바르지 않습니다.' }, 400);
    }

    // ── 인가 1: 커뮤니티 피드 사진은 로그인 사용자 누구나 허용 ──
    // post_media 에 이 key 가 등록돼 있으면(피드 사진) 그룹 무관 통과.
    // service_role 로 조회(RLS 우회) — 존재 여부만 확인.
    let isCommunityMedia = false;
    if (key.startsWith('parkinon/photos/')) {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (serviceKey) {
        const admin = createClient(supabaseUrl, serviceKey);
        // 문자열 보간(.or) 대신 빌더 메서드로 안전 조회(값은 supabase-js 가 인코딩).
        // 1) r2_key 정확매칭. 2) 없으면 r2_url 에 key 가 포함된 행(전체 URL 저장 케이스).
        const { data: pmByKey } = await admin
          .from('post_media')
          .select('id')
          .eq('r2_key', key)
          .limit(1)
          .maybeSingle();
        let pm = pmByKey;
        if (!pm) {
          const { data: pmByUrl } = await admin
            .from('post_media')
            .select('id')
            .like('r2_url', `%${key}%`)
            .limit(1)
            .maybeSingle();
          pm = pmByUrl;
        }
        if (pm) isCommunityMedia = true;
      }
    }

    // ── 인가 2: 그 외(의료 photos/videos/sounds)는 본인/같은그룹 검증 ──
    if (!isCommunityMedia) {
      let ownerId: string;
      const soundMatch = key.match(SOUND_KEY_PATTERN);
      if (soundMatch) {
        ownerId = soundMatch[1];
      } else {
        const m = key.match(MEDIA_KEY_PATTERN);
        if (!m) {
          return json({ error: 'key 형식이 올바르지 않습니다.' }, 400);
        }
        ownerId = m[2];
      }

      if (ownerId !== user.id) {
        const { data: sameGroup, error: rpcErr } = await supabase
          .rpc('is_same_patient_group', { target_user_id: ownerId });
        if (rpcErr || sameGroup !== true) {
          return json({ error: '해당 미디어를 열람할 권한이 없습니다.' }, 403);
        }
      }
    }

    // ── 발급: 워커 프록시 URL 우선(HEAD/Range 지원), 미설정 시 S3 presigned 폴백 ──
    const workerUrl = await buildWorkerUrl(key);
    if (workerUrl) {
      return json({ url: workerUrl, key }, 200);
    }

    // 폴백: 워커 미배포(R2_PROXY_HOST/SECRET 미설정) 단계. 기존 presigned GET 그대로.
    const R2 = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
    const presignedUrl = await getSignedUrl(R2, command, { expiresIn: PRESIGN_EXPIRES });

    return json({ url: presignedUrl, key }, 200);
  } catch (err: any) {
    console.error('r2-get-url error:', err);
    return json({ error: 'presigned GET URL 발급 실패' }, 500);
  }
});
