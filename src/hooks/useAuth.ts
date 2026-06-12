/**
 * useAuth.ts
 * Supabase OAuth 기반 인증 훅
 *
 * NOTE: 컴포넌트에서 직접 import하지 말 것.
 * useAuth()는 src/context/AuthContext.tsx 에서 import 하세요.
 * 이 파일의 useAuthProvider()는 AuthProvider 내부에서만 사용합니다.
 */
import { useState, useEffect, useCallback } from 'react';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { login as kakaoLogin } from '@react-native-seoul/kakao-login';
import { supabase } from '../lib/supabase';
import { requestPermissionsAndSaveToken } from '../utils/notifications';
import { provisionForUser } from '../lib/alarmSound';
import { useDialog, DialogApi } from '../context/DialogContext';
import { GUEST_USER_ID } from '../utils/guestGuard';

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
  sensitive_info_consent_version: number | null;
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
  dialog?: DialogApi,
): Promise<void> {
  if (__DEV__) console.log('[useAuth] Auth URL 처리 시작:', url.substring(0, 80));

  // fragment 방식 (access_token + refresh_token)
  const fragmentStr = url.split('#')[1] ?? '';
  const fragmentParams = new URLSearchParams(fragmentStr);
  const accessToken = fragmentParams.get('access_token');
  const refreshToken = fragmentParams.get('refresh_token');

  if (accessToken && refreshToken) {
    if (__DEV__) console.log('[useAuth] fragment 토큰 발견 → setSession');
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) {
      console.error('[useAuth] setSession 오류:', error.message);
      dialog?.alert({ title: '로그인 실패', message: '카카오 로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.' });
    }
  } else {
    // PKCE 방식 (code 파라미터)
    const parsed = Linking.parse(url);
    const code = parsed.queryParams?.code as string | undefined;
    if (__DEV__) console.log('[useAuth] PKCE code 있음:', !!code);

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('[useAuth] exchangeCodeForSession 오류:', error.message, error.status);
        dialog?.alert({ title: '로그인 실패', message: '카카오 로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.' });
        return;
      }
      // onAuthStateChange가 발동하지 않을 경우를 대비해 세션 직접 확인
      if (data?.session?.user) {
        if (__DEV__) console.log('[useAuth] exchangeCodeForSession 성공, onAuthStateChange 대기 중:', data.session.user.id);
        // 300ms 대기 후 onAuthStateChange 발동 여부 확인
        await new Promise(resolve => setTimeout(resolve, 300));
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.user && onAuthStateChangeFallback) {
          if (__DEV__) console.log('[useAuth] fallback 직접 처리 → loadUserProfile 호출');
          await onAuthStateChangeFallback(
            currentSession.user.id,
            currentSession.user.user_metadata,
            currentSession.access_token,
          );
        }
      }
    } else {
      if (__DEV__) console.error('[useAuth] Auth URL에서 토큰/코드 없음. 파라미터:', Object.keys(parsed.queryParams ?? {}));
      dialog?.alert({ title: '로그인 실패', message: '카카오 로그인 응답이 올바르지 않습니다. 다시 시도해주세요.' });
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

// ─── 로그아웃 시 정리할 사용자별 AsyncStorage 키 ─────────────────────────────
// 다음 로그인 사용자와 섞이면 안 되는 키만 정리한다.
// 기기 공용 설정(배터리 최적화 안내 등)은 의도적으로 제외한다.
const USER_SCOPED_STORAGE_KEYS = [
  // 측정 동의 / 기준선 메타
  'measurement_consent_v1',
  'measurement_baseline_med_signature_v1',
  'measurement_baseline_reset_at_v1',
  // 약 알림 추천 / 알림 온보딩
  'med_notif_recommendation_meta',
  'notif_onboarding_shown',
  // 알림 스케줄/중복처리 상태
  'processedNotifIds',
  'missedMedRemindNotifIds',
  'exerciseNotifIds',
  // 사용자별 알림 설정
  'settings_med_notifs',
  'settings_exercise_notifs',
  'settings_caregiver_notifs',
  // 피드 읽음 표시
  'parkinon_read_posts',
  // 민감정보 동의
  'sensitive_info_consented',
  // 알림으로 진입 대기중인 임시 데이터
  'pendingMedNotif',
  'pendingBodyStateNotif',
  'pendingExerciseNotif',
  // 온보딩 임시 입력값(다음 사용자와 섞이면 안 됨)
  'onboarding_name',
  'onboarding_birth_year',
  'onboarding_gender',
  'onboarding_diag_year',
  'onboarding_relation',
  'onboarding_living',
  'onboarding_role',
  'onboarding_medications',
  'onboarding_med_notifs',
  'onboarding_notifications',
  'onboarding_group_id',
  'onboarding_invite_code',
  'onboarding_invite_code_generated',
] as const;

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
  const dialog = useDialog();

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
      if (__DEV__) console.log('[useAuth] loadUserProfile 시작:', userId);

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

      if (__DEV__) console.log('[useAuth] users select 결과: rows.length =', rows?.length);

      if (!rows || rows.length === 0) {
        // ── 신규(또는 아직 보이지 않는) 유저 ──────────────────────────────────
        // 카카오 로그인은 Edge Function(kakao-auth)이 verifyOtp 직전에 이미
        // public.users 행을 kakao_id와 함께 INSERT한다. 따라서 카카오 경로에서는
        // 클라이언트가 절대 INSERT하지 않는다(유령 행 방지: kakao_id=null / 이름 '사용자').
        // 다만 복제 지연으로 행이 잠깐 안 보일 수 있으므로 짧게 폴링하여 읽는다.
        //
        // 구글 로그인은 Edge Function도 DB 트리거도 없어 클라이언트 INSERT만이
        // 행을 만든다. 구글 유저는 kakao_id=null이 정상이므로 INSERT를 유지한다.
        const isKakao = userMeta?.provider === 'kakao';

        if (isKakao) {
          // 카카오: Edge Function이 만든 행을 폴링으로 기다려 읽기만 한다(INSERT 금지)
          let kakaoRow: UserProfile | undefined;
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 300));
            const retry: UserProfile[] = await dbFetch(`/users?id=eq.${userId}&select=*&limit=1`, token);
            if (retry && retry.length > 0) {
              kakaoRow = retry[0];
              break;
            }
            if (__DEV__) console.log(`[useAuth] 카카오 행 폴링 ${attempt + 1}/5 — 아직 없음`);
          }
          if (kakaoRow) {
            setUser(kakaoRow);
            provisionForUser(kakaoRow.id, kakaoRow.patient_group_id ?? null).catch(() => {});
          } else {
            // Edge Function 행이 끝내 안 보임 → 로그인 실패 처리(클라 INSERT 금지)
            console.error('[useAuth] 카카오 유저 행을 찾지 못함 — Edge Function 행 누락 추정');
            dialog?.alert({ title: '로그인 실패', message: '로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.' });
            setUser(null);
            setLoading(false);
            return;
          }
          // 카카오 신규/기존 유저 push token 저장
          if (token) {
            Notifications.getPermissionsAsync().then(({ status }) => {
              if (status === 'granted') {
                requestPermissionsAndSaveToken(userId, token).catch(console.error);
              }
            }).catch(console.error);
          }
          return;
        }

        // 구글 등 비-카카오 경로 — Edge Function/트리거가 없으므로 클라 INSERT로 행 생성
        const name = userMeta?.full_name || userMeta?.name || '사용자';
        const newUser = {
          id: userId, name,
          role: 'patient' as const,
          onboarding_done: false,
          kakao_id: null, birth_year: null, gender: null,
          caregiver_relation: null, residence_type: null,
          diagnosis_year: null, notification_enabled: true,
          patient_group_id: null,
          sensitive_info_consented: false,
          sensitive_info_consent_version: null,
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
        // 알림음 채널 프로비저닝 (약 알림이 오기 전에 가족 목소리 채널을 미리 깔아둠)
        provisionForUser(rows[0].id, rows[0].patient_group_id ?? null).catch(() => {});
        // 로그인 성공 시 push token 항상 저장 (온보딩 완료 여부 무관)
        // - 재로그인, 재설치, 앱 업데이트 시에도 토큰이 최신 값으로 유지됨
        if (token) {
          Notifications.getPermissionsAsync().then(({ status }) => {
            if (status === 'granted') {
              requestPermissionsAndSaveToken(userId, token).catch(console.error);
            }
          }).catch(console.error);
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
          sensitive_info_consented: null,
          sensitive_info_consent_version: null,
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
    let initialHandled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        initialHandled = true;
        if (__DEV__) console.log('[useAuth] onAuthStateChange:', event);
        if (session?.user) {
          // access_token을 직접 전달 → dbFetch에서 추가 getSession 호출 없이 바로 사용
          await loadUserProfile(session.user.id, session.user.user_metadata, session.access_token);
        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    // 부트스트랩: onAuthStateChange 의 초기(INITIAL_SESSION) 이벤트가 발화하지 않거나 늦는
    // 경우 대비해 직접 세션을 확인한다. (이게 없으면 그 이벤트가 안 올 때 loading 이 영영
    // 안 풀려 흰 화면+스피너에 갇힘 — 장시간 사용 후 토큰 갱신 타이밍 등에서 발생)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted || initialHandled) return;
      if (session?.user) {
        loadUserProfile(session.user.id, session.user.user_metadata, session.access_token);
      } else {
        setUser(null);
        setLoading(false);
      }
    }).catch(() => { if (mounted) setLoading(false); });

    // 안전장치: 어떤 이유로든 로딩이 안 풀리면 강제 해제(무한 흰 화면 방지 — 최소 로그인
    // 화면이라도 보이게). 만료 세션 복원 실패 등으로 오래 걸릴 때 대기를 짧게.
    const loadingSafety = setTimeout(() => { if (mounted) setLoading(false); }, 3000);

    return () => {
      mounted = false;
      clearTimeout(loadingSafety);
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  // ─── 글로벌 딥링크 핸들러 ─────────────────────────────────────────────────
  // signInWithKakao와 별개로 앱 전체 생명주기 동안 auth URL을 감지해 처리
  // Samsung 등 일부 Android에서 딥링크가 늦게 도착하는 경우도 커버
  // 구글 로그인은 openAuthSessionAsync(Custom Tab)으로 처리하므로
  // Custom Tab 내에서 딥링크가 캡처되어 여기에 중복 도착하지 않음
  useEffect(() => {
    const lastProcessedUrl = { current: null as string | null };

    const handleUrl = (url: string) => {
      if (!isAuthUrl(url)) return;
      if (url === lastProcessedUrl.current) return;
      lastProcessedUrl.current = url;
      if (__DEV__) console.log('[useAuth] auth URL 처리:', url.substring(0, 80));
      processAuthUrl(url, loadUserProfile, dialog);
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (__DEV__) console.log('[useAuth] 글로벌 Linking URL 수신:', url.substring(0, 80));
      handleUrl(url);
    });

    // 앱이 딥링크로 시작된 경우 (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) {
        if (__DEV__) console.log('[useAuth] getInitialURL (cold start):', url.substring(0, 80));
        handleUrl(url);
      }
    });

    // New Architecture 폴백: AppState active 시 getInitialURL 직접 확인
    // Expo New Architecture에서 Linking.addEventListener가 onNewIntent 딥링크에서
    // 발화하지 않는 버그를 우회 — getInitialURL()은 현재 Intent data를 직접 읽음
    const appStateSub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        try {
          const url = await Linking.getInitialURL();
          if (url) {
            if (__DEV__) console.log('[useAuth] AppState active - getInitialURL:', url.substring(0, 80));
            handleUrl(url);
          }
        } catch (_) {}
      }
    });

    return () => {
      subscription.remove();
      appStateSub.remove();
    };
  }, [loadUserProfile, dialog]);

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
        await processAuthUrl(result.url, loadUserProfile, dialog);
      }
      // result.type === 'cancel'이면 사용자가 취소한 것 → 아무 처리 안 함
    } catch (err) {
      console.error('[useAuth] signInWithGoogle 오류:', err);
    }
  }, [loadUserProfile, dialog]);

  // ─── 카카오 로그인 (네이티브 SDK) ─────────────────────────────────────────
  // @react-native-seoul/kakao-login SDK로 카카오톡 앱/카카오 계정 로그인 →
  // accessToken을 Edge Function(kakao-auth)에 전달 →
  // magic link token_hash로 verifyOtp → Supabase 세션 발급
  const signInWithKakao = useCallback(async (): Promise<boolean> => {
    try {
      console.log('[useAuth] signInWithKakao 시작 (Native SDK)');

      // 1) SDK로 카카오 로그인 (카톡 앱 또는 카카오 계정 웹뷰)
      const tokenResult = await kakaoLogin();
      if (__DEV__) console.log('[useAuth] SDK 로그인 성공, accessToken 획득');

      // 2) Edge Function 호출 → magic link 발급
      const { data, error } = await supabase.functions.invoke('kakao-auth', {
        body: { kakaoAccessToken: tokenResult.accessToken },
      });
      if (error) {
        console.error('[useAuth] kakao-auth 호출 오류:', error.message);
        throw error;
      }
      if (!data?.action_link) {
        // 보안: action_link(매직링크 토큰 포함)는 로그에 남기지 않음
        console.error('[useAuth] action_link 없음 (응답 비정상)');
        throw new Error('action_link 없음');
      }

      // 3) action_link에서 token_hash 파싱 → verifyOtp로 세션 생성
      const url = new URL(data.action_link);
      const tokenHash = url.searchParams.get('token');
      if (!tokenHash) {
        // 보안: action_link 값(토큰 포함)은 로그에 남기지 않음
        console.error('[useAuth] action_link에서 token 파싱 실패');
        throw new Error('token 파싱 실패');
      }

      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: tokenHash,
      });
      if (verifyError) {
        console.error('[useAuth] verifyOtp 오류:', verifyError.message);
        throw verifyError;
      }

      if (verifyData.user) {
        if (__DEV__) console.log('[useAuth] verifyOtp 성공, 프로필 로드:', verifyData.user.id);
        // onAuthStateChange가 자동 발동하지만, 만약 안 될 경우를 대비해 직접도 호출
        // (onAuthStateChange가 발동하면 setUser가 두 번 호출되지만 같은 데이터라 문제 없음)
        await loadUserProfile(
          verifyData.user.id,
          verifyData.user.user_metadata,
          verifyData.session?.access_token,
        );
      }
      return true;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error('[useAuth] signInWithKakao 오류:', msg);
      // 사용자 취소는 에러 알림 표시하지 않음
      const lower = msg.toLowerCase();
      if (
        lower.includes('cancel') ||
        lower.includes('user cancelled') ||
        lower.includes('user canceled')
      ) {
        return false;
      }
      dialog.alert({ title: '로그인 오류', message: '오류가 발생했습니다. 다시 시도해주세요.\n\n[디버그] ' + msg.substring(0, 200) });
      return false;
    }
  }, [loadUserProfile, dialog]);

  // 개발용 mock 로그인
  const devSignIn = useCallback(async () => {
    const mockUser: UserProfile = {
      id: GUEST_USER_ID,
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
      sensitive_info_consented: true,
      sensitive_info_consent_version: 1,
    };
    setUser(mockUser);
  }, []);

  // 로그아웃
  const signOut = useCallback(async () => {
    setLoading(true);

    // 로그아웃 전 push_token 초기화 (다른 계정에 알림이 가는 것 방지)
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const accessToken = sessionData?.session?.access_token;
      if (userId && accessToken) {
        await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ push_token: null }),
        });
      }
    } catch (e) {
      console.warn('[signOut] push_token 초기화 실패:', e);
    }

    await supabase.auth.signOut();
    // 계정 전환 시 이전 계정의 로컬 알림이 남지 않도록 전체 취소
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}
    // 사용자별 로컬 데이터 정리 (다음 로그인 사용자와 섞이지 않도록)
    // 기기 공용 설정은 USER_SCOPED_STORAGE_KEYS에 포함하지 않았으므로 유지된다.
    try {
      await AsyncStorage.multiRemove([...USER_SCOPED_STORAGE_KEYS]);
    } catch (e) {
      console.warn('[signOut] 사용자별 로컬 데이터 정리 실패:', e);
    }
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
