import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { ErrorCode, errorResponse } from '../_shared/errors.ts';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// C6: key 경로 정규식. parkinon/(videos|photos)/{UUID(patient_id)}/YYYY-MM/{slug}.(mp4|jpg|jpeg|png|heic)
const KEY_PATTERN =
  /^parkinon\/(videos|photos)\/([0-9a-fA-F-]{36})\/(\d{4})-(\d{2})\/[A-Za-z0-9_-]+\.(mp4|jpg|jpeg|png|heic)$/;

// 커뮤니티(정보/나눔) 게시판 사진: parkinon/community/{UUID(uploader user id)}/YYYY-MM/{slug}.(jpg|jpeg|png|heic)
// videos/photos 와 분리된 prefix — 워커가 이 경로만 토큰 없이 공개 서빙(민감정보 아님).
const COMMUNITY_KEY_PATTERN =
  /^parkinon\/community\/([0-9a-fA-F-]{36})\/(\d{4})-(\d{2})\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|heic)$/;

// 커뮤니티 사진은 토큰 없이 워커 공개 URL 로 직접 서빙. (R2_PUBLIC_URL=r2.dev 는 비공개 전환됨)
const R2_PROXY_HOST = Deno.env.get('R2_PROXY_HOST') ?? '';

// 알림음(개인 녹음): parkinon/sounds/{UUID(uploader user id)}/{slug}.(m4a|caf|ogg|mp3|wav|aac)
const SOUND_KEY_PATTERN =
  /^parkinon\/sounds\/([0-9a-fA-F-]{36})\/[A-Za-z0-9_-]+\.(m4a|caf|ogg|mp3|wav|aac)$/;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg',
  'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/x-caf', 'application/octet-stream',
]);

