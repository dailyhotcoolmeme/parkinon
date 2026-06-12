import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// C6: key 경로 정규식. parkinon/(videos|photos)/{UUID(patient_id)}/YYYY-MM/{slug}.(mp4|jpg|jpeg|png|heic)
const KEY_PATTERN =
  /^parkinon\/(videos|photos)\/([0-9a-fA-F-]{36})\/(\d{4})-(\d{2})\/[A-Za-z0-9_-]+\.(mp4|jpg|jpeg|png|heic)$/;

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
        JSON.stringify({ error: '인증이 필요합니다.' }),
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
        JSON.stringify({ error: '인증이 필요합니다.' }),
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
        JSON.stringify({ error: 'R2 환경변수가 설정되지 않았습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json();
    const { key, contentType } = body ?? {};

    if (!key || !contentType || typeof key !== 'string' || typeof contentType !== 'string') {
      return new Response(
        JSON.stringify({ error: 'key 또는 contentType이 없습니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // C6: key 패턴 검증 (sounds 우선 → videos/photos)
    let ownerId: string;
    const soundMatch = key.match(SOUND_KEY_PATTERN);
    if (soundMatch) {
      ownerId = soundMatch[1];
      if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
        return new Response(
          JSON.stringify({ error: '허용되지 않는 오디오 contentType 입니다.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    } else {
      const m = key.match(KEY_PATTERN);
      if (!m) {
        return new Response(
          JSON.stringify({ error: 'key 형식이 올바르지 않습니다.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const kind = m[1] as 'videos' | 'photos';
      ownerId = m[2];
      const month = Number(m[4]);
      if (month < 1 || month > 12) {
        return new Response(
          JSON.stringify({ error: 'key YYYY-MM 값이 올바르지 않습니다.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const allowedTypes = kind === 'videos' ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
      if (!allowedTypes.has(contentType)) {
        return new Response(
          JSON.stringify({ error: '허용되지 않는 contentType 입니다.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // C6: 소유권 검증
    //  - sounds(개인 알림음): 본인만 업로드 가능 — 같은 그룹 멤버라도 타인 prefix 쓰기 금지.
    //  - videos/photos: 본인 또는 같은 patient_group 멤버(보호자 대리 업로드 허용).
    if (ownerId !== user.id) {
      if (soundMatch) {
        return new Response(
          JSON.stringify({ error: '본인 알림음 경로에만 업로드할 수 있습니다.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const { data: sameGroup, error: rpcErr } = await supabase
        .rpc('is_same_patient_group', { target_user_id: ownerId });
      if (rpcErr || sameGroup !== true) {
        return new Response(
          JSON.stringify({ error: '해당 경로에 업로드할 권한이 없습니다.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
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
    const publicUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

    return new Response(
      JSON.stringify({ presignedUrl, publicUrl }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('r2-upload error:', err);
    // 보안: 내부 에러 문자열을 클라이언트에 노출하지 않음(상세는 로그에만).
    return new Response(
      JSON.stringify({ error: 'presigned URL 발급 실패' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
