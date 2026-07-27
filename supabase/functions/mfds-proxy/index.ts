// mfds-proxy
// 식약처 공공 API 프록시. 클라이언트는 식약처 키 없이 호출합니다.
// 서버는 secrets의 MFDS_KEY로 식약처 API에 요청하고 응답을 그대로 전달합니다.
// 지원 endpoint:
//   - 'grn'  : 낱알식별 API (MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03)
//   - 'easy' : 의약품 e약은요 API (DrbEasyDrugInfoService/getDrbEasyDrugList)
//   - 'easy01' : 의약품 e약은요 API v01 (DrbEasyDrugInfoService01/getDrbEasyDrugList)
//   - 'permit-list'   : 의약품 제품 허가정보 목록 (DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07, item_name 검색)
//   - 'permit-detail' : 의약품 제품 허가정보 상세 (DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnDtlInq06, item_seq 조회)
//
// 인증: verify_jwt=true 게이트웨이는 anon 키도 통과시키므로(공개 키),
//   함수 내부에서 supabase.auth.getUser()로 실제 로그인 사용자만 허용해 anon 키 남용을 차단한다.
// 간단한 in-memory rate limit (user_id 단위, 분당 30회).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Endpoint = 'grn' | 'easy' | 'easy01' | 'permit-list' | 'permit-detail';

interface ReqBody {
  endpoint: Endpoint;
  // grn은 item_name, easy/easy01은 itemName, permit-list는 item_name, permit-detail은 item_seq
  // → 클라이언트는 통일 키 'query'로 검색어/식별자를 넘긴다.
  query: string;
  numOfRows?: number;
  pageNo?: number;
}

const URLS: Record<Endpoint, string> = {
  grn: 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03',
  easy: 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList',
  easy01: 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService01/getDrbEasyDrugList',
  'permit-list': 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07',
  'permit-detail': 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnDtlInq06',
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
    const mfdsKey = Deno.env.get('MFDS_KEY');
    if (!mfdsKey) {
      return new Response(JSON.stringify({ error: 'MFDS_KEY is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 인증 필수: anon 키만으로는 통과 불가(실제 로그인 사용자만 허용).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // user_id 단위 rate limit
    if (!rateLimit(user.id)) {
      return new Response(JSON.stringify({ error: 'too many requests, please retry shortly' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body.endpoint || !body.query) {
      return new Response(JSON.stringify({ error: 'endpoint and query are required' }), {
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
    if (body.endpoint === 'grn' || body.endpoint === 'permit-list') {
      // 낱알식별·허가목록은 snake_case item_name 으로 이름 검색
      params.set('item_name', trimmedQuery);
    } else if (body.endpoint === 'permit-detail') {
      // 허가상세는 snake_case item_seq 로 단건 조회
      params.set('item_seq', trimmedQuery);
    } else {
      // e약은요(easy/easy01)는 camelCase itemName
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
