/**
 * useFamilyLink.ts
 * 가족 연동 관련 훅
 *
 * - generateInviteCode() - 6자리 숫자 코드 생성/갱신
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
import { ensureGroupMember } from '../utils/groupMembership';
import { invalidatePatientIdCache } from './usePatientId';
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

// 6자리 숫자 코드 생성 (숫자 전용). brute-force 방어는 서버측 만료 강제 + 시도 제한으로 처리.
function generateCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

// 직접 fetch 호출 타임아웃(ms). New Architecture 에서 네트워크 hang 시 화면이
// 먹통 되는 것을 막기 위한 가드. 로직/엔드포인트/순서는 그대로 두고 타임아웃만 추가.
const FAMILY_FETCH_TIMEOUT_MS = 8000;

// fetch + AbortController 타임아웃 래퍼. 타임아웃 시 명확한 에러를 throw 하여
// 호출처(try/catch)가 처리하도록 한다. 응답이 오면 원래 fetch 와 동일하게 동작.
async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs: number = FAMILY_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...(init ?? {}), signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`요청 시간이 초과됐어요. 잠시 후 다시 시도해주세요. (timeout ${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
        const res = await fetchWithTimeout(
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
      const insertRes = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/patient_groups`, {
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

      // patient_group_members에 본인 추가 (재시도 + 검증, 실패 시 throw)
      const baseHeaders = await buildHeaders();
      await ensureGroupMember(SUPABASE_URL, baseHeaders, newGroup.id, user.id, user.role ?? 'patient');

      // users 테이블의 patient_group_id 업데이트 (fetch PATCH)
      const userUpdateHeaders = await buildHeaders('return=minimal');
      const userUpdateRes = await fetchWithTimeout(
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
  // [제거됨] _doJoin: 클라가 "입력자 본인"을 강제 이동시키던 위험 분기.
  //   환자가 거꾸로 코드를 입력하면 환자가 기존 그룹을 떠나 보호자 연동이 끊겼다.
  //   → 방향-무관 안전 처리는 서버 SECURITY DEFINER RPC(join_family_by_code)로 일원화.
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // _callJoinRpc: 방향-무관 안전 합류/병합 RPC 호출 (SECURITY DEFINER)
  //   서버가 4-사실(입력자 role / 발급그룹 환자유무 / 내 그룹 환자유무 / 보호자 동반)을
  //   재검증하여 환자 이동·환자2명을 원천 차단한다. 클라는 결과 사유코드만 매핑.
  //   - code='need_confirm_switch' → needsConfirm: true (화면에서 확인 후 force 재호출)
  //   - 그 외 ok=false → 안내 메시지 그대로 노출
  //   ⚠️ New Architecture: supabase-js .rpc()도 fetch로 직접 호출(쓰기 hang 우회).
  // ─────────────────────────────────────────────────────────────────────────
  const _callJoinRpc = useCallback(async (
    code: string,
    force: boolean
  ): Promise<{ success: boolean; message: string; needsConfirm?: boolean }> => {
    if (!user) return { success: false, message: '로그인이 필요해요.' };

    setLoading(true);
    setError(null);

    try {
      const trimmedCode = code.trim();
      const headers = await buildHeaders();
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/join_family_by_code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_code: trimmedCode, p_force: force }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('[useFamilyLink] join_family_by_code HTTP 오류:', res.status, errText);
        return { success: false, message: '연동 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' };
      }

      // RPC는 jsonb 단일 반환 → { ok, code, message }
      const result: { ok?: boolean; code?: string; message?: string } = await res.json();
      const reason = result?.code ?? 'error';
      const message = result?.message ?? '연동 중 문제가 생겼어요.';

      if (result?.ok) {
        // 멤버십/그룹이 서버에서 바뀌었으므로 로컬 user 갱신 (patient_group_id 동기화)
        // + 그룹 환자 매핑 캐시 무효화(stale patientId 방지)
        invalidatePatientIdCache();
        await refreshUser();
        return { success: true, message };
      }

      if (reason === 'need_confirm_switch') {
        // 보호자가 다른 가족으로 갈아타기 → 화면에서 확인 후 force 재호출
        return { success: false, needsConfirm: true, message };
      }

      // two_patients / invalid_code / already_member / error 등 → 안내만
      return { success: false, message };
    } catch (err: any) {
      console.error('[useFamilyLink] join_family_by_code 오류:', err);
      const message = err.message ?? '연동 중 오류가 발생했어요.';
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, [user, refreshUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // joinByCode — 방향-무관 안전 합류 (신규 RPC 경유)
  //   기존 "환자 이동(_doJoin force)" 위험 분기를 서버 RPC로 대체.
  //   - 보호자→환자그룹: 합류 / 보호자→보호자선그룹: 합류
  //   - 환자→보호자선그룹(내 환자그룹 보유): 환자 이동 없이 보호자 끌어오기(서버 처리)
  //   - 환자2명/만료/중복: 서버 거부
  //   - 보호자 갈아타기: needsConfirm → 화면 확인 후 joinByCodeForce
  // ─────────────────────────────────────────────────────────────────────────
  const joinByCode = useCallback(async (
    code: string
  ): Promise<{ success: boolean; message: string; needsConfirm?: boolean }> => {
    return _callJoinRpc(code, false);
  }, [_callJoinRpc]);

  // ─────────────────────────────────────────────────────────────────────────
  // joinByCodeForce
  // 화면에서 "기존 연동 끊고 새로 연동" 확인 Alert → 예 선택 시 호출 (force=true)
  // ─────────────────────────────────────────────────────────────────────────
  const joinByCodeForce = useCallback(async (
    code: string
  ): Promise<{ success: boolean; message: string }> => {
    const { success, message } = await _callJoinRpc(code, true);
    return { success, message };
  }, [_callJoinRpc]);

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

      const res = await fetchWithTimeout(url, {
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
  // - 나 혼자만 그룹에서 나가기 (그룹 전체 해체가 아님)
  // - 내 patient_group_members 행만 삭제
  // - 내 users.patient_group_id = null 설정
  // - 남은 멤버가 0명이면 빈 그룹도 삭제
  // - 다른 멤버는 영향 없음
  // ─────────────────────────────────────────────────────────────────────────
  const leaveGroup = useCallback(async (): Promise<boolean> => {
    if (!user?.patient_group_id) return false;

    setLoading(true);
    setError(null);

    const groupId = user.patient_group_id;

    try {
      // 1) 내 patient_group_members 행만 삭제
      const delMemberHeaders = await buildHeaders('return=minimal');
      const delMemberRes = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/patient_group_members` +
          `?group_id=eq.${encodeURIComponent(groupId)}` +
          `&user_id=eq.${encodeURIComponent(user.id)}`,
        { method: 'DELETE', headers: delMemberHeaders }
      );
      if (!delMemberRes.ok) {
        const errText = await delMemberRes.text();
        throw new Error(`멤버십 삭제 실패 (HTTP ${delMemberRes.status}): ${errText}`);
      }

      // 2) 내 users.patient_group_id = null 설정
      const patchUserHeaders = await buildHeaders('return=minimal');
      const patchUserRes = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`,
        {
          method: 'PATCH',
          headers: patchUserHeaders,
          body: JSON.stringify({ patient_group_id: null }),
        }
      );
      if (!patchUserRes.ok) {
        const errText = await patchUserRes.text();
        throw new Error(`사용자 업데이트 실패 (HTTP ${patchUserRes.status}): ${errText}`);
      }

      // 3) 그룹에 남은 멤버 수 확인
      const { count } = await supabase
        .from('patient_group_members')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groupId);

      // 4) 남은 멤버가 0명이면 빈 그룹도 삭제
      if ((count ?? 0) === 0) {
        const delGroupHeaders = await buildHeaders('return=minimal');
        await fetchWithTimeout(
          `${SUPABASE_URL}/rest/v1/patient_groups?id=eq.${encodeURIComponent(groupId)}`,
          { method: 'DELETE', headers: delGroupHeaders }
        );
      }

      // 그룹 환자 매핑 캐시 무효화(탈퇴/해체로 stale 방지)
      invalidatePatientIdCache(groupId);
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
