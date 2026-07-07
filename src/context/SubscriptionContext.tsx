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
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export type SubscriptionTier = 'free' | 'premium';

interface SubscriptionState {
  tier: SubscriptionTier;
  isPremium: boolean;
  expiresAt: string | null;
  loading: boolean;
  /** 그룹 구독 상태 재조회 (결제 직후·화면 포커스 시 호출). */
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState | undefined>(undefined);

/** subscription_tier='premium' 이고 만료 안 됨(만료 컬럼 null이거나 미래)일 때만 프리미엄. */
function resolveIsPremium(tier: string | null, expiresAt: string | null): boolean {
  if (tier !== 'premium') return false;
  if (!expiresAt) return true; // 만료일 미설정 = 무기한(webhook가 만료 시 tier를 free로 내림)
  return new Date(expiresAt).getTime() > Date.now();
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const groupId = user?.patient_group_id ?? null;

  const [tier, setTier] = useState<SubscriptionTier>('free');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setTier('free');
      setExpiresAt(null);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('patient_groups')
        .select('subscription_tier, subscription_expires_at')
        .eq('id', groupId)
        .maybeSingle();
      if (error) throw error;
      const rawTier = data?.subscription_tier ?? 'free';
      const exp = data?.subscription_expires_at ?? null;
      setTier(resolveIsPremium(rawTier, exp) ? 'premium' : 'free');
      setExpiresAt(exp);
    } catch (e) {
      if (__DEV__) console.warn('[useSubscription] 조회 실패, free로 처리:', e);
      setTier('free');
      setExpiresAt(null);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<SubscriptionState>(
    () => ({
      tier,
      isPremium: tier === 'premium',
      expiresAt,
      loading,
      refresh,
    }),
    [tier, expiresAt, loading, refresh]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside <SubscriptionProvider>');
  return ctx;
}
