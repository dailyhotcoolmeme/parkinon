import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { kakaoAccessToken } = await req.json();
    if (!kakaoAccessToken) throw new Error('kakaoAccessToken 누락');

    // 1) 카카오 토큰 검증 + 프로필 조회
    const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${kakaoAccessToken}` },
    });
    if (!kakaoRes.ok) {
      const text = await kakaoRes.text();
      throw new Error(`카카오 토큰 검증 실패: ${kakaoRes.status} ${text}`);
    }
    const kakaoUser = await kakaoRes.json();
    const kakaoId = String(kakaoUser.id);
    const kakaoEmail = kakaoUser.kakao_account?.email ?? null;
    const nickname = kakaoUser.kakao_account?.profile?.nickname ?? '사용자';
    const profileImageUrl = kakaoUser.kakao_account?.profile?.profile_image_url ?? null;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 2) public.users에서 kakao_id로 직접 조회 (admin.listUsers 절대 사용 X)
    //    select 컬럼은 'id'만 — email 컬럼 없음
    const { data: existingPublicUser, error: lookupErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('kakao_id', kakaoId)
      .maybeSingle();
    if (lookupErr) throw new Error(`users 조회 오류: ${lookupErr.message}`);

    let authUserId: string;
    let authEmail: string;

    if (existingPublicUser) {
      // 기존 유저: auth.admin.getUserById로 email 조회 (단일 조회 — 안전)
      authUserId = existingPublicUser.id;
      const { data: authUserData, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(authUserId);
      if (getUserErr || !authUserData?.user?.email) {
        throw new Error(`auth user 조회 실패: ${getUserErr?.message ?? 'email 없음'}`);
      }
      authEmail = authUserData.user.email;
    } else {
      // 신규 유저: createUser + public.users insert
      authEmail = kakaoEmail ?? `kakao_${kakaoId}@parkinon.local`;

      const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        email_confirm: true,
        user_metadata: {
          provider: 'kakao',
          provider_id: kakaoId,
          sub: kakaoId,
          nickname,
          profile_image_url: profileImageUrl
        },
      });
      if (createErr) {
        throw new Error(`auth user 생성 실패: ${createErr.message}`);
      }
      authUserId = createData.user!.id;

      // public.users insert — 실제 스키마에 맞춰 NOT NULL 컬럼 모두 채움 + email 컬럼 없음
      const { error: insertErr } = await supabaseAdmin.from('users').insert({
        id: authUserId,
        kakao_id: kakaoId,
        name: nickname,
        role: 'patient',           // 임시 default — onboarding에서 변경 가능
        onboarding_done: false,
        notification_enabled: true,
      });
      if (insertErr) {
        // insert 실패 시 auth user 정리 (일관성 유지)
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw new Error(`public.users insert 실패: ${insertErr.message}`);
      }
    }

    // 3) magic link 생성 → 클라이언트가 verifyOtp로 세션 발급
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: authEmail,
      options: { redirectTo: 'parkinon://auth/callback' },
    });
    if (linkErr) throw new Error(`magic link 생성 실패: ${linkErr.message}`);

    return new Response(
      JSON.stringify({ action_link: linkData.properties.action_link }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[kakao-auth] 오류:', err?.message || err);
    return new Response(
      JSON.stringify({ error: err?.message ?? 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
