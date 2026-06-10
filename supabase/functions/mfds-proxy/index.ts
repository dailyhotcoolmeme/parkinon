// mfds-proxy
// 식약처 공공 API 프록시. 클라이언트는 식약처 키 없이 호출합니다.
// 서버는 secrets의 MFDS_KEY로 식약처 API에 요청하고 응답을 그대로 전달합니다.
// 지원 endpoint:
//   - 'grn'  : 낱알식별 API (MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03)
//   - 'easy' : 의약품 e약은요 API (DrbEasyDrugInfoService/getDrbEasyDrugList)
//   - 'easy01' : 의약품 e약은요 API v01 (DrbEasyDrugInfoService01/getDrbEasyDrugList)
//
// 간단한 in-memory rate limit (user_id 단위, 분당 30회).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Endpoint = 'grn' | 'easy' | 'easy01';

interface ReqBody {
  endpoint: Endpoint;
  // grn은 item_name, easy/easy01은 itemName 파라미터 사용 → 클라이언트는 통일 키 'query' 사용
  query: string;
  numOfRows?: number;
  pageNo?: number;
}

const URLS: Record<Endpoint, string> = {
  grn: 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03',
  easy: 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList',
  easy01: 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService01/getDrbEasyDrugList',
};

// 분당 호출 제한
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const callTimes = new Map<string, number[]>();

function rateLimit(userId: string): boolean {
  const now = Date.now();
  const arr = (callTimes.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    callTimes.set(userId, arr);
    return false;
  }
  arr.push(now);
  callTimes.set(userId, arr);
  return true;
}

function extractUserIdFromJwt(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

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
    const mfdsKey = Deno.env.get('MFDS_KEY');
    if (!mfdsKey) {
      return new Response(JSON.stringify({ error: 'MFDS_KEY가 설정되지 않았습니다.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // verify_jwt=true 면 Supabase 게이트웨이가 미인증을 거른다. 추가로 user_id 단위 rate limit.
    const userId = extractUserIdFromJwt(req.headers.get('authorization')) ?? 'anonymous';
    if (!rateLimit(userId)) {
      return new Response(JSON.stringify({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body.endpoint || !body.query) {
      return new Response(JSON.stringify({ error: 'endpoint와 query가 필요합니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = URLS[body.endpoint];
    if (!url) {
      return new Response(JSON.stringify({ error: '잘못된 endpoint 값입니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const trimmedQuery = String(body.query).trim();
    if (!trimmedQuery || trimmedQuery.length > 100) {
      return new Response(JSON.stringify({ error: 'query 값이 비어있거나 너무 깁니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const numOfRows = Math.min(Math.max(body.numOfRows ?? 5, 1), 20);
    const pageNo = Math.max(body.pageNo ?? 1, 1);

    const params = new URLSearchParams();
    params.set('serviceKey', mfdsKey);
    params.set('type', 'json');
    params.set('numOfRows', String(numOfRows));
    params.set('pageNo', String(pageNo));
    if (body.endpoint === 'grn') {
      params.set('item_name', trimmedQuery);
    } else {
      params.set('itemName', trimmedQuery);
    }

    const upstreamUrl = `${url}?${params.toString()}`;
    const upstream = await fetch(upstreamUrl);

    const text = await upstream.text();
    if (!upstream.ok) {
      console.error('MFDS upstream 오류:', upstream.status, text.slice(0, 200));
      return new Response(JSON.stringify({ error: '식약처 API 호출에 실패했어요.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // upstream이 JSON이지만 type=json 무시하고 XML 줄 때가 있어 그대로 패스스루
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('mfds-proxy 오류:', err);
    return new Response(JSON.stringify({ error: '식약처 정보 조회 중 오류가 발생했어요.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
