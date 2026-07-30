// claude-medical-record
// 진료 기록(MedicalRecord) + 약 관리(MedicationManage) 처방전 OCR 전용 Edge Function.
// mode 파라미터로 두 가지 응답 스키마를 지원합니다.
// CLAUDE_API_KEY는 secrets에만 보관하고 클라이언트로 절대 노출하지 않습니다.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { ErrorCode, errorResponse } from '../_shared/errors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 사용자별 in-memory rate limit (5분당 5회).
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

/**
 * OCR 프롬프트는 영어로 쓴다 — 모델이 영어 지시를 더 정확히 따른다(2026-07-30 오너 확정).
 * 다만 따옴표 안의 한국어는 **처방전에 실제로 인쇄된 글자**다. 지시문이 아니라
 * 모델이 사진에서 찾아야 할 대상이라 그대로 둔다. 사용자 화면에는 나가지 않는다.
 */
const PROMPT_MEDICAL_RECORD = `Extract medication names and dosages from this prescription photo.

Rules:
- Only extract medication names that are clearly legible in the photo.
- Read each name exactly as printed. Do not alter or guess.
- On a prescription form, read from the drug-name column (Korean forms label it "약품명").
- Include the dosage in \`dosage\` when it is clearly shown (mg, mcg, tablets, etc.).
- Never include personal data (names, national ID numbers, addresses, phone numbers).

Respond with this JSON only, no other text:
{"medications":[{"name":"<drug name>","dosage":"<dosage or empty string>"}]}
If no medication is visible or legible, return {"medications":[]}.`;

const PROMPT_MEDICATION_MANAGE = `Extract the medication name, EDI code, dose per intake, daily intake count, and dosing times from this photo.

Rules:
- Only extract medication names that are clearly legible. If unsure, skip it.
- Read each name exactly as printed. Do not alter or guess.
- Prescription form: read from the drug-name column (Korean forms label it "약품명").
- Medicine pouch/bag: read the drug name printed on the pouch.
- Include dosing times only when clearly indicated; otherwise leave the array empty.

Dose per intake (dosage):
- If a single-intake dose is clearly shown (e.g. "1정", "1포", "2캡슐", "5mg", "10mL"), copy it verbatim.
- On Korean prescriptions this is usually the "1회 투약량" column; on pouches it is the per-intake amount.
- If unclear or not visible, set dosage to "". Never guess.

Daily intake count (dailyCount — important):
- Extract the daily count printed on the form or pouch as an integer.
  Korean forms write it as "1일 3회", "1일 투여횟수 3", "1일 3번", or "하루 2회" — e.g. "1일 3회" is 3.
- It is usually in the "1일투여량/투여횟수" or "투약 횟수" column.
- Fill dailyCount only when the number is clearly visible; otherwise null. Never guess.

EDI code (important):
- Korean prescription forms print a 9-digit health-insurance code per drug (e.g. 664601180).
- It is usually beside the drug name, in a column labelled "EDI코드" or "코드".
- Fill ediCode only when the form has that column and the code is clearly legible.
- Medicine pouches have no EDI code. If absent or unreadable, set ediCode to "". Never guess.

Respond with this JSON only, no other text:
{"medications":[{"name":"<drug name>","ediCode":"664601180","dosage":"1정","dailyCount":3,"times":["morning","lunch","dinner","bedtime"]}]}
Dosing times: morning / lunch / dinner / bedtime.
dosage: dose per intake; "" if unknown. dailyCount: integer; null if unknown.
Ignore personal data (names, national ID numbers, etc.).
If no medication is visible or legible, return {"medications":[]}.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'only POST is allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) {
      return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 인증: 호출자 JWT 검증 (gateway 외에 함수 내부에서도 확인) + 사용자별 rate limit.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'authentication required' }), {
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
      return new Response(JSON.stringify({ error: 'authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: 'too many requests, please retry shortly' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body.image_base64 || !body.image_type) {
      return new Response(JSON.stringify({ code: ErrorCode.INVALID_REQUEST, error: 'image_base64 and image_type are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!['jpeg', 'png'].includes(body.image_type)) {
      return new Response(JSON.stringify({ code: ErrorCode.INVALID_IMAGE_TYPE, error: 'image_type must be jpeg or png' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // 이미지 크기 상한 (base64 길이 ≈ 6MB 원본). 과도한 요청 차단.
    if (body.image_base64.length > 8_000_000) {
      return new Response(JSON.stringify({ code: ErrorCode.IMAGE_TOO_LARGE, error: 'image too large' }), {
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
      return new Response(JSON.stringify({ code: ErrorCode.OCR_FAILED, error: 'prescription analysis failed' }), {
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
      const medications = (parsed.medications ?? []).map((m: any) => {
        // dailyCount: 정수 양수만 채택. 그 외(null/0/문자열/음수)는 null.
        let dailyCount: number | null = null;
        const rawCount = m.dailyCount ?? m.daily_count;
        if (rawCount !== null && rawCount !== undefined) {
          const n = Math.trunc(Number(rawCount));
          if (Number.isFinite(n) && n > 0) dailyCount = n;
        }
        return {
          name: String(m.name ?? '').trim(),
          ediCode: m.ediCode ? String(m.ediCode).trim() : '',
          dosage: m.dosage ? String(m.dosage).trim() : '',
          dailyCount,
          times: Array.isArray(m.times) ? m.times.map((t: any) => String(t)) : [],
        };
      }).filter((m: any) => m.name.length > 0);
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
    return new Response(JSON.stringify({ code: ErrorCode.OCR_FAILED, error: 'prescription analysis failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
