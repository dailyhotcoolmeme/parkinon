// Supabase Edge Function: kakao-auth
// 카카오 인가코드 -> 카카오 액세스토큰 교환 -> Supabase custom JWT 발급
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v2.8/mod.ts';

const KAKAO_REST_API_KEY = Deno.env.get('KAKAO_REST_API_KEY')!;
const KAKAO_REDIRECT_URI = Deno.env.get('KAKAO_REDIRECT_URI')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface KakaoTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  refresh_token_expires_in: number;
}

interface KakaoUserResponse {
  id: number;
  kakao_account?: {
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
    email?: string;
  };
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    if (!code) {
      return new Response(JSON.stringify({ error: '인가코드가 없습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1단계: 카카오 인가코드 -> 액세스토큰 교환
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: KAKAO_REST_API_KEY,
      redirect_uri: KAKAO_REDIRECT_URI,
      code,
    });

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('카카오 토큰 요청 실패:', errBody);
      return new Response(JSON.stringify({ error: '카카오 토큰 요청 실패', detail: errBody }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokenData: KakaoTokenResponse = await tokenRes.json();

    // 2단계: 카카오 사용자 정보 조회
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      const errBody = await userRes.text();
      console.error('카카오 사용자 조회 실패:', errBody);
      return new Response(JSON.stringify({ error: '카카오 사용자 조회 실패' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const kakaoUser: KakaoUserResponse = await userRes.json();
    const kakaoId = String(kakaoUser.id);
    const kakaoNickname = kakaoUser.kakao_account?.profile?.nickname ?? null;

    // 3단계: Supabase에서 해당 kakao_id의 유저 조회 또는 신규 auth 유저 생성
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // auth.users 조회 (kakao_ prefix 이메일로 식별)
    const kakaoEmail = `kakao_${kakaoId}@parkinon.app`;

    let authUserId: string;
    let isNewUser = false;

    // 기존 유저 조회
    const { data: existingUsers, error: listErr } = await adminClient.auth.admin.listUsers();
    if (listErr) {
      console.error('유저 목록 조회 실패:', listErr);
    }

    const existingUser = existingUsers?.users?.find((u) => u.email === kakaoEmail);

    if (existingUser) {
      authUserId = existingUser.id;
    } else {
      // 신규 auth 유저 생성
      const { data: newAuthUser, error: createErr } = await adminClient.auth.admin.createUser({
        email: kakaoEmail,
        email_confirm: true,
        user_metadata: {
          kakao_id: kakaoId,
          kakao_nickname: kakaoNickname,
          provider: 'kakao',
        },
      });

      if (createErr || !newAuthUser?.user) {
        console.error('auth 유저 생성 실패:', createErr);
        return new Response(JSON.stringify({ error: 'auth 유저 생성 실패' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      authUserId = newAuthUser.user.id;
      isNewUser = true;
    }

    // 4단계: public.users 테이블에 kakao_id 저장 (신규 유저만 upsert)
    if (isNewUser) {
      await adminClient.from('users').upsert({
        id: authUserId,
        kakao_id: kakaoId,
        name: kakaoNickname ?? '파킨온 사용자',
        role: 'patient', // 온보딩에서 변경됨
      }, { onConflict: 'id' });
    }

    // 5단계: Supabase magic link 방식으로 세션 발급
    // admin.generateLink로 one-time token 발급 후 클라이언트에서 verifyOtp 사용
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: kakaoEmail,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error('매직링크 생성 실패:', linkErr);
      return new Response(JSON.stringify({ error: '세션 발급 실패' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        email: kakaoEmail,
        token: linkData.properties.hashed_token,
        isNewUser,
        kakaoId,
        kakaoNickname,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Edge Function 오류:', err);
    return new Response(JSON.stringify({ error: '서버 내부 오류', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
