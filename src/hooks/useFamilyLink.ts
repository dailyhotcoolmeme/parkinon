/**
 * useFamilyLink.ts
 * 가족 연동 관련 훅
 *
 * - generateInviteCode() - 6자리 코드 생성/갱신
 * - joinByCode(code) - 코드로 그룹 합류 (보호자가 사용)
 * - getGroupMembers() - 그룹 멤버 조회
 * - getPatientForCaregiver() - 보호자가 연동된 환자 정보 조회
 * - leaveGroup() - 그룹 탈퇴 (마지막 멤버면 그룹 자체 삭제)
 *
 * 핵심 원칙: 한 유저는 반드시 하나의 그룹에만 속한다.
 *
 * 스키마 기준:
 *   patient_groups.invite_code (char(6)) + invite_code_expires_at
 *   patient_group_members: group_id, user_id, role
 *   users.patient_group_id (denormalized 참조)
 *
 * ⚠️ New Architecture 주의:
 *   supabase-js의 쓰기 작업(.insert/.update/.delete)은 New Architecture에서 hang됨.
 *   모든 쓰기 작업은 fetch() API 직접 사용.
 *   읽기(SELECT)는 supabase-js 그대로 사용 가능.
 */
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Database } from '../types/database';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

type UserRow = Database['public']['Tables']['users']['Row'];
type GroupMemberRow = Database['public']['Tables']['patient_group_members']['Row'];

export interface GroupMember {
  user_id: string;
  role: 'patient' | 'caregiver';
  joined_at: string;
  user: Pick<UserRow, 'id' | 'name' | 'role' | 'caregiver_relation' | 'residence_type'> | null;
}

export interface UseFamilyLinkReturn {
  loading: boolean;
  error: string | null;
  generateInviteCode: () => Promise<string | null>;
  joinByCode: (code: string) => Promise<{ success: boolean; message: string; needsConfirm?: boolean }>;
  joinByCodeForce: (code: string) => Promise<{ success: boolean; message: string }>;
  getGroupMembers: () => Promise<GroupMember[]>;
  getPatientForCaregiver: () => Promise<UserRow | null>;
  leaveGroup: () => Promise<boolean>;
}

// 6자리 숫자 코드 생성
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// fetch API용 공통 헤더 생성
async function buildHeaders(prefer?: string): Promise<Record<string, string>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token ?? SUPABASE_ANON_KEY;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (prefer) headers['Prefer'] = prefer;
  return headers;
}

