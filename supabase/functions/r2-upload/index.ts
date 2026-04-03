import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';

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
    const R2_PUBLIC_URL = Deno.env.get('R2_PUBLIC_URL') ?? '';

    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      return new Response(
        JSON.stringify({ error: 'R2 환경변수가 설정되지 않았습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const R2 = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      // Cloudflare R2는 chunked transfer encoding을 지원하지 않으므로
      // Content-Length를 항상 계산해서 보내도록 강제
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    const contentType = req.headers.get('content-type') ?? '';
    let fileBody: Uint8Array;
    let fileContentType: string;
    let key: string;

    if (contentType.includes('application/json')) {
      // base64 JSON 방식
      const body = await req.json();
      const { base64, contentType: ct, key: k } = body;

      if (!base64 || !k) {
        return new Response(
          JSON.stringify({ error: 'base64 또는 key가 없습니다.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // base64 → Uint8Array 변환
      const binaryString = atob(base64);
      fileBody = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
      fileContentType = ct ?? 'application/octet-stream';
      key = k;
    } else {
      // FormData multipart 방식 (기존 호환)
      const formData = await req.formData();
      const file = formData.get('file') as File;
      key = formData.get('key') as string;

      if (!file || !key) {
        return new Response(
          JSON.stringify({ error: 'file 또는 key가 없습니다.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      fileBody = new Uint8Array(arrayBuffer);
      fileContentType = file.type || 'application/octet-stream';
    }

    // ContentLength를 명시적으로 설정 — R2의 chunked 거부 문제 방지
    await R2.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBody,
      ContentType: fileContentType,
      ContentLength: fileBody.byteLength,
    }));

    // Public URL: 퍼블릭 도메인이 설정된 경우 사용, 없으면 R2 endpoint + 버킷 경로
    // R2_PUBLIC_URL 예시: https://pub-xxxx.r2.dev 또는 커스텀 도메인
    const baseUrl = R2_PUBLIC_URL.replace(/\/$/, '');
    const url = baseUrl
      ? `${baseUrl}/${key}`
      : `${R2_ENDPOINT.replace(/\/$/, '')}/${R2_BUCKET_NAME}/${key}`;

    return new Response(
      JSON.stringify({ url, key }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('r2-upload error:', err);
    return new Response(
      JSON.stringify({ error: err.message ?? '업로드 실패', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
