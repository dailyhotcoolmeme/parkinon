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
import { logActivity, flush as flushActivity } from './../utils/activityLog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { login as kakaoLogin } from '@react-native-seoul/kakao-login';
import { supabase } from '../lib/supabase';
import { requestPermissionsAndSaveToken } from '../utils/notifications';
import { getDeviceTimeZone } from '../utils/timezone';
import { provisionForUser } from '../lib/alarmSound';
import { useDialog, DialogApi } from '../context/DialogContext';
import { GUEST_USER_ID } from '../utils/guestGuard';
import i18n from '../i18n';

// ─── 딥링크 redirect URI ────────────────────────────────────────────────────
const REDIRECT_TO = 'parkinon://auth/callback';

// ─── 타입 ────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  name: string;
  role: 'patient' | 'caregiver';
  onboarding_done: boolean;
  notification_enabled: boolean;
  /** Expo Push Token — 서버 푸시 알림(약효추적/보호자 연동) 라우팅에 필수. null이면 푸시 불가 */
  push_token: string | null;
  patient_group_id: string | null;
  kakao_id: string | null;
  birth_year: number | null;
  gender: 'male' | 'female' | null;
  caregiver_relation: string | null;
  residence_type: 'together' | 'separate' | null;
  diagnosis_year: number | null;
  sensitive_info_consented: boolean | null;
  sensitive_info_consent_version: number | null;
  international_transfer_consented: boolean | null;
  international_transfer_consent_version: number | null;
  /** 커뮤니티 이용 제한(밴) 여부. true면 글/댓글 작성 차단 */
  banned: boolean | null;
  /** 사용자 기기 IANA 타임존(예: 'Asia/Seoul', 'America/New_York'). Phase1 S1에서 저장만, S2/S3에서 사용 */
  timezone: string;
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
  forceCompleteOnboarding: (patientGroupId?: string | null) => void;
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
  if (__DEV__) console.log('[useAuth] handling auth URL:', url.substring(0, 80));

  // fragment 방식 (access_token + refresh_token)
  const fragmentStr = url.split('#')[1] ?? '';
  const fragmentParams = new URLSearchParams(fragmentStr);
  const accessToken = fragmentParams.get('access_token');
  const refreshToken = fragmentParams.get('refresh_token');

  if (accessToken && refreshToken) {
    if (__DEV__) console.log('[useAuth] found fragment token - calling setSession');
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) {
      console.error('[useAuth] setSession error:', error.message);
      dialog?.alert({ title: i18n.t('authHook.loginFailTitle'), message: i18n.t('authHook.kakaoErrorMsg') });
    }
  } else {
    // PKCE 방식 (code 파라미터)
    const parsed = Linking.parse(url);
    const code = parsed.queryParams?.code as string | undefined;
    if (__DEV__) console.log('[useAuth] PKCE code present:', !!code);

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('[useAuth] exchangeCodeForSession error:', error.message, error.status);
        dialog?.alert({ title: i18n.t('authHook.loginFailTitle'), message: i18n.t('authHook.kakaoErrorMsg') });
        return;
      }
      // onAuthStateChange가 발동하지 않을 경우를 대비해 세션 직접 확인
      if (data?.session?.user) {
        if (__DEV__) console.log('[useAuth] exchangeCodeForSession succeeded, waiting for onAuthStateChange:', data.session.user.id);
        // 300ms 대기 후 onAuthStateChange 발동 여부 확인
        await new Promise(resolve => setTimeout(resolve, 300));
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.user && onAuthStateChangeFallback) {
          if (__DEV__) console.log('[useAuth] fallback handling directly - calling loadUserProfile');
          await onAuthStateChangeFallback(
            currentSession.user.id,
            currentSession.user.user_metadata,
            currentSession.access_token,
          );
        }
      }
    } else {
      if (__DEV__) console.error('[useAuth] no token/code in the auth URL. params:', Object.keys(parsed.queryParams ?? {}));
      dialog?.alert({ title: i18n.t('authHook.loginFailTitle'), message: i18n.t('authHook.kakaoInvalidResponseMsg') });
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
  // 민감정보 동의 / 국외 이전 동의
  'sensitive_info_consented',
  'international_transfer_consented',
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

// ─── 마지막 성공 프로필 캐시 ────────────────────────────────────────────────
// DB 조회가 8초 타임아웃되면 catch가 onboarding_done:false 임시 프로필을 setUser 했고,
// 그러면 RootNavigator 게이트가 이미 온보딩을 마친 사용자를 OnboardingNavigator(FamilyCheck)
// 로 추방했다. (DB는 정상, 순수 부팅 타이밍 회귀.) 해결: users 행을 성공적으로 읽을 때마다
// 게이트에 쓰이는 필드를 사용자별 키로 캐시하고, 타임아웃 폴백에서 임시 false 프로필 대신
// 마지막 성공 프로필을 복원한다. 캐시 키는 user.id별 → 다른 사용자 프로필이 복원되지 않음.
const PROFILE_CACHE_PREFIX = 'last_user_profile_v1:';
const profileCacheKey = (userId: string) => `${PROFILE_CACHE_PREFIX}${userId}`;

async function cacheProfile(profile: UserProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(profileCacheKey(profile.id), JSON.stringify(profile));
  } catch (e) {
    if (__DEV__) console.warn('[useAuth] failed to save the profile cache:', e);
  }
}

