/**
 * banGuard.ts
 * 커뮤니티 이용이 제한된(밴된) 사용자 식별 + 공용 안내 헬퍼.
 *
 * 배경:
 * - 관리자가 users.banned = true 로 지정한 계정은 글/댓글 작성이 막힌다.
 * - DB RLS WITH CHECK 가 INSERT 를 거부(에러코드 42501)하므로 서버에서 최종 차단되지만,
 *   사용자에게는 날것의 RLS 오류 대신 통일된 안내문을 보여준다.
 * - 선제 차단(작성 진입/등록 직전)과 에러 폴백(42501 감지) 양쪽에서 같은 안내를 사용한다.
 *
 * 차단(user_blocks)과는 별개의 기능이다. 혼동하지 말 것.
 *
 * 사용 예:
 *   if (ensureNotBanned(user, dialog)) return;          // 선제 차단
 *   ... catch (e) { if (isBanRlsError(e)) { showBannedDialog(dialog); return; } }
 */
import type { DialogApi } from '../context/DialogContext';
import i18n from '../i18n';

/** 사용자의 banned 플래그가 true 인지 판정 */
export function isBannedUser(
  user: { banned?: boolean | null } | null | undefined,
): boolean {
  return !!user && user.banned === true;
}

/** 커뮤니티 이용 제한 안내 다이얼로그 표시 */
export function showBannedDialog(dialog: DialogApi): void {
  dialog.alert({ title: i18n.t('banGuard.title'), message: i18n.t('banGuard.message') });
}

/**
 * 밴된 사용자면 안내 후 true 반환 (호출처는 즉시 return).
 * 밴이 아니면 false 반환 (정상 진행).
 *
 * @example
 *   if (ensureNotBanned(user, dialog)) return;
 */
export function ensureNotBanned(
  user: { banned?: boolean | null } | null | undefined,
  dialog: DialogApi,
): boolean {
  if (!isBannedUser(user)) return false;
  showBannedDialog(dialog);
  return true;
}

/**
 * Supabase/PostgREST 에러가 RLS WITH CHECK 거부(밴 추정)인지 판정.
 * - PostgrestError.code === '42501' (insufficient_privilege)
 * - 또는 메시지에 'row-level security' / 'violates row-level security policy' 포함
 */
export function isBanRlsError(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: string })?.code;
  if (code === '42501') return true;
  const msg =
    (error as { message?: string })?.message ?? String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes('42501') ||
    lower.includes('row-level security') ||
    lower.includes('violates row level security')
  );
}
