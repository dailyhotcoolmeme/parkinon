/**
 * convert-sound-caf — 개인 녹음(m4a) → iOS 알림음 caf 변환 (서버)
 *
 * ⚠️ 상태(2026-06): 변환 엔진 미확정 — ffmpeg.wasm 은 Supabase Edge(Deno)에서 동작 불가.
 *   · @ffmpeg/ffmpeg(고수준): "ffmpeg.wasm does not support nodejs" 로 즉시 throw(브라우저 전용).
 *   · @ffmpeg/core(저수준 Emscripten): 브라우저 글로벌(location.href 등) 의존 → instantiate 실패.
 *   · Edge 한도 256MB/2s CPU → 설령 로드돼도 풀 트랜스코딩 불가.
 *   → 대안: Cloudflare Container(ffmpeg 네이티브) 워커, 또는 iOS 기기측 AVAudioConverter 변환.
 *
 * 이 함수는 인증/R2 다운로드/갱신 배선까지 준비된 스켈레톤이다. 엔진이 정해지면
 * download 구간 아래에 변환→PutObject→r2_key_caf UPDATE 를 끼우면 된다. 현재는 501 반환.
 *
 * iOS 알림음 caf 규격(검증완료): AAC 불가. IMA4(adpcm_ima_qt) 또는 PCM(pcm_s16le), ≤30초, caf 컨테이너.
 *   로컬 ffmpeg 검증 커맨드: ffmpeg -i in.m4a -t 30 -ar 44100 -ac 1 -c:a adpcm_ima_qt -f caf out.caf
 *
 * ⚠️ 알림 라우팅과 무관 — 자산 변환용. CLAUDE.md 서버푸시 규칙 불침해.
 */
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SOUND_KEY_PATTERN =
  /^parkinon\/sounds\/([0-9a-fA-F-]{36})\/[A-Za-z0-9_-]+\.(m4a|caf|ogg|mp3|wav|aac)$/;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
async function toU8(body: any): Promise<Uint8Array> {
  if (body?.transformToByteArray) return await body.transformToByteArray();
  const r = body.getReader();
  const cs: Uint8Array[] = [];
  let t = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    cs.push(value);
    t += value.length;
  }
  const o = new Uint8Array(t);
  let off = 0;
  for (const c of cs) { o.set(c, off); off += c.length; }
  return o;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    const isService = bearer && bearer === serviceKey;

    let callerId: string | null = null;
    if (!isService) {
      if (!authHeader) return json({ error: 'authentication required' }, 401);
      const uc = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error } = await uc.auth.getUser();
      if (error || !user) return json({ error: 'authentication required' }, 401);
      callerId = user.id;
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    let { soundId, r2KeySrc, userId } = body ?? {};

    if (soundId) {
      const { data: row, error } = await admin
        .from('custom_sounds').select('id, r2_key_src').eq('id', soundId).maybeSingle();
      if (error || !row) return json({ error: 'sound not found' }, 404);
      r2KeySrc = (row as any).r2_key_src;
    }
    if (!r2KeySrc || typeof r2KeySrc !== 'string') return json({ error: 'r2KeySrc (or soundId) is required' }, 400);
    const mt = r2KeySrc.match(SOUND_KEY_PATTERN);
    if (!mt) return json({ error: 'invalid r2_key_src format' }, 400);
    const ownerId = mt[1];
    if (!userId) userId = ownerId;

    if (!isService && callerId && callerId !== ownerId) {
      const uc = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: same } = await uc.rpc('is_same_patient_group', { target_user_id: ownerId });
      if (same !== true) return json({ error: 'not authorized' }, 403);
    }

    // R2 다운로드(파이프라인 검증) — 엔진 정해지면 이 다음에 변환 삽입
    const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT');
    const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
    const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? 'parkinon-media';
    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return json({ error: 'R2 환경변수 미설정' }, 500);
    const R2 = new S3Client({
      region: 'auto', endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const g = await R2.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2KeySrc }));
    const m4a = await toU8(g.Body);

    // === 변환 엔진 미확정: ffmpeg.wasm Edge 미지원. 외부 워커/기기측 변환으로 이관 필요. ===
    return json({
      ok: false,
      status: 'engine_unavailable',
      message: 'caf 변환 엔진 미확정(ffmpeg.wasm Edge 미지원). 다운로드까지 정상.',
      r2_key_src: r2KeySrc,
      m4a_bytes: m4a.length,
    }, 501);
  } catch (err: any) {
    console.error('convert-sound-caf error:', err?.message ?? err);
    return json({ error: String(err?.message ?? err) }, 500);
  }
});