async function readCachedProfile(userId: string): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    // 다른 사용자 프로필이 섞이지 않도록 id 일치 확인
    if (parsed?.id !== userId) return null;
    return parsed;
  } catch (e) {
    if (__DEV__) console.warn('[useAuth] failed to read the profile cache:', e);
    return null;
  }
}

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
    console.error('[dbFetch] error:', res.status, text);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ─── 훅 본체 ──────────────────────────────────────────────────────────────────
// 탈퇴 진행 중 플래그. 탈퇴로 users 행이 삭제된 뒤 세션이 잠깐 남은 채 인증흐름이 재실행되면
// 비-카카오(구글) 경로가 onboarding_done:false 프로필을 새로 INSERT 해 온보딩 화면으로 빠지는 문제 방지.
// signOut 완료 시 자동 해제된다.
let withdrawing = false;
export function setWithdrawing(v: boolean) { withdrawing = v; }

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
      setTimeout(() => reject(new Error('Supabase DB connection timeout')), 8000)
    );
    try {
      if (__DEV__) console.log('[useAuth] loadUserProfile start:', userId);

      // 탈퇴 진행 중이면 프로필을 만들거나 로드하지 않고 즉시 로그인 화면으로(온보딩 오탈출 방지).
      if (withdrawing) {
        setUser(null);
        setLoading(false);
        return;
      }

      // 토큰 확보 (onAuthStateChange에서 전달 받는 게 우선)
      let token = accessToken;
      if (!token) {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token;
      }
      if (!token) {
        console.error('[useAuth] no access token - cannot load profile');
        setLoading(false);
        return;
      }

      // SELECT
      const rows: UserProfile[] = await Promise.race([
        dbFetch(`/users?id=eq.${userId}&select=*&limit=1`, token),
        timeoutPromise,
      ]);

      if (__DEV__) console.log('[useAuth] users select result: rows.length =', rows?.length);

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
            if (__DEV__) console.log(`[useAuth] polling for the kakao row ${attempt + 1}/5 — not there yet`);
          }
          if (kakaoRow) {
            setUser(kakaoRow);
            cacheProfile(kakaoRow);
            provisionForUser(kakaoRow.id, kakaoRow.patient_group_id ?? null).catch(() => {});
          } else {
            // Edge Function 행이 끝내 안 보임 → 로그인 실패 처리(클라 INSERT 금지)
            console.error('[useAuth] kakao user row not found - the Edge Function row is likely missing');
            dialog?.alert({ title: i18n.t('authHook.loginFailTitle'), message: i18n.t('authHook.genericLoginFailMsg') });
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
        // Apple 로그인은 signInWithIdToken 이 메타데이터를 안 받아 user_metadata.full_name 이
        // 항상 비어있다 — LoginScreen 이 최초 1회 받은 이름을 AsyncStorage에 심어두면 여기서 우선 사용.
        // (안 하면 온보딩에서 이름을 또 물어봐 애플 심사 거절 사유: "이미 제공된 정보 재요구 금지")
        const pendingAppleName = await AsyncStorage.getItem('pending_apple_name').catch(() => null);
        if (pendingAppleName) AsyncStorage.removeItem('pending_apple_name').catch(() => {});
        const name = pendingAppleName || userMeta?.full_name || userMeta?.name || i18n.t('authHook.defaultUserName');
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
          international_transfer_consented: false,
          international_transfer_consent_version: null,
          banned: false,
          // 기기 IANA 타임존(Phase1 S1). 컬럼 DEFAULT도 'Asia/Seoul'이라 미지정도 안전하나,
          // 구글 등 비-카카오 신규 가입 시 실제 기기 tz를 즉시 채운다.
          timezone: getDeviceTimeZone(),
        };
        try {
          const inserted: UserProfile[] = await dbFetch('/users?select=*', token, {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(newUser),
          });
          const insertedProfile = Array.isArray(inserted) ? inserted[0] : inserted;
          setUser(insertedProfile);
          if (insertedProfile) cacheProfile(insertedProfile as UserProfile);
        } catch (insertErr: any) {
          // 23505: 중복 키 → 다른 이벤트에서 이미 insert됨 → 다시 select
          if (insertErr.message?.includes('23505')) {
            const retry: UserProfile[] = await dbFetch(`/users?id=eq.${userId}&select=*&limit=1`, token);
            const retried = retry?.[0] ?? (newUser as UserProfile);
            setUser(retried);
            cacheProfile(retried);
          } else {
            console.error('[useAuth] users insert error:', insertErr);
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
        cacheProfile(rows[0]);
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
      console.error('[useAuth] loadUserProfile error:', e);
      if ((e as Error).message?.includes('timeout')) {
        // ⚠️ DB 타임아웃을 "온보딩 미완료"로 단정하지 않는다.
        // 마지막 성공 프로필이 캐시에 있으면 그것을 복원해, 이미 온보딩을 마친
        // 사용자가 FamilyCheck(온보딩)로 추방되는 회귀를 막는다.
        const cached = await readCachedProfile(userId);
        if (cached) {
          console.warn('[useAuth] DB timeout - restoring the last successful profile cache');
          setUser(cached);
        } else {
          // 캐시도 없음: 세션은 살아있는데 프로필을 끝내 확정하지 못한 상태.
          // 여기서 onboarding_done:false 임시 프로필을 박으면(과거 회귀) 이미 가입된
          // 사용자도 온보딩으로 빠지므로, 그러지 않고 한 번 더 재조회를 시도한다.
          // 재조회도 실패하면 user는 그대로 두고(섣불리 온보딩/로그인 화면으로 보내지 않음)
          // realtime/다음 onAuthStateChange/refreshUser가 확정하도록 맡긴다.
          console.warn('[useAuth] DB timeout and no cache - retrying the lookup once');
          try {
            let token = accessToken;
            if (!token) {
              const { data: { session } } = await supabase.auth.getSession();
              token = session?.access_token;
            }
            if (token) {
              const retryRows: UserProfile[] = await dbFetch(`/users?id=eq.${userId}&select=*&limit=1`, token);
              if (retryRows && retryRows.length > 0) {
                setUser(retryRows[0]);
                cacheProfile(retryRows[0]);
              }
            }
          } catch (retryErr) {
            console.warn('[useAuth] retry lookup after timeout also failed:', retryErr);
            // user 상태를 건드리지 않는다(온보딩 추방 방지).
          }
        }
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
      if (__DEV__) console.log('[useAuth] handling auth URL:', url.substring(0, 80));
      processAuthUrl(url, loadUserProfile, dialog);
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (__DEV__) console.log('[useAuth] global Linking URL received:', url.substring(0, 80));
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

  // 유저 프로필 새로고침
  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await loadUserProfile(session.user.id, session.user.user_metadata, session.access_token);
    }
  }, [loadUserProfile]);

  // ─── 정지(banned) 등 자기 프로필 변경 즉시 반영 ──────────────────────────
  // 문제: 로그인 시점의 user 스냅샷만 보면, 이미 로그인된 계정이 관리자에 의해
  //       users.banned=true 로 바뀌어도 앱이 모른 채 글쓰기/댓글 UI 를 열어준다.
  //       (서버 RLS 는 INSERT 를 42501 로 거부하지만, 선제 안내가 안 뜸)
  // 해결: 현재 로그인 사용자의 public.users 자기 행을 realtime 구독하여 변경 시
  //       메모리 user 에 즉시 병합(banned 외 필드 변경도 같이 반영).
  //   ⚠️ users 테이블은 REPLICA IDENTITY FULL + realtime publication 포함이라
  //      payload.new 는 "방금 커밋된 최신 행 전체"다(SettingsScreen 과 동일 원리).
  //      → payload.new 를 그대로 병합하면 복제 지연 race 없이 항상 최신.
  // 본인 users 행 realtime 구독 — banned 등 변경 즉시 메모리 user 에 반영.
  useEffect(() => {
    const userId = user?.id;
    // 게스트/개발용 mock(GUEST_USER_ID)은 DB 행이 없으므로 구독하지 않는다.
    if (!userId || userId === GUEST_USER_ID) return;

    const topic = `auth-self-sync-${userId}`;
    // 재진입 시 잔존 채널 제거(이미 subscribe() 된 채널 재사용 → .on() 크래시 방지)
    supabase
      .getChannels()
      .filter((c) => c.topic === `realtime:${topic}` || c.topic === topic)
      .forEach((c) => { supabase.removeChannel(c); });

    const channel = supabase.channel(topic);
    channel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Partial<UserProfile> | null;
          if (!row) return;
          // 방금 커밋된 최신 자기 행 전체 → 메모리 user 에 병합(banned 등 즉시 반영)
          setUser((prev) => (prev ? { ...prev, ...row } : prev));
        },
      )
      .subscribe();

    // (성능) 포그라운드 복귀(AppState 'active') 시 refreshUser() 재조회 제거.
    //   매 복귀(=거의 모든 알림 진입)마다 loadUserProfile(users select *) + provisionForUser
    //   (쿼리 5개 + 알림채널 다운로드/설치)를 재실행해 알림 진입을 느리게 했다.
    //   banned 등 본인 행 변경 즉시 반영은 위 realtime 구독(UPDATE → setUser 병합)이 담당하므로
    //   AppState 보조 재조회는 중복·고비용 → 제거. provisionForUser는 최초 프로필 로드 시 1회면 충분.
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // ─── 구글 로그인 (Android 전용) ───────────────────────────────────────────
  // Chrome Custom Tab(openAuthSessionAsync)으로 열기
  // → OAuth 완료 후 딥링크(parkinon://auth/callback) 감지 시 Custom Tab이 자동으로 닫힘
  // → result.url에서 직접 processAuthUrl 호출
  const signInWithGoogle = useCallback(async () => {
    try {
      console.log('[useAuth] signInWithGoogle start');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: REDIRECT_TO,
          skipBrowserRedirect: true,
        },
      });
      if (error || !data?.url) {
        console.error('[useAuth] signInWithOAuth(google) error:', error?.message);
        return;
      }

      // Chrome Custom Tab으로 열기 → OAuth 완료 후 딥링크 감지 시 탭 자동 닫힘
      console.log('[useAuth] Google - using openAuthSessionAsync (Custom Tab)');
      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
      console.log('[useAuth] Google Custom Tab result:', result.type);

      if (result.type === 'success' && result.url) {
        // Custom Tab에서 캡처한 URL을 processAuthUrl로 처리
        // loadUserProfile을 fallback으로 전달 — onAuthStateChange 미발동 시 스피너 무한 방지
        await processAuthUrl(result.url, loadUserProfile, dialog);
      }
      // result.type === 'cancel'이면 사용자가 취소한 것 → 아무 처리 안 함
    } catch (err) {
      console.error('[useAuth] signInWithGoogle error:', err);
    }
  }, [loadUserProfile, dialog]);

  // ─── 카카오 로그인 (네이티브 SDK) ─────────────────────────────────────────
  // @react-native-seoul/kakao-login SDK로 카카오톡 앱/카카오 계정 로그인 →
  // accessToken을 Edge Function(kakao-auth)에 전달 →
  // magic link token_hash로 verifyOtp → Supabase 세션 발급
  const signInWithKakao = useCallback(async (): Promise<boolean> => {
    try {
      console.log('[useAuth] signInWithKakao start (native SDK)');

      // 1) SDK로 카카오 로그인 (카톡 앱 또는 카카오 계정 웹뷰)
      const tokenResult = await kakaoLogin();
      if (__DEV__) console.log('[useAuth] SDK login succeeded, accessToken acquired');

      // 2) Edge Function 호출 → magic link 발급
      const { data, error } = await supabase.functions.invoke('kakao-auth', {
        body: { kakaoAccessToken: tokenResult.accessToken },
      });
      if (error) {
        console.error('[useAuth] kakao-auth call error:', error.message);
        throw error;
      }
      if (!data?.action_link) {
        // 보안: action_link(매직링크 토큰 포함)는 로그에 남기지 않음
        console.error('[useAuth] action_link missing (unexpected response)');
        throw new Error('action_link missing');
      }

      // 3) action_link에서 token_hash 파싱 → verifyOtp로 세션 생성
      const url = new URL(data.action_link);
      const tokenHash = url.searchParams.get('token');
      if (!tokenHash) {
        // 보안: action_link 값(토큰 포함)은 로그에 남기지 않음
        console.error('[useAuth] failed to parse token from action_link');
        throw new Error('token parse failed');
      }

      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: tokenHash,
      });
      if (verifyError) {
        console.error('[useAuth] verifyOtp error:', verifyError.message);
        throw verifyError;
      }

      if (verifyData.user) {
        if (__DEV__) console.log('[useAuth] verifyOtp succeeded, loading profile:', verifyData.user.id);
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
      console.error('[useAuth] signInWithKakao error:', msg);
      // 사용자 취소는 에러 알림 표시하지 않음
      const lower = msg.toLowerCase();
      if (
        lower.includes('cancel') ||
        lower.includes('user cancelled') ||
        lower.includes('user canceled')
      ) {
        return false;
      }
      dialog.alert({ title: i18n.t('authHook.loginErrorTitle'), message: i18n.t('authHook.genericErrorMsg') + '\n\n[debug] ' + msg.substring(0, 200) });
      return false;
    }
  }, [loadUserProfile, dialog]);

  // 개발용 mock 로그인
  const devSignIn = useCallback(async () => {
    const mockUser: UserProfile = {
      id: GUEST_USER_ID,
      name: i18n.t('authHook.mockGuestName'),
      role: 'patient',
      onboarding_done: true,
      notification_enabled: true,
      push_token: null,
      patient_group_id: null,
      kakao_id: null,
      birth_year: 1960,
      gender: 'male',
      caregiver_relation: null,
      residence_type: null,
      diagnosis_year: 2020,
      sensitive_info_consented: true,
      sensitive_info_consent_version: 1,
      international_transfer_consented: true,
      international_transfer_consent_version: 1,
      banned: false,
      timezone: 'Asia/Seoul',
    };
    setUser(mockUser);
  }, []);

  // 로그아웃
  const signOut = useCallback(async () => {
    setLoading(true);
    // 세션이 살아있는 동안 로그아웃 이벤트를 먼저 전송(이후 flush 는 세션 없어 실패).
    logActivity('logout');
    await flushActivity().catch(() => {});

    // 로그아웃 전 push_token 초기화 (다른 계정에 알림이 가는 것 방지)
    let signedOutUserId: string | undefined;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      signedOutUserId = userId;
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
      console.warn('[signOut] failed to clear push_token:', e);
    }

    await supabase.auth.signOut();
    // 계정 전환 시 이전 계정의 로컬 알림이 남지 않도록 전체 취소
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}
    // 사용자별 로컬 데이터 정리 (다음 로그인 사용자와 섞이지 않도록)
    // 기기 공용 설정은 USER_SCOPED_STORAGE_KEYS에 포함하지 않았으므로 유지된다.
    try {
      const keysToRemove: string[] = [...USER_SCOPED_STORAGE_KEYS];
      // 마지막 성공 프로필 캐시(사용자별 키)도 정리 — 다음 로그인 사용자 프로필이 복원되지 않게.
      if (signedOutUserId) keysToRemove.push(profileCacheKey(signedOutUserId));
      await AsyncStorage.multiRemove(keysToRemove);
    } catch (e) {
      console.warn('[signOut] failed to clear per-user local data:', e);
    }
    setUser(null);
    setLoading(false);
    withdrawing = false; // 탈퇴 흐름 종료 → 다음 로그인은 정상 프로필 로드
  }, []);

  // 온보딩 완료를 메모리 user에 즉시 반영.
  // patient_group_id 를 함께 넘기면 같이 반영해, 화면 전환 직후 "가족 연동 안내 팝업"이
  // stale(null) 값을 보고 잘못 뜨는 레이스 컨디션을 방지한다.
  const forceCompleteOnboarding = useCallback((patientGroupId?: string | null) => {
    setUser((prev) =>
      prev
        ? {
            ...prev,
            onboarding_done: true,
            patient_group_id: patientGroupId ?? prev.patient_group_id,
          }
        : prev,
    );
  }, []);

  return { user, loading, signInWithKakao, signInWithGoogle, signOut, refreshUser, devSignIn, forceCompleteOnboarding };
}
