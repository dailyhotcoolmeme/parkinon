// 구독(프리미엄) 상태 — 가족 그룹 단위.
// 구독은 개인이 아니라 patient_group 단위다(구성원 1명 결제 = 그룹 전체 승격).
// 어떤 유저의 실질 티어 = users.patient_group_id → patient_groups.subscription_tier.
// isPremium 은 앱 곳곳(업로드 게이팅·광고 렌더·일기 하단 문구)에서 참조하므로
// Context로 한 번만 조회해 공유한다(중복 쿼리 방지). RevenueCat webhook가 DB를 갱신하면
// refresh()/포커스 재조회로 반영된다.
import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { initRevenueCat } from '../lib/revenueCat';

export type SubscriptionTier = 'free' | 'premium';

interface SubscriptionState {
  tier: SubscriptionTier;
  isPremium: boolean;
  expiresAt: string | null;
  loading: boolean;
  /** 그룹 구독 상태 재조회 (결제 직후·화면 포커스 시 호출). */
  refresh: () => Promise<void>;
  /**
   * 결제 직후 전용 — premium 이 잡힐 때까지 재조회를 반복한다.
   * 구매 성공 시점엔 RevenueCat webhook 이 아직 patient_groups 를 안 바꿨을 수 있어,
   * 한 번만 조회하면 free 를 읽고 그대로 굳는다(오너 제보 2026-07-27: 구독했는데 free로 보임).
   * @returns premium 으로 확인되면 true, 시간 내 반영 안 되면 false
   */
  refreshUntilPremium: (timeoutMs?: number) => Promise<boolean>;
  /**
   * 구매/복원 직후 전용 — 서버에 "스토어 기준 내 권한"을 즉시 확정시킨다.
   * webhook 을 기다리지 않으므로 대기가 몇 초로 끝나고, webhook 이 아예 안 오는 경우
   * (이미 그 계정이 권한을 가진 상태에서의 복원 등)에도 반영된다.
   * @returns 프리미엄으로 확정되면 true
   */
  syncFromStore: () => Promise<boolean>;
}

const SubscriptionContext = createContext<SubscriptionState | undefined>(undefined);

/**
 * 갱신 유예(renewal grace).
 * 구독 갱신은 "이전 기간 만료 → 새 기간 시작"이 순차로 일어나 그 사이에 수십 초의 공백이 있다.
 * 그 순간을 그대로 free 로 보이면, 정상 결제 중인 사용자에게 결제창이 떴다가 사라진다
 * (오너 실측 2026-07-27: 체험 종료 직후 20초간 결제창 노출).
 * → 만료 직후 이 시간까지는 프리미엄으로 간주해 갱신 반영을 기다린다.
 * 실제 해지된 구독도 최대 이 시간만큼 프리미엄이 유지되지만, 결제 사고보다 훨씬 가벼운 대가다.
 */
const RENEWAL_GRACE_MS = 3 * 60 * 1000; // 3분 — 실측 갱신 공백 20초에 충분한 여유

