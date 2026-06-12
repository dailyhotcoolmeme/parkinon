// claude-medical-record
// 진료 기록(MedicalRecord) + 약 관리(MedicationManage) 처방전 OCR 전용 Edge Function.
// mode 파라미터로 두 가지 응답 스키마를 지원합니다.
// CLAUDE_API_KEY는 secrets에만 보관하고 클라이언트로 절대 노출하지 않습니다.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 사용자별 in-memory rate limit (5분당 5회). ocr-prescription 과 동일 정책.
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const history = (rateLimitMap.get(userId) ?? []).filter((t) => t > windowStart);
  if (history.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, history);
    return false;
  }
  history.push(now);
  rateLimitMap.set(userId, history);
  return true;
}

const MASKING_PATTERNS = [
  { pattern: /\d{6}-\d{7}/g, replacement: '######-#######' },
  { pattern: /\b\d{13}\b/g, replacement: '#############' },
  { pattern: /0\d{1,2}-\d{3,4}-\d{4}/g, replacement: '###-####-####' },
  { pattern: /\b0\d{9,10}\b/g, replacement: '###########' },
  { pattern: /\d{4}[.\-\/]\d{2}[.\-\/]\d{2}/g, replacement: 'YYYY.MM.DD' },
  { pattern: /(성명|환자명|이름)\s*[:：]?\s*[가-힣]{2,4}/g, replacement: '$1: ***' },
];

function maskPersonalInfo(text: string): string {
  let masked = text;
  for (const { pattern, replacement } of MASKING_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

type Mode = 'medical_record' | 'medication_manage';

interface ReqBody {
  image_base64: string;
  image_type: 'jpeg' | 'png';
  mode?: Mode;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT_MEDICAL_RECORD = `이 처방전 사진에서 약 이름과 용량을 추출해주세요.
규칙:
- 사진에 명확하게 보이는 약 이름만 추출하세요.
- 약 이름은 사진에 적힌 그대로 정확히 읽어주세요.
- 처방전이면: 약품명 컬럼에서 읽으세요.
- 용량(mg, mcg, 정 등)이 명확히 표시된 경우 dosage에 포함하세요.
- 개인정보(이름, 주민번호, 주소, 전화번호 등)는 절대 포함하지 마세요.
반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"medications":[{"name":"약 이름","dosage":"용량 또는 빈 문자열"}]}
약이 보이지 않거나 읽기 어려우면 {"medications":[]} 를 반환하세요.`;

const PROMPT_MEDICATION_MANAGE = `이 사진에서 약 이름, EDI코드, 복용 시간대를 추출해주세요.

규칙:
- 사진에 명확하게 보이는 약 이름만 추출하세요. 확실하지 않으면 추출하지 마세요.
- 약 이름은 사진에 적힌 그대로 정확히 읽어주세요. 임의로 변경하거나 추측하지 마세요.
- 처방전이면: 약품명 컬럼에서 읽으세요
- 약봉투/약봉지이면: 봉투에 인쇄된 약품명을 읽으세요
- 복용 시간대가 명확히 표시된 경우만 포함하세요. 불명확하면 빈 배열로 두세요.

EDI코드 규칙 (매우 중요):
- 처방전(처방전 양식이 명확한 경우)에는 각 약품마다 EDI코드(건강보험 표준코드)가 인쇄되어 있습니다. 9자리 숫자 (예: 664601180)입니다.
- 보통 약품명 옆에 "EDI코드" 또는 "코드" 컬럼에 표기됩니다.
- 처방전에 EDI코드 컬럼이 있고 해당 약의 코드가 명확히 보일 때만 ediCode 필드에 그 9자리 숫자를 그대로 채우세요.
- 약봉투/약봉지에는 EDI코드가 없습니다. 코드가 없거나 읽을 수 없으면 ediCode를 빈 문자열 ""로 두세요. 추측 금지.

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"medications":[{"name":"약 이름","ediCode":"664601180","times":["morning","lunch","dinner","bedtime"]}]}
복용 시간대: morning(아침)/lunch(점심)/dinner(저녁)/bedtime(취침)
개인정보(이름, 주민번호 등)는 무시하세요.
약이 보이지 않거나 읽기 어려우면 {"medications":[]} 를 반환하세요.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST 요청만 허용됩니다.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) {
      return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY가 설정되지 않았습니다.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 인증: 호출자 JWT 검증 (gateway 외에 함수 내부에서도 확인) + 사용자별 rate limit.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '인증이 필요합니다.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: '인증이 필요합니다.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body.image_base64 || !body.image_type) {
      return new Response(JSON.stringify({ error: 'image_base64와 image_type이 필요합니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!['jpeg', 'png'].includes(body.image_type)) {
      return new Response(JSON.stringify({ error: 'image_type은 jpeg 또는 png만 허용됩니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // 이미지 크기 상한 (base64 길이 ≈ 6MB 원본). 과도한 요청 차단.
    if (body.image_base64.length > 8_000_000) {
      return new Response(JSON.stringify({ error: '이미지가 너무 큽니다.' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mode: Mode = body.mode === 'medication_manage' ? 'medication_manage' : 'medical_record';
    const prompt = mode === 'medication_manage' ? PROMPT_MEDICATION_MANAGE : PROMPT_MEDICAL_RECORD;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: `image/${body.image_type}`,
                  data: body.image_base64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Claude API 오류:', apiRes.status, errText);
      return new Response(JSON.stringify({ error: '처방전 분석에 실패했어요.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await apiRes.json();
    const content: string = result.content?.[0]?.text ?? '';
    const masked = maskPersonalInfo(content);
    const cleaned = masked.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return new Response(JSON.stringify({ medications: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('JSON 파싱 실패:', e);
      return new Response(JSON.stringify({ medications: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'medication_manage') {
      const medications = (parsed.medications ?? []).map((m: any) => ({
        name: String(m.name ?? '').trim(),
        ediCode: m.ediCode ? String(m.ediCode).trim() : '',
        times: Array.isArray(m.times) ? m.times.map((t: any) => String(t)) : [],
      })).filter((m: any) => m.name.length > 0);
      return new Response(JSON.stringify({ medications }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // mode === 'medical_record'
    const medications = (parsed.medications ?? []).map((m: any) => ({
      name: String(m.name ?? '').trim(),
      dosage: m.dosage ? String(m.dosage).trim() : '',
    })).filter((m: any) => m.name.length > 0);

    return new Response(JSON.stringify({ medications }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('claude-medical-record 처리 오류:', err);
    return new Response(JSON.stringify({ error: '처방전 분석 중 오류가 발생했어요.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
