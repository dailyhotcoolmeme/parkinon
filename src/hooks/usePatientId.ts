import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// ─── 모듈 레벨 캐시 (patient_group_id → patientId) ────────────────────────────
// refreshUser() 등으로 user 객체 참조만 바뀌고 patient_group_id 는 그대로일 때
// 매번 patient_group_members.single() 을 재조회하던 중복 쿼리를 제거한다.
// useDoseSlots 의 slotsCache + invalidate 패턴과 동일하게,
// 그룹 변경/탈퇴 시 반드시 무효화하여 stale patientId 를 방지한다.
//  - 그룹 변경: patient_group_id(=캐시 키) 자체가 바뀌므로 자연히 새 키로 조회.
//  - 탈퇴: patient_group_id 가 null → 조회 자체를 안 함(patientId=null).
//  - 그룹 내 환자 멤버십 변경(가족 연동/해제): useFamilyLink 가 invalidate 호출.
const patientIdCache = new Map<string, string | null>();

/** 가족 연동/해제 등 그룹 멤버십 변경 시 stale 방지용 무효화. */
export function invalidatePatientIdCache(groupId?: string): void {
  if (groupId) patientIdCache.delete(groupId);
  else patientIdCache.clear();
}

// 환자 ID 반환 훅 — 환자면 본인, 보호자면 그룹에서 환자 조회
export function usePatientId(): { patientId: string | null; loading: boolean } {
  const { user } = useAuth();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setPatientId(null); setLoading(false); return; }
    if (user.role === 'patient') { setPatientId(user.id); setLoading(false); return; }

    const groupId = user.patient_group_id;
    if (!groupId) { setPatientId(null); setLoading(false); return; }

    // 캐시 히트 → 재조회 없이 즉시 반영
    if (patientIdCache.has(groupId)) {
      setPatientId(patientIdCache.get(groupId)!);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    // ⚠️ 예외를 잡지 않으면 요청이 거부될 때 loading 이 true 로 영원히 남아 화면이 멈춘다.
    //   이 경로는 보호자만 지나간다(환자는 위에서 즉시 반환) — 보호자 전용 멈춤의 원인이었다.
    //   supabase 쿼리는 완전한 Promise 가 아니라 thenable 이라 .catch 를 못 쓴다 → try/catch.
    (async () => {
      try {
        const { data, error } = await supabase
          .from('patient_group_members')
          .select('user_id')
          .eq('group_id', groupId)
          .eq('role', 'patient')
          .single();
        const resolved = data?.user_id ?? null;
        // 조회가 성공했을 때만 캐시한다.
        //   실패(네트워크 등)까지 캐시하면 그 뒤로는 재조회 자체를 안 해서,
        //   한 번 끊긴 보호자는 앱을 껐다 켤 때까지 환자를 못 찾는다.
        if (!error) patientIdCache.set(groupId, resolved);
        if (cancelled) return;
        setPatientId(resolved);
      } catch (e) {
        console.error('[usePatientId] 환자 조회 실패:', e);
        if (cancelled) return;
        setPatientId(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return { patientId, loading };
}
