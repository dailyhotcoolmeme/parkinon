# 카카오 OAuth 구현 패턴

## 설치

```bash
npx expo install expo-web-browser expo-auth-session
```

---

## 카카오 로그인 설정

### app.json
```json
{
  "expo": {
    "scheme": "parkinon",
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [{ "scheme": "parkinon" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### 카카오 개발자 센터 설정
- 플랫폼: Android
- 패키지명: com.ourmine.parkinon
- 리다이렉트 URI: parkinon://auth/kakao

---

## 로그인 구현

```typescript
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const KAKAO_CLIENT_ID = process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID!;
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: 'parkinon', path: 'auth/kakao' });

export const loginWithKakao = async () => {
  // 카카오 인증 URL
  const authUrl =
    `https://kauth.kakao.com/oauth/authorize` +
    `?client_id=${KAKAO_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code`;

  const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);

  if (result.type !== 'success') return null;

  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) return null;

  // Supabase Edge Function으로 토큰 교환
  const { data, error } = await supabase.functions.invoke('kakao-auth', {
    body: { code, redirectUri: REDIRECT_URI },
  });

  if (error) throw error;

  // Supabase 세션 설정
  await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  return data;
};
```

---

## Supabase Edge Function (kakao-auth)

```typescript
// supabase/functions/kakao-auth/index.ts
Deno.serve(async (req) => {
  const { code, redirectUri } = await req.json();

  // 카카오 토큰 교환
  const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: Deno.env.get('KAKAO_CLIENT_ID')!,
      redirect_uri: redirectUri,
      code,
    }),
  });
  const tokenData = await tokenRes.json();

  // 카카오 사용자 정보 조회
  const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = await userRes.json();

  const kakaoId = String(userData.id);
  const nickname = userData.kakao_account?.profile?.nickname ?? '사용자';

  // Supabase Auth에 upsert
  const { data: authData } = await supabaseAdmin.auth.admin.createUser({
    email: `kakao_${kakaoId}@parkinon.app`,
    password: kakaoId,
    email_confirm: true,
    user_metadata: { kakao_id: kakaoId, name: nickname },
  });

  // 세션 생성
  const { data: session } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: `kakao_${kakaoId}@parkinon.app`,
  });

  return new Response(JSON.stringify({
    access_token: session.properties?.access_token,
    refresh_token: session.properties?.refresh_token,
    kakao_id: kakaoId,
    name: nickname,
  }), { headers: { 'Content-Type': 'application/json' } });
});
```

---

## 로그아웃

```typescript
export const logout = async () => {
  await supabase.auth.signOut();
};
```

---

## 주의사항

- iOS 출시 시 Apple 로그인 필수 추가
- 카카오 앱키는 EXPO_PUBLIC_KAKAO_CLIENT_ID 환경변수로 관리
- Supabase Edge Function secrets에 KAKAO_CLIENT_ID 저장
