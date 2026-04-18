/**
 * useFamilyLink.ts
 * 가족 연동 관련 훅
 *
 * - generateInviteCode() - 6자리 코드 생성, patient_groups 테이블에 저장
 * - joinByCode(code) - 코드로 그룹 합류 (보호자가 사용)
 * - getGroupMembers() - 그룹 멤버 조회
 * - getPatientForCaregiver() - 보호자가 연동된 환자 정보 조회
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
  joinByCode: (code: string) => Promise<{ success: boolean; message: string }>;
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

  // 초대 코드 생성 (환자가 생성)
  const generateInviteCode = useCallback(async (): Promise<string | null> => {
    if (!user) return null;

    setLoading(true);
    setError(null);

    try {
      const code = generateCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // 기존 그룹이 있는지 확인
      if (user.patient_group_id) {
        // 기존 그룹의 초대 코드 갱신 (fetch PATCH)
        const headers = await buildHeaders('return=minimal');
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/patient_groups?id=eq.${encodeURIComponent(user.patient_group_id)}`,
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

      // 새 그룹 생성 (fetch POST)
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

      // 로컬 user 상태 갱신
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

  // 코드로 그룹 합류 (보호자가 사용)
  const joinByCode = useCallback(async (
    code: string
  ): Promise<{ success: boolean; message: string }> => {
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

      // 이미 같은 그룹에 있는지 확인 — SELECT는 supabase-js 그대로 사용
      const { data: existingMember } = await supabase
        .from('patient_group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', user.id)
        .single();

      if (existingMember) {
        return { success: false, message: '이미 연동된 가족이에요.' };
      }

      // 기존 그룹에서 본인 멤버십 삭제 (fetch DELETE)
      if (user.patient_group_id && user.patient_group_id !== group.id) {
        const deleteHeaders = await buildHeaders('return=minimal');
        await fetch(
          `${SUPABASE_URL}/rest/v1/patient_group_members` +
            `?group_id=eq.${encodeURIComponent(user.patient_group_id)}` +
            `&user_id=eq.${encodeURIComponent(user.id)}`,
          {
            method: 'DELETE',
            headers: deleteHeaders,
          }
        );
      }

      // 그룹 멤버 추가 (fetch POST)
      const memberHeaders = await buildHeaders('return=minimal');
      const memberRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_group_members`, {
        method: 'POST',
        headers: memberHeaders,
        body: JSON.stringify({
          group_id: group.id,
          user_id: user.id,
          role: user.role ?? 'caregiver',
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
          body: JSON.stringify({ patient_group_id: group.id }),
        }
      );
      if (!userUpdateRes.ok) {
        const errText = await userUpdateRes.text();
        throw new Error(`사용자 업데이트 실패 (HTTP ${userUpdateRes.status}): ${errText}`);
      }

      // 로컬 user 상태 갱신
      await refreshUser();

      return { success: true, message: '가족 연동이 완료됐어요.' };
    } catch (err: any) {
      console.error('[useFamilyLink] joinByCode 오류:', err);
      const message = err.message ?? '연동 중 오류가 발생했어요.';
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, [user, refreshUser]);

  // 그룹 멤버 조회 (fetch API 직접 사용 - New Architecture supabase-js hang 방지)
  const getGroupMembers = useCallback(async (): Promise<GroupMember[]> => {
    if (!user?.patient_group_id) return [];

    try {
      // supabase.auth.getSession()으로 액세스 토큰 획득
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? SUPABASE_ANON_KEY;

      // 본인 제외 필터 포함: group_id=eq.{groupId}&user_id=neq.{userId}
      const url =
        `${SUPABASE_URL}/rest/v1/patient_group_members` +
        `?select=user_id,role,joined_at,user:users(id,name,role,caregiver_relation,residence_type)` +
        `&group_id=eq.${encodeURIComponent(user.patient_group_id)}` +
        `&user_id=neq.${encodeURIComponent(user.id)}`;

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

      // 클라이언트 측 이중 방어: 혹시 본인이 포함된 경우 제거
      return (data ?? [])
        .filter((item: any) => item.user_id !== user.id)
        .map((item: any) => ({
          user_id: item.user_id,
          role: item.role,
          joined_at: item.joined_at,
          user: item.user ?? null,
        }));
    } catch (err: any) {
      console.error('[useFamilyLink] getGroupMembers 오류:', err);
      return [];
    }
  }, [user]);

  // 보호자가 연동된 환자 정보 조회 — SELECT이므로 supabase-js 그대로 사용
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

  // 그룹 탈퇴
  const leaveGroup = useCallback(async (): Promise<boolean> => {
    if (!user?.patient_group_id) return false;

    setLoading(true);
    setError(null);

    try {
      // patient_group_members에서 제거 (fetch DELETE)
      const deleteHeaders = await buildHeaders('return=minimal');
      const deleteRes = await fetch(
        `${SUPABASE_URL}/rest/v1/patient_group_members` +
          `?group_id=eq.${encodeURIComponent(user.patient_group_id)}` +
          `&user_id=eq.${encodeURIComponent(user.id)}`,
        {
          method: 'DELETE',
          headers: deleteHeaders,
        }
      );
      if (!deleteRes.ok) {
        const errText = await deleteRes.text();
        throw new Error(`멤버 삭제 실패 (HTTP ${deleteRes.status}): ${errText}`);
      }

      // users 테이블의 patient_group_id 초기화 (fetch PATCH)
      const userUpdateHeaders = await buildHeaders('return=minimal');
      const userUpdateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`,
        {
          method: 'PATCH',
          headers: userUpdateHeaders,
          body: JSON.stringify({ patient_group_id: null }),
        }
      );
      if (!userUpdateRes.ok) {
        const errText = await userUpdateRes.text();
        throw new Error(`사용자 업데이트 실패 (HTTP ${userUpdateRes.status}): ${errText}`);
      }

      await refreshUser();
      return true;
    } catch (err: any) {
      console.error('[useFamilyLink] leaveGroup 오류:', err);
      setError(err.message ?? '그룹 탈퇴에 실패했어요.');
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
    getGroupMembers,
    getPatientForCaregiver,
    leaveGroup,
  };
}