const ALLOWED_VIDEO_TYPES = new Set(['video/mp4']);
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT');
    const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
    const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? 'parkinon-media';
    const R2_PUBLIC_URL = Deno.env.get('R2_PUBLIC_URL') ?? '';

    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      return new Response(
        JSON.stringify({ error: 'R2 environment variables are not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json();
    const { key, contentType } = body ?? {};

    if (!key || !contentType || typeof key !== 'string' || typeof contentType !== 'string') {
      return new Response(
        JSON.stringify({ error: 'key or contentType is missing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // C6: key 패턴 검증 (sounds 우선 → community → videos/photos)
    let ownerId: string;
    let isCommunity = false;
    const soundMatch = key.match(SOUND_KEY_PATTERN);
    const communityMatch = key.match(COMMUNITY_KEY_PATTERN);
    if (soundMatch) {
      ownerId = soundMatch[1];
      if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
        return new Response(
          JSON.stringify({ error: 'audio contentType not allowed' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    } else if (communityMatch) {
      // 커뮤니티 사진: 업로더 본인 경로에만(=ownerId 가 곧 user.id). 이미지 타입만.
      isCommunity = true;
      ownerId = communityMatch[1];
      const month = Number(communityMatch[3]);
      if (month < 1 || month > 12) {
        return new Response(
          JSON.stringify({ error: 'invalid YYYY-MM segment in key' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
        return errorResponse(ErrorCode.INVALID_CONTENT_TYPE, 400, 'content type not allowed', corsHeaders);
      }
    } else {
      const m = key.match(KEY_PATTERN);
      if (!m) {
        return new Response(
          JSON.stringify({ error: 'invalid key format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const kind = m[1] as 'videos' | 'photos';
      ownerId = m[2];
      const month = Number(m[4]);
      if (month < 1 || month > 12) {
        return new Response(
          JSON.stringify({ error: 'invalid YYYY-MM segment in key' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const allowedTypes = kind === 'videos' ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
      if (!allowedTypes.has(contentType)) {
        return errorResponse(ErrorCode.INVALID_CONTENT_TYPE, 400, 'content type not allowed', corsHeaders);
      }
    }

    // C6: 소유권 검증
    //  - sounds(개인 알림음): 본인만 업로드 가능 — 같은 그룹 멤버라도 타인 prefix 쓰기 금지.
    //  - videos/photos: 본인 또는 같은 patient_group 멤버(보호자 대리 업로드 허용).
    if (ownerId !== user.id) {
      if (soundMatch || isCommunity) {
        return errorResponse(ErrorCode.FORBIDDEN_PATH, 403, 'may only upload to own path', corsHeaders);
      }
      const { data: sameGroup, error: rpcErr } = await supabase
        .rpc('is_same_patient_group', { target_user_id: ownerId });
      if (rpcErr || sameGroup !== true) {
        return errorResponse(ErrorCode.FORBIDDEN_UPLOAD, 403, 'not permitted to upload to this path', corsHeaders);
      }
    }

    // ── 무료 한도 서버 강제 (2026-07-27) ─────────────────────────────────────
    // 지금까지 한도는 화면 코드에서만 판정했다. 변조 클라이언트나 직접 API 호출로
    // 무제한 업로드가 가능했고 R2 비용에 직결된다.
    // ⚠️ "이미 저장된 행"만 세면 막을 수 없다 — 저장하지 않고 발급만 반복하면 카운트가 0으로
    //   유지되기 때문. 그래서 발급 자체를 media_upload_grants 에 기록하고 그걸 센다.
    const kind: 'photo' | 'video' | 'voice' | 'community' =
      isCommunity ? 'community'
      : soundMatch ? 'voice'
      : key.startsWith('parkinon/videos/') ? 'video'
      : 'photo';

    // 한도 집계 단위 = 가족 그룹(구독이 그룹 단위이므로).
    // videos/photos 는 경로의 환자 id 기준, sounds/community 는 업로더 기준으로 그룹을 찾는다.
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const quotaOwnerId = (soundMatch || isCommunity) ? user.id : ownerId;
    const { data: ownerRow } = await admin
      .from('users')
      .select('patient_group_id, timezone')
      .eq('id', quotaOwnerId)
      .maybeSingle();
    const groupId = ownerRow?.patient_group_id ?? null;

    if (groupId) {
      const { data: groupRow } = await admin
        .from('patient_groups')
        .select('subscription_tier, subscription_expires_at')
        .eq('id', groupId)
        .maybeSingle();
      // ⚠️ 앱(SubscriptionContext.RENEWAL_GRACE_MS)과 반드시 같은 유예를 적용해야 한다.
      //   갱신 공백 구간에 앱은 프리미엄으로 보고 무제한 첨부를 허용하는데 서버만 free 로 판정하면,
      //   사용자는 6장째에서 원인 모를 저장 실패를 본다(실측 2026-07-27: 만료 2분 뒤 429).
      const RENEWAL_GRACE_MS = 3 * 60 * 1000; // 앱·웹훅과 동일 값 유지
      const exp = groupRow?.subscription_expires_at
        ? new Date(groupRow.subscription_expires_at).getTime()
        : null;
      const isPremium = groupRow?.subscription_tier === 'premium'
        && (exp === null || exp + RENEWAL_GRACE_MS > Date.now());

      const tz = ownerRow?.timezone || 'Asia/Seoul';

      // ⚠️ 설계 원칙 (2026-07-27, 두 번의 사고 뒤 확정)
      //   서버는 앱의 UX 규칙(5장/2개/1개, 삭제 시 슬롯 복구, 편집 중 글 제외)을 흉내 내지 않는다.
      //   그 규칙은 "현재 부착 수", "지금 편집 중인 글 제외" 같은 클라이언트만 아는 맥락에 의존하고,
      //   서버가 이를 재현하려다 정상 사용자를 두 번 막았다:
      //     · 갱신 유예 불일치 → 사진 6장째 원인 모를 실패
      //     · 발급 누적으로 카운트 → 영상 지우고 재업로드 불가
      //     · (미발생) 편집 중인 글 제외 안 됨 → 사진 5장짜리 글 수정 시 저장 불가
      //   서버의 역할은 "정확한 한도 집행"이 아니라 "무한 남용 차단"이다.
      //   정확한 한도는 앱이 집행하고, 서버는 정상 사용으로는 절대 닿지 않는 상한만 둔다.
      //   → 변조 클라이언트도 '무제한'이 아니라 '상한까지'로 묶인다(비용 방어 목적 달성).
      const ABUSE_CAP = isPremium
        ? { photo: 600, video: 120, voice: 120, community: 200 }
        : { photo: 40, video: 20, voice: 15, community: 60 };
      const { data: issued } = await admin.rpc('count_upload_grants_today', {
        p_group_id: groupId, p_kind: kind, p_tz: tz,
      });
      if ((issued ?? 0) >= ABUSE_CAP[kind]) {
        return new Response(
          JSON.stringify({ code: ErrorCode.QUOTA_EXCEEDED, error: 'daily upload quota exceeded' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      // 발급 기록(집계 대상). 실패해도 업로드는 진행 — 기록 실패로 기능을 막지 않는다.
      await admin.from('media_upload_grants').insert({
        user_id: user.id, group_id: groupId, kind, object_key: key,
      });
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
    });

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(R2, command, { expiresIn: 300 });
    // 커뮤니티 사진은 워커 공개 URL(토큰 불필요)을 저장값으로 반환 → 즉시 로딩.
    // 의료/영상/알림음은 기존대로 R2_PUBLIC_URL 기반(저장 후 r2-get-url 로 서명 URL 발급).
    const host = R2_PROXY_HOST.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const publicUrl = isCommunity && host
      ? `https://${host}/${key.split('/').map((s) => encodeURIComponent(s)).join('/')}`
      : `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

    return new Response(
      JSON.stringify({ presignedUrl, publicUrl }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('r2-upload error:', err);
    // 보안: 내부 에러 문자열을 클라이언트에 노출하지 않음(상세는 로그에만).
    return new Response(
      JSON.stringify({ error: 'failed to issue presigned URL' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
