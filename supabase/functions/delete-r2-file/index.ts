import { S3Client, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT');
    const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
    const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? 'parkinon-media';

    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      return new Response(
        JSON.stringify({ error: 'R2 환경변수가 설정되지 않았습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 인증 확인 — JWT 토큰 검증
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: '인증 토큰이 없습니다.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: '인증에 실패했습니다.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // POST body: { r2_key: string, media_log_id: string }
    const body = await req.json();
    const { r2_key, media_log_id } = body;

    if (!r2_key || !media_log_id) {
      return new Response(
        JSON.stringify({ error: 'r2_key 또는 media_log_id가 없습니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 소유권 확인.
    //   허용:
    //     - 환자 본인이 본인 의료영상 삭제
    //     - 업로더 본인이 자기 업로드 삭제
    //     - 보호자(같은 patient_group) 인 경우 같은 그룹 환자 파일 삭제
    //   거부:
    //     - 그 외 모든 경우 (다른 그룹 사용자 파일 등) → 403
    const { data: mediaLog, error: logError } = await supabase
      .from('media_logs')
      .select('id, patient_id, logged_by, r2_key')
      .eq('id', media_log_id)
      .single();

    if (logError || !mediaLog) {
      return new Response(
        JSON.stringify({ error: '미디어 로그를 찾을 수 없습니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 안전을 위해 요청 body 의 r2_key 와 DB 의 r2_key 일치 확인 (불일치 시 거부)
    if (mediaLog.r2_key !== r2_key) {
      return new Response(
        JSON.stringify({ error: 'r2_key 가 일치하지 않습니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let allowed = mediaLog.patient_id === user.id || mediaLog.logged_by === user.id;
    if (!allowed) {
      // 보호자(같은 patient_group) 인지 확인
      const { data: sameGroup } = await supabase
        .rpc('is_same_patient_group', { target_user_id: mediaLog.patient_id });
      if (sameGroup === true) {
        allowed = true;
      }
    }

    if (!allowed) {
      return new Response(
        JSON.stringify({ error: '삭제 권한이 없습니다.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // R2에서 파일 삭제
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

    await R2.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2_key,
    }));

    // DB에서 media_logs 행 삭제
    const { error: deleteError } = await supabase
      .from('media_logs')
      .delete()
      .eq('id', media_log_id);

    if (deleteError) {
      console.error('media_logs 삭제 오류:', deleteError);
      return new Response(
        JSON.stringify({ error: 'DB 삭제에 실패했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('delete-r2-file error:', err);
    // 보안: 내부 에러 문자열을 클라이언트에 노출하지 않음(상세는 로그에만).
    return new Response(
      JSON.stringify({ error: '삭제 중 오류가 발생했습니다.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
