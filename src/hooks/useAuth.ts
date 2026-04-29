/**
 * useAuth.ts
 * 카카오 OAuth (Supabase 네이티브 signInWithOAuth) 기반 인증 훅
 *
 * 흐름:
 *  1. supabase.auth.signInWithOAuth({ provider: 'kakao' })로 OAuth URL 생성
 *  2. expo-web-browser로 카카오 인가 페이지 열기
 *  3. parkinon://auth/callback 딥링크로 리다이렉트
 *  4. 글로벌 Linking 핸들러가 딥링크 수신 → setSession / exchangeCodeForSession
 *  5. onAuthStateChange가 세션 감지 → loadUserProfile 호출
 *
 * NOTE: 컴포넌트에서 직접 import하지 말 것.
 * useAuth()는 src/context/AuthContext.tsx 에서 import 하세요.
 * 이 파일의 useAuthProvider()는 AuthProvider 내부에서만 사용합니다.
 */
import { useState, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { registerMissedMedCheckTask, requestPermissionsAndSaveToken } from '../utils/notifications';

// ─── 딥링크 redirect URI ────────────────────────────────────────────────────
const REDIRECT_TO = 'parkinon://auth/callback';

// ─── 타입 ────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  name: string;
  role: 'patient' | 'caregiver';
  onboarding_done: boolean;
  notification_enabled: boolean;
  patient_group_id: string | null;
  kakao_id: string | null;
  birth_year: number | null;
  gender: 'male' | 'female' | null;
  caregiver_relation: string | null;
  residence_type: 'together' | 'separate' | null;
  diagnosis_year: number | null;
  sensitive_info_consented: boolean | null;
}

export type AuthUser = UserProfile;

export interface UseAuthReturn {
  user: UserProfile | null;
  loading: boolean;
  signInWithKakao: () => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  devSignIn: () => Promise<void>;
  forceCompleteOnboarding: () => void;
}

// ─── WebBrowser 세션 초기화 (iOS에서 필수) ──────────────────────────────────
WebBrowser.maybeCompleteAuthSession();

// ─── Auth 딥링크 처리 유틸 ──────────────────────────────────────────────────
// onAuthStateChangeFallback: exchangeCodeForSession 후 onAuthStateChange가 발동하지
// 않을 경우를 대비해 loadUserProfile을 직접 호출할 수 있도록 콜백으로 전달
async function processAuthUrl(
  url: string,
  onAuthStateChangeFallback?: (userId: string, userMeta?: Record<string, any>, accessToken?: string) => Promise<void>,
): Promise<void> {
  console.log('[useAuth] Auth URL 처리 시작:', url.substring(0, 80));

  // fragment 방식 (access_token + refresh_token)
  const fragmentStr = url.split('#')[1] ?? '';
  const fragmentParams = new URLSearchParams(fragmentStr);
  const accessToken = fragmentParams.get('access_token');
  const refreshToken = fragmentParams.get('refresh_token');

  if (accessToken && refreshToken) {
    console.log('[useAuth] fragment 토큰 발견 → setSession');
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) {
      console.error('[useAuth] setSession 오류:', error.message);
      Alert.alert('로그인 실패', '카카오 로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  } else {
    // PKCE 방식 (code 파라미터)
    const parsed = Linking.parse(url);
    const code = parsed.queryParams?.code as string | undefined;
    console.log('[useAuth] PKCE code 있음:', !!code);

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('[useAuth] exchangeCodeForSession 오류:', error.message, error.status);
        Alert.alert('로그인 실패', '카카오 로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
        return;
      }
      // onAuthStateChange가 발동하지 않을 경우를 대비해 세션 직접 확인
      if (data?.session?.user) {
        console.log('[useAuth] exchangeCodeForSession 성공, onAuthStateChange 대기 중:', data.session.user.id);
        // 300ms 대기 후 onAuthStateChange 발동 여부 확인
        await new Promise(resolve => setTimeout(resolve, 300));
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.user && onAuthStateChangeFallback) {
          console.log('[useAuth] fallback 직접 처리 → loadUserProfile 호출');
          await onAuthStateChangeFallback(
            currentSession.user.id,
            currentSession.user.user_metadata,
            currentSession.access_token,
          );
        }
      }
    } else {
      console.error('[useAuth] Auth URL에서 토큰/코드 없음. 파라미터:', Object.keys(parsed.queryParams ?? {}));
      Alert.alert('로그인 실패', '카카오 로그인 응답이 올바르지 않습니다. 다시 시도해주세요.');
    }
  }

  // Android: 카카오 로그인 후 남아있는 브라우저 창 닫기
  if (Platform.OS === 'android') {
    try {
      await WebBrowser.dismissBrowser();
    } catch {}
  }
}

