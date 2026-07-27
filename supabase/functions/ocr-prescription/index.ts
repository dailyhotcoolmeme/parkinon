import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// 개인정보 마스킹 패턴
const MASKING_PATTERNS = [
  // 주민등록번호 (6자리-7자리)
  { pattern: /\d{6}-\d{7}/g, replacement: '######-#######' },
  // 주민등록번호 (13자리 연속)
  { pattern: /\b\d{13}\b/g, replacement: '#############' },
  // 전화번호 (010-XXXX-XXXX 등)
  { pattern: /0\d{1,2}-\d{3,4}-\d{4}/g, replacement: '###-####-####' },
  // 전화번호 (공백 없는 형태)
  { pattern: /\b0\d{9,10}\b/g, replacement: '###########' },
  // 생년월일 (YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD)
  { pattern: /\d{4}[.\-\/]\d{2}[.\-\/]\d{2}/g, replacement: 'YYYY.MM.DD' },
  // 이름 앞 "성명:" 또는 "환자명:" 뒤 2~4글자
  { pattern: /(성명|환자명|이름)\s*[:：]?\s*[가-힣]{2,4}/g, replacement: '$1: ***' },
  // 주소 패턴 (시/도로 시작)
  {
    pattern: /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣\s\d\-\.]+(?:동|로|길|아파트|빌라|번지)[가-힣\s\d\-\.]{0,30}/g,
    replacement: '[주소 마스킹]',
  },
];

/**
 * 텍스트에서 개인정보를 마스킹 처리합니다.
 */
function maskPersonalInfo(text: string): string {
  let masked = text;
  for (const { pattern, replacement } of MASKING_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

interface MedicationResult {
  name: string;
  dosage: string;
  meal_times: string[];
}

interface OcrRequest {
  image_base64: string;
  image_type: 'jpeg' | 'png';
}

interface OcrResponse {
  medications: MedicationResult[];
}

// ---------------------------------------------------------------
// C5: 단순 in-memory rate limit (사용자별 5분당 5회).
// Edge Function 인스턴스가 cold start 마다 리셋되지만 동일 인스턴스에서의
// 단기 burst 방지에는 충분.
// ---------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5분
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

/**
 * Claude Vision API로 처방전 분석
 * 원본 이미지는 이 함수 내에서만 사용하고 즉시 파기됩니다.
 */
async function analyzeWithClaude(
  imageBase64: string,
  imageType: 'jpeg' | 'png'
): Promise<MedicationResult[]> {
  const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
  if (!claudeApiKey) {
    throw new Error('CLAUDE_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const prompt = `이 처방전 이미지에서 약 처방 정보만 추출해주세요.

반드시 지켜야 할 규칙:
1. 환자 이름, 생년월일, 주민번호, 주소, 전화번호 등 개인정보는 절대 포함하지 마세요.
2. 처방 약품 정보(약 이름, 용량, 복용 방법)만 추출하세요.
3. 복용 시간대는 morning(아침), lunch(점심), dinner(저녁), bedtime(취침전) 중 해당하는 것만 배열로 표시하세요.
4. 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.

응답 형식:
{"medications": [{"name": "약이름", "dosage": "1정/500mg 등 용량", "meal_times": ["morning","lunch","dinner"]}]}

처방전에 약이 없거나 읽을 수 없으면: {"medications": []}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
                media_type: `image/${imageType}`,
                data: imageBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API 오류: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const content = result.content?.[0]?.text ?? '';
  const maskedContent = maskPersonalInfo(content);
  const jsonMatch = maskedContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('Claude 응답에서 JSON을 찾을 수 없음');
    return [];
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.medications ?? [];
}

async function matchWithKfda(
  medications: MedicationResult[]
): Promise<MedicationResult[]> {
  // TODO: KFDA API 키 발급 후 활성화
  return medications;
}

serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'only POST is allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // -----------------------------------------------------------
    // C5: 인증 검증 (verify_jwt=true 이지만 함수 내부에서도 user 확인)
    // -----------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 사용자별 rate limit
    if (!checkRateLimit(user.id)) {
      return new Response(
        JSON.stringify({ error: 'too many requests, please retry shortly' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json() as OcrRequest;

    if (!body.image_base64 || !body.image_type) {
      return new Response(
        JSON.stringify({ error: 'image_base64와 image_type이 필요합니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['jpeg', 'png'].includes(body.image_type)) {
      return new Response(
        JSON.stringify({ error: 'image_type은 jpeg 또는 png만 허용됩니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 이미지 크기 상한 (base64 길이 기준 ≈ 6MB 원본). 과도한 요청 차단.
    if (body.image_base64.length > 8_000_000) {
      return new Response(
        JSON.stringify({ error: '이미지가 너무 큽니다.' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const medications = await analyzeWithClaude(body.image_base64, body.image_type);
    const matchedMedications = await matchWithKfda(medications);
    const responseBody: OcrResponse = { medications: matchedMedications };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('OCR 처리 오류:', error);
    return new Response(
      JSON.stringify({ error: '처방전 분석 중 오류가 발생했습니다.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
