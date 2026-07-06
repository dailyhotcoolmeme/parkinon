/**
 * groupMembership.ts
 *
 * 가족 그룹 멤버십(patient_group_members) 행 보장 유틸.
 *
 * ⚠️ 왜 이 파일이 필요한가 (치명적 버그 방지):
 *   RLS 함수 is_same_patient_group()은 patient_group_members 테이블을 기준으로
 *   같은 그룹 여부를 판정한다. 합류자가 patient_group_members에 행이 없으면
 *   이 함수가 항상 false → 같은 그룹 가족의 users.name 등 모든 정보가 RLS로 차단되어
 *   "이름없음", placeholder 정보가 노출된다.
 *
 *   기존 온보딩 합류 경로들은 멤버 INSERT 실패를 console.warn으로 조용히 삼키고
 *   진행했기 때문에, INSERT가 일시적으로 실패하면 users.patient_group_id만 갱신되고
 *   멤버 행은 누락된 채 온보딩이 완료되는 버그가 있었다.
 *
 *   이 유틸은 멤버 INSERT를 (1) 재시도하고 (2) 최종 성공 여부를 검증하며
 *   (3) 끝내 실패하면 throw하여 호출부에서 표면화/로깅하도록 강제한다.
 *
 * 스키마: patient_group_members(group_id uuid, user_id uuid, role text 'patient'|'caregiver')
 *         UNIQUE(group_id, user_id) 제약 존재 → resolution=merge-duplicates upsert 안전.
 * RLS: INSERT 정책 with_check = (auth.uid() IS NOT NULL) → 본인 행 삽입 차단되지 않음.
 */

import i18n from '../i18n';

type HeaderMap = Record<string, string>;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * patient_group_members 에 (group_id, user_id, role) 행이 반드시 존재하도록 보장한다.
 * - 이미 존재하면(merge-duplicates) 정상 통과.
 * - INSERT 실패 시 재시도.
 * - 모든 재시도 실패 시 Error throw (호출부에서 처리/표면화).
 *
 * @param supabaseUrl  EXPO_PUBLIC_SUPABASE_URL
 * @param baseHeaders  apikey/Authorization 등 포함된 기본 헤더 (Prefer 미포함)
 * @param groupId      합류 대상 그룹 id
 * @param userId       본인 user id
 * @param role         'patient' | 'caregiver'
 */
export async function ensureGroupMember(
  supabaseUrl: string,
  baseHeaders: HeaderMap,
  groupId: string,
  userId: string,
  role: string
): Promise<void> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/patient_group_members`, {
        method: 'POST',
        headers: { ...baseHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ group_id: groupId, user_id: userId, role: role || 'caregiver' }),
      });

      if (res.ok) {
        // INSERT 응답이 OK여도 안전하게 실제 행 존재를 한 번 검증한다.
        const verified = await verifyGroupMember(supabaseUrl, baseHeaders, groupId, userId);
        if (verified) return;
        lastError = i18n.t('groupMembership.verifyFailError');
      } else {
        lastError = `HTTP ${res.status}: ${await res.text()}`;
      }
    } catch (e: any) {
      lastError = e?.message ?? String(e);
    }

    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS * attempt);
    }
  }

  // 마지막 시도로 이미 행이 존재하는지 한 번 더 확인 (네트워크 타임아웃 후 실제 반영된 경우 구제)
  const finalCheck = await verifyGroupMember(supabaseUrl, baseHeaders, groupId, userId).catch(() => false);
  if (finalCheck) return;

  throw new Error(i18n.t('groupMembership.registerFailError', { group: groupId, err: lastError }));
}

/**
 * 해당 (group_id, user_id) 멤버 행이 실제 존재하는지 확인.
 * RLS SELECT 정책상 본인 그룹 행만 읽히지만, INSERT 직후 본인 그룹이므로 조회 가능.
 */
async function verifyGroupMember(
  supabaseUrl: string,
  baseHeaders: HeaderMap,
  groupId: string,
  userId: string
): Promise<boolean> {
  try {
    const url =
      `${supabaseUrl}/rest/v1/patient_group_members` +
      `?group_id=eq.${encodeURIComponent(groupId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&select=user_id`;
    const res = await fetch(url, { method: 'GET', headers: baseHeaders });
    if (!res.ok) return false;
    const rows: any[] = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