/** subscription_tier='premium' 이고 만료 안 됨(만료 컬럼 null이거나 미래)일 때만 프리미엄. */
function resolveIsPremium(tier: string | null, expiresAt: string | null): boolean {
  if (tier !== 'premium') return false;
  if (!expiresAt) return true; // 만료일 미설정 = 무기한(webhook가 만료 시 tier를 free로 내림)
  return new Date(expiresAt).getTime() + RENEWAL_GRACE_MS > Date.now();
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, refreshUser, loading: authLoading } = useAuth();
  const groupId = user?.patient_group_id ?? null;

  // 구매자(Supabase user)와 RevenueCat 연결 — 재빌드 전엔 내부에서 조용히 no-op.
  useEffect(() => {
    initRevenueCat(user?.id ?? null);
  }, [user?.id]);

  const [tier, setTier] = useState<SubscriptionTier>('free');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 판단 보류 중에 현재 티어를 읽기 위한 참조(콜백 의존성에 tier 를 넣지 않기 위함).
  const tierRef = useRef<SubscriptionTier>('free');
  useEffect(() => {
    tierRef.current = tier;
  }, [tier]);

  /** 서버 1회 조회 + 상태 반영. premium 여부를 반환한다(폴링에서 판정에 사용). */
  const fetchOnce = useCallback(async (): Promise<boolean> => {
    // ⚠️ 인증 정보가 아직 로딩 중이면 아무 판단도 하지 않는다.
    //   로그인 직후엔 user 가 잠깐 null 이라 groupId 도 null 인데, 그걸 "구독 없음"으로
    //   확정하면 결제한 사용자에게 결제창이 번쩍 떴다가 사라진다
    //   (오너 실측 2026-07-27: 로그아웃→로그인 반복 시 프리미엄이 free 로 보임).
    if (authLoading) return tierRef.current === 'premium';
    if (!groupId) {
      setTier('free');
      setExpiresAt(null);
      return false;
    }
    try {
      const { data, error } = await supabase
        .from('patient_groups')
        .select('subscription_tier, subscription_expires_at')
        .eq('id', groupId)
        .maybeSingle();
      if (error) throw error;
      const rawTier = data?.subscription_tier ?? 'free';
      const exp = data?.subscription_expires_at ?? null;
      const premium = resolveIsPremium(rawTier, exp);
      setTier(premium ? 'premium' : 'free');
      setExpiresAt(exp);
      return premium;
    } catch (e) {
      // ⚠️ 조회 실패(네트워크 등)로 free 로 내리지 않는다. 일시적 오류 때문에 결제한
      //   사용자에게 결제창이 뜨는 것보다 직전 상태를 유지하는 편이 안전하다.
      //   실제 만료는 서버가 tier 를 내려야 반영된다.
      if (__DEV__) console.warn('[useSubscription] 조회 실패, 직전 상태 유지:', e);
      return tierRef.current === 'premium';
    }
  }, [groupId, authLoading]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await fetchOnce();
    } finally {
      setLoading(false);
    }
  }, [fetchOnce]);

  /**
   * 결제 직후: webhook(RevenueCat → patient_groups) 반영을 기다리며 재조회를 반복.
   * 구매 성공 시점엔 아직 free 로 읽히는 게 정상이라, 한 번만 조회하면 화면이 free 로 굳는다.
   */
  const refreshUntilPremium = useCallback(async (timeoutMs = 20000): Promise<boolean> => {
    setLoading(true);
    try {
      const deadline = Date.now() + timeoutMs;
      let delay = 1000;
      // 첫 조회는 즉시(이미 반영돼 있을 수 있음), 이후 점증 간격으로 재시도.
      if (await fetchOnce()) return true;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, delay));
        if (await fetchOnce()) return true;
        delay = Math.min(delay + 1000, 4000);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchOnce]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * 구매/복원 직후 서버에 즉시 확정 요청.
   * 웹훅을 기다리는 폴링과 달리 (1) 결과가 바로 오고 (2) 웹훅이 안 오는 경우도 해결된다.
   * ⚠️ 응답의 만료일을 그대로 쓰지 않고 상태에 반영하는 이유: 그룹이 새로 만들어진 경우
   *   user.patient_group_id 가 아직 옛 값(null)이라 재조회를 해도 free 로 읽힌다.
   *   → 응답으로 화면을 먼저 확정하고, refreshUser() 로 groupId 를 따라잡게 한다.
   */
  const syncFromStore = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-subscription', { body: {} });
      if (error) throw error;
      if (data?.premium) {
        setTier('premium');
        setExpiresAt(data.expiresAt ?? null);
        // 그룹이 새로 생겼을 수 있으니 사용자 정보를 따라잡는다(다른 화면의 그룹 기능용).
        await refreshUser().catch(() => {});
        return true;
      }
      // 스토어에 권한이 없다 → 서버 값 그대로 반영.
      return await fetchOnce();
    } catch (e) {
      if (__DEV__) console.warn('[useSubscription] sync 실패, 서버 값으로 대체:', e);
      // 동기화 실패(네트워크 등) 시엔 웹훅이 반영했을 수 있으니 짧게 재조회.
      return await fetchOnce();
    } finally {
      setLoading(false);
    }
  }, [fetchOnce, refreshUser]);

  // 앱이 백그라운드에서 돌아올 때 재조회 — 구독 상태는 서버(webhook)가 바꾸므로
  // 앱 안에서만 보고 있으면 영영 갱신되지 않는다(오너 제보 2026-07-27: 화면 이동해도 free 그대로).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void fetchOnce();
    });
    return () => sub.remove();
  }, [fetchOnce]);

  const value = useMemo<SubscriptionState>(
    () => ({
      tier,
      isPremium: tier === 'premium',
      expiresAt,
      loading,
      refresh,
      refreshUntilPremium,
      syncFromStore,
    }),
    [tier, expiresAt, loading, refresh, refreshUntilPremium, syncFromStore]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside <SubscriptionProvider>');
  return ctx;
}