export function useFamilyLink(): UseFamilyLinkReturn {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // generateInviteCode
  // - 유저에게 이미 그룹이 있으면 → 기존 그룹의 코드만 갱신 (새 그룹 만들지 않음)
  // - 그룹이 없을 때만 → 새 그룹 생성
  // ─────────────────────────────────────────────────────────────────────────
  const generateInviteCode = useCallback(async (): Promise<string | null> => {
    if (!user) return null;

    setLoading(true);
    setError(null);

    try {
      const code = generateCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // DB에서 최신 patient_group_id를 직접 재조회 (로컬 캐시 race condition 방지)
      const { data: freshUser } = await supabase
        .from('users')
        .select('patient_group_id')
        .eq('id', user.id)
        .single();

      const currentGroupId = freshUser?.patient_group_id ?? user.patient_group_id;

      if (currentGroupId) {
        // ── 기존 그룹이 있는 경우: 코드만 갱신, 새 그룹 생성 안 함 ──
        const headers = await buildHeaders('return=minimal');
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/patient_groups?id=eq.${encodeURIComponent(currentGroupId)}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              invite_code: code,
              invite_code_expires_at: expiresAt,
            }),
          }
        );
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`초대 코드 갱신 실패 (HTTP ${res.status}): ${errText}`);
        }
        return code;
      }

      // ── 그룹이 없는 경우: 새 그룹 생성 ──
      const insertHeaders = await buildHeaders('return=representation');
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_groups`, {
        method: 'POST',
        headers: insertHeaders,
        body: JSON.stringify({
          invite_code: code,
          invite_code_expires_at: expiresAt,
        }),
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text();
        throw new Error(`그룹 생성 실패 (HTTP ${insertRes.status}): ${errText}`);
      }
      const insertedGroups: any[] = await insertRes.json();
      const newGroup = insertedGroups?.[0];
      if (!newGroup?.id) throw new Error('그룹 생성에 실패했어요.');

      // patient_group_members에 본인 추가 (fetch POST)
      const memberHeaders = await buildHeaders('return=minimal');
      const memberRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_group_members`, {
        method: 'POST',
        headers: memberHeaders,
        body: JSON.stringify({
          group_id: newGroup.id,
          user_id: user.id,
          role: user.role ?? 'patient',
        }),
      });
      if (!memberRes.ok) {
        const errText = await memberRes.text();
        throw new Error(`멤버 추가 실패 (HTTP ${memberRes.status}): ${errText}`);
      }

      // users 테이블의 patient_group_id 업데이트 (fetch PATCH)
      const userUpdateHeaders = await buildHeaders('return=minimal');
      const userUpdateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`,
        {
          method: 'PATCH',
          headers: userUpdateHeaders,
          body: JSON.stringify({ patient_group_id: newGroup.id }),
        }
      );
      if (!userUpdateRes.ok) {
        const errText = await userUpdateRes.text();
        throw new Error(`사용자 업데이트 실패 (HTTP ${userUpdateRes.status}): ${errText}`);
      }

      await refreshUser();

      return code;
    } catch (err: any) {
      console.error('[useFamilyLink] generateInviteCode 오류:', err);
      setError(err.message ?? '초대 코드 생성에 실패했어요.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [user, refreshUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // _doJoin: 실제 그룹 합류 처리 (기존 그룹 정리 → 새 그룹 멤버 추가 → users 업데이트)
  // skipOldGroupId: 이미 삭제 처리된 그룹 ID (재삭제 방지)
  // ─────────────────────────────────────────────────────────────────────────
  const _doJoin = useCallback(async (
    targetGroupId: string,
    oldGroupId: string | null | undefined,
    deleteOldGroup: boolean
  ): Promise<{ success: boolean; message: string }> => {
    if (!user) return { success: false, message: '로그인이 필요해요.' };

    // 1) 기존 멤버십 삭제
    if (oldGroupId && oldGroupId !== targetGroupId) {
      const deleteHeaders = await buildHeaders('return=minimal');
      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/patient_group_members` +
          `?group_id=eq.${encodeURIComponent(oldGroupId)}` +
          `&user_id=eq.${encodeURIComponent(user.id)}`,
        { method: 'DELETE', headers: deleteHeaders }
      );
      if (!delRes.ok) {
        const errText = await delRes.text();
        throw new Error(`기존 멤버십 삭제 실패 (HTTP ${delRes.status}): ${errText}`);
      }

      // 2) 기존 그룹이 이제 빈 그룹이면 그룹 자체도 삭제
      if (deleteOldGroup) {
        const { count } = await supabase
          .from('patient_group_members')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', oldGroupId);

        if ((count ?? 0) === 0) {
          const groupDeleteHeaders = await buildHeaders('return=minimal');
          await fetch(
            `${SUPABASE_URL}/rest/v1/patient_groups?id=eq.${encodeURIComponent(oldGroupId)}`,
            { method: 'DELETE', headers: groupDeleteHeaders }
          );
        }
      }
    }

    // 3) 새 그룹에 멤버 추가
    const memberHeaders = await buildHeaders('return=minimal');
    const memberRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_group_members`, {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        group_id: targetGroupId,
        user_id: user.id,
        role: user.role ?? 'caregiver',
      }),
    });
    if (!memberRes.ok) {
      const errText = await memberRes.text();
      throw new Error(`멤버 추가 실패 (HTTP ${memberRes.status}): ${errText}`);
    }

    // 4) users 테이블의 patient_group_id 업데이트
    const userUpdateHeaders = await buildHeaders('return=minimal');
    const userUpdateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'PATCH',
        headers: userUpdateHeaders,
        body: JSON.stringify({ patient_group_id: targetGroupId }),
      }
    );
    if (!userUpdateRes.ok) {
      const errText = await userUpdateRes.text();
      throw new Error(`사용자 업데이트 실패 (HTTP ${userUpdateRes.status}): ${errText}`);
    }

    await refreshUser();
    return { success: true, message: '가족 연동이 완료됐어요.' };
  }, [user, refreshUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // joinByCode
  // - 기존 그룹 없음 → 바로 합류
  // - 기존 그룹 있고 솔로(혼자만) → 기존 그룹 및 멤버십 삭제 후 합류
  // - 기존 그룹 있고 다른 멤버도 있음 → needsConfirm: true 반환 (화면에서 Alert 처리)
  // ─────────────────────────────────────────────────────────────────────────
  const joinByCode = useCallback(async (
    code: string
  ): Promise<{ success: boolean; message: string; needsConfirm?: boolean }> => {
    if (!user) return { success: false, message: '로그인이 필요해요.' };

    setLoading(true);
    setError(null);

    try {
      const trimmedCode = code.trim();

      // 유효한 초대 코드 조회 (만료 전) — SELECT는 supabase-js 그대로 사용
      const { data: group, error: groupError } = await supabase
        .from('patient_groups')
        .select('id, invite_code_expires_at')
        .eq('invite_code', trimmedCode)
        .gt('invite_code_expires_at', new Date().toISOString())
        .single();

      if (groupError || !group) {
        return {
          success: false,
          message: '유효하지 않은 코드예요. 다시 확인해주세요.',
        };
      }

      // 이미 같은 그룹에 있는지 확인
      const { data: existingMember } = await supabase
        .from('patient_group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', user.id)
        .single();

      if (existingMember) {
        return { success: false, message: '이미 연동된 가족이에요.' };
      }

      // DB에서 최신 patient_group_id 재조회 (race condition 방지)
      const { data: freshUser } = await supabase
        .from('users')
        .select('patient_group_id')
        .eq('id', user.id)
        .single();

      const currentGroupId = freshUser?.patient_group_id ?? user.patient_group_id;

      if (currentGroupId && currentGroupId !== group.id) {
        // 기존 그룹의 멤버 수 확인
        const { count: memberCount } = await supabase
          .from('patient_group_members')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', currentGroupId);

        if ((memberCount ?? 0) > 1) {
          // ── 다른 멤버도 있는 경우 → 화면에서 확인 Alert 처리 필요 ──
          return {
            success: false,
            needsConfirm: true,
            message: '기존 가족 연결을 끊고 새로 연동하시겠습니까?',
          };
        }

        // ── 솔로 그룹인 경우 → 기존 그룹과 멤버십 삭제 후 새 그룹 합류 ──
        return await _doJoin(group.id, currentGroupId, true);
      }

      // ── 기존 그룹 없음 → 바로 합류 ──
      return await _doJoin(group.id, null, false);
    } catch (err: any) {
      console.error('[useFamilyLink] joinByCode 오류:', err);
      const message = err.message ?? '연동 중 오류가 발생했어요.';
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, [user, refreshUser, _doJoin]);

  // ─────────────────────────────────────────────────────────────────────────
  // joinByCodeForce
  // 화면에서 "기존 연동 끊고 새로 연동" 확인 Alert → 예 선택 시 호출
  // needsConfirm 상황에서 강제로 합류 처리
  // ─────────────────────────────────────────────────────────────────────────
  const joinByCodeForce = useCallback(async (
    code: string
  ): Promise<{ success: boolean; message: string }> => {
    if (!user) return { success: false, message: '로그인이 필요해요.' };

    setLoading(true);
    setError(null);

    try {
      const trimmedCode = code.trim();

      const { data: group, error: groupError } = await supabase
        .from('patient_groups')
        .select('id, invite_code_expires_at')
        .eq('invite_code', trimmedCode)
        .gt('invite_code_expires_at', new Date().toISOString())
        .single();

      if (groupError || !group) {
        return {
          success: false,
          message: '유효하지 않은 코드예요. 다시 확인해주세요.',
        };
      }

      const { data: freshUser } = await supabase
        .from('users')
        .select('patient_group_id')
        .eq('id', user.id)
        .single();

      const currentGroupId = freshUser?.patient_group_id ?? user.patient_group_id;

      // 기존 그룹과 멤버십 삭제 후 새 그룹 합류 (그룹은 빈 경우만 삭제)
      return await _doJoin(group.id, currentGroupId, true);
    } catch (err: any) {
      console.error('[useFamilyLink] joinByCodeForce 오류:', err);
      const message = err.message ?? '연동 중 오류가 발생했어요.';
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, [user, refreshUser, _doJoin]);

  // ─────────────────────────────────────────────────────────────────────────
  // getGroupMembers — SELECT이므로 supabase-js 사용 가능하나 fetch API 직접 사용
  // user 클로저 대신 DB에서 최신 patient_group_id를 직접 조회하여 refreshUser()
  // 직후 호출해도 정확한 데이터를 반환함 (가족 연동 성공 후 화면 갱신 버그 수정)
  // ─────────────────────────────────────────────────────────────────────────
  const getGroupMembers = useCallback(async (): Promise<GroupMember[]> => {
    if (!user?.id) return [];

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? SUPABASE_ANON_KEY;

      // DB에서 최신 patient_group_id를 직접 조회 (클로저 캐시 무효화)
      const { data: freshUser } = await supabase
        .from('users')
        .select('patient_group_id')
        .eq('id', user.id)
        .single();

      const groupId = freshUser?.patient_group_id ?? user.patient_group_id;
      if (!groupId) return [];

      const url =
        `${SUPABASE_URL}/rest/v1/patient_group_members` +
        `?group_id=eq.${encodeURIComponent(groupId)}` +
        `&user_id=neq.${encodeURIComponent(user.id)}` +
        `&select=user_id,role,joined_at,user:users(id,name,role,caregiver_relation,residence_type)`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`getGroupMembers HTTP ${res.status}: ${errText}`);
      }

      const data: any[] = await res.json();

      return (data ?? [])
        .filter((item: any) => item.user_id !== user.id)
        .map((item: any) => ({
          user_id: item.user_id,
          role: item.role,
          joined_at: item.joined_at,
          // Supabase REST API join 결과가 배열로 올 수 있으므로 배열이면 첫 번째 요소 사용
          user: Array.isArray(item.user) ? (item.user[0] ?? null) : (item.user ?? null),
        }));
    } catch (err: any) {
      console.error('[useFamilyLink] getGroupMembers 오류:', err);
      return [];
    }
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────
  // getPatientForCaregiver — SELECT이므로 supabase-js 그대로 사용
  // ─────────────────────────────────────────────────────────────────────────
  const getPatientForCaregiver = useCallback(async (): Promise<UserRow | null> => {
    if (!user || user.role !== 'caregiver' || !user.patient_group_id) return null;

    try {
      const { data, error: queryError } = await supabase
        .from('patient_group_members')
        .select('user_id')
        .eq('group_id', user.patient_group_id)
        .eq('role', 'patient')
        .single();

      if (queryError || !data) return null;

      const { data: patient, error: patientError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user_id)
        .single();

      if (patientError) throw patientError;
      return patient ?? null;
    } catch (err: any) {
      console.error('[useFamilyLink] getPatientForCaregiver 오류:', err);
      return null;
    }
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────
  // leaveGroup
  // - disconnect_family_group RPC를 호출하여 그룹 전체 삭제
  //   (그룹 내 모든 멤버의 patient_group_id를 null로 초기화 + 그룹 삭제)
  // - 상대방(파트너)의 연동도 함께 해제됨
  // ─────────────────────────────────────────────────────────────────────────
  const leaveGroup = useCallback(async (): Promise<boolean> => {
    if (!user?.patient_group_id) return false;

    setLoading(true);
    setError(null);

    const groupId = user.patient_group_id;

    try {
      // disconnect_family_group RPC 호출
      // - 내부에서 그룹 멤버 전체의 patient_group_id를 null로 초기화
      // - patient_groups 삭제 (CASCADE로 patient_group_members도 삭제)
      // - SECURITY DEFINER 함수이므로 RLS 우회하여 상대방 레코드도 처리 가능
      const rpcHeaders = await buildHeaders('return=minimal');
      const rpcRes = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/disconnect_family_group`,
        {
          method: 'POST',
          headers: rpcHeaders,
          body: JSON.stringify({ p_group_id: groupId }),
        }
      );
      if (!rpcRes.ok) {
        const errText = await rpcRes.text();
        throw new Error(`가족 연결 해제 실패 (HTTP ${rpcRes.status}): ${errText}`);
      }

      await refreshUser();
      return true;
    } catch (err: any) {
      console.error('[useFamilyLink] leaveGroup 오류:', err);
      setError(err.message ?? '가족 연결 해제에 실패했어요.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, refreshUser]);

  return {
    loading,
    error,
    generateInviteCode,
    joinByCode,
    joinByCodeForce,
    getGroupMembers,
    getPatientForCaregiver,
    leaveGroup,
  };
}