function isAuthUrl(url: string): boolean {
  return (
    url.startsWith('parkinon://auth/') ||
    url.includes('access_token') ||
    url.includes('refresh_token') ||
    (url.includes('parkinon://') && url.includes('code='))
  );
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// supabase-js PostgREST 클라이언트 대신 직접 fetch 사용
// (React Native 새 아키텍처에서 supabase-js PostgREST 요청이 응답 없이 행(hang)하는 버그 우회)
async function dbFetch(path: string, token: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[dbFetch] 오류:', res.status, text);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ─── 훅 본체 ──────────────────────────────────────────────────────────────────
export function useAuthProvider(): UseAuthReturn {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // public.users 테이블에서 프로필 로드 (없으면 insert)
  // accessToken을 직접 받아 supabase.auth.getSession() 추가 호출 없이 즉시 DB 조회
  const loadUserProfile = useCallback(async (
    userId: string,
    userMeta?: Record<string, any>,
    accessToken?: string,
  ) => {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Supabase DB 연결 타임아웃')), 8000)
    );
    try {
      console.log('[useAuth] loadUserProfile 시작:', userId);

      // 토큰 확보 (onAuthStateChange에서 전달 받는 게 우선)
      let token = accessToken;
      if (!token) {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token;
      }
      if (!token) {
        console.error('[useAuth] 액세스 토큰 없음 — 프로필 로드 불가');
        setLoading(false);
        return;
      }

      // SELECT
      const rows: UserProfile[] = await Promise.race([
        dbFetch(`/users?id=eq.${userId}&select=*&limit=1`, token),
        timeoutPromise,
      ]);

      console.log('[useAuth] users select 결과: rows.length =', rows?.length);

      if (!rows || rows.length === 0) {
        // 신규 유저 — INSERT
        const name = userMeta?.full_name || userMeta?.name || '사용자';
        const newUser = {
          id: userId, name,
          role: 'patient' as const,
          onboarding_done: false,
          kakao_id: null, birth_year: null, gender: null,
          caregiver_relation: null, residence_type: null,
          diagnosis_year: null, notification_enabled: true,
          patient_group_id: null,
        };
        try {
          const inserted: UserProfile[] = await dbFetch('/users?select=*', token, {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(newUser),
          });
          setUser(Array.isArray(inserted) ? inserted[0] : inserted);
        } catch (insertErr: any) {
          // 23505: 중복 키 → 다른 이벤트에서 이미 insert됨 → 다시 select
          if (insertErr.message?.includes('23505')) {
            const retry: UserProfile[] = await dbFetch(`/users?id=eq.${userId}&select=*&limit=1`, token);
            setUser(retry?.[0] ?? (newUser as UserProfile));
          } else {
            console.error('[useAuth] users insert 오류:', insertErr);
            setUser(newUser as UserProfile);
          }
        }
        // 신규 유저도 push token 저장
        if (token) {
          Notifications.getPermissionsAsync().then(({ status }) => {
            if (status === 'granted') {
              requestPermissionsAndSaveToken(userId, token).catch(console.error);
            }
          }).catch(console.error);
        }
      } else {
        setUser(rows[0]);
        // 로그인 성공 시 push token 항상 저장 (온보딩 완료 여부 무관)
        // - 재로그인, 재설치, 앱 업데이트 시에도 토큰이 최신 값으로 유지됨
        if (token) {
          Notifications.getPermissionsAsync().then(({ status }) => {
            if (status === 'granted') {
              requestPermissionsAndSaveToken(userId, token).catch(console.error);
            }
          }).catch(console.error);
        }
        // 환자인 경우 미복용 체크 백그라운드 태스크 등록
        if (rows[0].role === 'patient' && rows[0].notification_enabled) {
          registerMissedMedCheckTask().catch(console.error);
        }
      }
    } catch (e) {
      console.error('[useAuth] loadUserProfile 오류:', e);
      if ((e as Error).message?.includes('타임아웃')) {
        console.warn('[useAuth] DB 타임아웃 → 임시 프로필 사용');
        setUser({
          id: userId,
          name: userMeta?.full_name || userMeta?.name || '사용자',
          role: 'patient', onboarding_done: false,
          notification_enabled: true, patient_group_id: null, kakao_id: null,
          birth_year: null, gender: null, caregiver_relation: null,
          residence_type: null, diagnosis_year: null,
        });
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 앱 실행 시 세션 복원 + 세션 변화 구독
  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        console.log('[useAuth] onAuthStateChange:', event);
        if (session?.user) {
          // access_token을 직접 전달 → dbFetch에서 추가 getSession 호출 없이 바로 사용
          await loadUserProfile(session.user.id, session.user.user_metadata, session.access_token);
        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  // ─── 글로벌 딥링크 핸들러 ─────────────────────────────────────────────────
  // signInWithKakao와 별개로 앱 전체 생명주기 동안 auth URL을 감지해 처리
  // Samsung 등 일부 Android에서 딥링크가 늦게 도착하는 경우도 커버
  // 구글 로그인은 openAuthSessionAsync(Custom Tab)으로 처리하므로
  // Custom Tab 내에서 딥링크가 캡처되어 여기에 중복 도착하지 않음
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('[useAuth] 글로벌 Linking URL 수신:', url.substring(0, 80));
      if (isAuthUrl(url)) {
        // loadUserProfile을 fallback으로 전달 — onAuthStateChange 미발동 시 스피너 무한 방지
        processAuthUrl(url, loadUserProfile);
      }
    });

    // 앱이 딥링크로 시작된 경우 (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log('[useAuth] getInitialURL:', url.substring(0, 80));
        if (isAuthUrl(url)) {
          processAuthUrl(url, loadUserProfile);
        }
      }
    });

    return () => subscription.remove();
  }, [loadUserProfile]);

  // ─── 구글 로그인 (Android 전용) ───────────────────────────────────────────
  // Chrome Custom Tab(openAuthSessionAsync)으로 열기
  // → OAuth 완료 후 딥링크(parkinon://auth/callback) 감지 시 Custom Tab이 자동으로 닫힘
  // → result.url에서 직접 processAuthUrl 호출
  const signInWithGoogle = useCallback(async () => {
    try {
      console.log('[useAuth] signInWithGoogle 시작');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: REDIRECT_TO,
          skipBrowserRedirect: true,
        },
      });
      if (error || !data?.url) {
        console.error('[useAuth] signInWithOAuth(google) 오류:', error?.message);
        return;
      }

      // Chrome Custom Tab으로 열기 → OAuth 완료 후 딥링크 감지 시 탭 자동 닫힘
      console.log('[useAuth] Google - openAuthSessionAsync(Custom Tab) 사용');
      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
      console.log('[useAuth] Google Custom Tab 결과:', result.type);

      if (result.type === 'success' && result.url) {
        // Custom Tab에서 캡처한 URL을 processAuthUrl로 처리
        // loadUserProfile을 fallback으로 전달 — onAuthStateChange 미발동 시 스피너 무한 방지
        await processAuthUrl(result.url, loadUserProfile);
      }
      // result.type === 'cancel'이면 사용자가 취소한 것 → 아무 처리 안 함
    } catch (err) {
      console.error('[useAuth] signInWithGoogle 오류:', err);
    }
  }, [loadUserProfile]);

  // ─── 카카오 로그인 ────────────────────────────────────────────────────────
  // Linking.openURL로 외부 브라우저(Chrome)에서 열기
  //
  // openAuthSessionAsync를 썼을 때의 문제:
  //   카카오 앱이 설치된 경우, OAuth 페이지가 카카오 앱으로 리다이렉트하면서
  //   Chrome Custom Tab이 닫혀버림 → openAuthSessionAsync가 'cancel' 반환
  //   → 콜백 URL을 전혀 받지 못하고 로그인 실패
  //
  // Linking.openURL 방식:
  //   Chrome 외부 브라우저로 열기 → 카카오 앱 통해 인증 완료 후
  //   parkinon://auth/callback 딥링크 발생 → Linking.addEventListener가 처리
  //
  // 반환값: true = 딥링크 대기 중 (signing 유지), false = 즉시 실패 (signing 초기화)
  const signInWithKakao = useCallback(async (): Promise<boolean> => {
    try {
      console.log('[useAuth] signInWithKakao 시작');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
          redirectTo: REDIRECT_TO,
          skipBrowserRedirect: true,
        },
      });

      if (error || !data?.url) {
        console.error('[useAuth] signInWithOAuth 오류:', error?.message);
        Alert.alert('로그인 오류', '카카오 로그인을 시작할 수 없습니다. 네트워크 연결을 확인해주세요.');
        return false;
      }

      // Chrome Custom Tab으로 OAuth URL 열기 (await 없이 fire-and-forget)
      // - Linking.openURL 대비 장점: processAuthUrl에서 WebBrowser.dismissBrowser()로 탭 자동 닫기 가능
      // - 카카오 앱 설치 시 카카오 앱으로 리다이렉트되어도 Custom Tab이 남아있어 닫기 가능
      // - 인증 완료 후 parkinon://auth/callback 딥링크는 Linking.addEventListener가 수신
      console.log('[useAuth] WebBrowser.openBrowserAsync로 카카오 OAuth 열기');
      WebBrowser.openBrowserAsync(data.url).catch(() => {});
      return true; // 딥링크 대기 중 — signing 상태는 LoginScreen의 AppState 리스너가 관리
    } catch (err) {
      console.error('[useAuth] signInWithKakao 오류:', err);
      Alert.alert('로그인 오류', '오류가 발생했습니다. 다시 시도해주세요.');
      return false;
    }
  }, []);

  // 개발용 mock 로그인
  const devSignIn = useCallback(async () => {
    const mockUser: UserProfile = {
      id: '00000000-0000-0000-0000-000000000001',
      name: '홍길동',
      role: 'patient',
      onboarding_done: true,
      notification_enabled: true,
      patient_group_id: null,
      kakao_id: null,
      birth_year: 1960,
      gender: 'male',
      caregiver_relation: null,
      residence_type: null,
      diagnosis_year: 2020,
    };
    setUser(mockUser);
  }, []);

  // 로그아웃
  const signOut = useCallback(async () => {
    setLoading(true);
    await supabase.auth.signOut();
    // 계정 전환 시 이전 계정의 로컬 알림이 남지 않도록 전체 취소
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}
    setUser(null);
    setLoading(false);
  }, []);

  // 유저 프로필 새로고침
  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await loadUserProfile(session.user.id, session.user.user_metadata, session.access_token);
    }
  }, [loadUserProfile]);

  const forceCompleteOnboarding = useCallback(() => {
    setUser((prev) => (prev ? { ...prev, onboarding_done: true } : prev));
  }, []);

  return { user, loading, signInWithKakao, signInWithGoogle, signOut, refreshUser, devSignIn, forceCompleteOnboarding };
}
