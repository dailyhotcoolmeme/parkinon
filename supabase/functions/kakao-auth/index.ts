// Supabase Edge Function: kakao-auth (네이티브 SDK용)
// 카카오 액세스토큰 → Supabase 세션 발급
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { access_token } = await req.json();
    if (!access_token) {
      return new Response(JSON.stringify({ error: 'access_token이 없습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1단계: 카카오 API로 사용자 정보 조회
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userRes.ok) {
      const errBody = await userRes.text();
      console.error('카카오 사용자 조회 실패:', errBody);
      return new Response(JSON.stringify({ error: '카카오 사용자 조회 실패' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const kakaoUser = await userRes.json();
    const kakaoId = String(kakaoUser.id);
    const kakaoNickname = kakaoUser.kakao_account?.profile?.nickname ?? null;
    const kakaoEmail = `kakao_${kakaoId}@parkinon.app`;

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 2단계: public.users에서 kakao_id로 기존 유저 조회 (listUsers 대신)
    const { data: existingProfile } = await adminClient
      .from('users')
      .select('id')
      .eq('kakao_id', kakaoId)
      .maybeSingle();

    let authUserId: string;

    if (existingProfile) {
      authUserId = existingProfile.id;
    } else {
      // 신규 유저: auth.users 생성
      const { data: newAuthUser, error: createErr } = await adminClient.auth.admin.createUser({
        email: kakaoEmail,
        email_confirm: true,
        user_metadata: {
          kakao_id: kakaoId,
          kakao_nickname: kakaoNickname,
          provider: 'kakao',
          full_name: kakaoNickname,
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

      // public.users 삽입
      await adminClient.from('users').insert({
        id: authUserId,
        kakao_id: kakaoId,
        name: kakaoNickname ?? '파킨온 사용자',
        role: 'patient',
        onboarding_done: false,
        notification_enabled: true,
        patient_group_id: null,
      });
    }

    // 3단계: 매직링크 토큰 발급
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
