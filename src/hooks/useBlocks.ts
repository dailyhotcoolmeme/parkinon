import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * 차단한 사용자 목록 훅 (Apple App Store Guideline 1.2 UGC 대응).
 *
 * 내가 차단한 사용자(blocked_id) 집합을 불러와, 피드/댓글에서 해당 사용자의
 * 글·댓글을 클라이언트 측에서 걸러내는 데 사용한다. (OTA 안전)
 *
 * - blockedIds: 차단한 사용자 id Set
 * - blockUser(userId): 차단 추가 후 즉시 set 갱신
 * - unblockUser(userId): 차단 해제 후 즉시 set 갱신
 * - refresh(): 서버에서 다시 로드
 */
export function useBlocks() {
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setBlockedIds(new Set());
      setLoaded(true);
      return;
    }
    const { data } = await supabase
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocker_id', session.user.id);
    setBlockedIds(new Set((data ?? []).map((b: any) => b.blocked_id)));
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** 사용자 차단. 성공 시 true, 실패 시 false */
  const blockUser = useCallback(async (blockedId: string): Promise<boolean> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return false;
    if (session.user.id === blockedId) return false;
    const { error } = await supabase
      .from('user_blocks')
      .upsert(
        { blocker_id: session.user.id, blocked_id: blockedId },
        { onConflict: 'blocker_id,blocked_id' },
      );
    if (error) return false;
    setBlockedIds(prev => {
      const next = new Set(prev);
      next.add(blockedId);
      return next;
    });
    return true;
  }, []);

  /** 사용자 차단 해제. 성공 시 true, 실패 시 false */
  const unblockUser = useCallback(async (blockedId: string): Promise<boolean> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return false;
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', session.user.id)
      .eq('blocked_id', blockedId);
    if (error) return false;
    setBlockedIds(prev => {
      const next = new Set(prev);
      next.delete(blockedId);
      return next;
    });
    return true;
  }, []);

  return { blockedIds, blockUser, unblockUser, refresh, loaded };
}
