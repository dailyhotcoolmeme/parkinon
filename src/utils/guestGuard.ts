/**
 * guestGuard.ts
 * 비로그인(테스트로 둘러보기) 상태 식별 + 공용 안내 헬퍼.
 *
 * 배경:
 * - LoginScreen의 "테스트로 둘러보기" 버튼은 useAuth.devSignIn으로 mock UserProfile을 주입함.
 * - mock user id는 GUEST_USER_ID 상수와 동일하므로, 이 id로 게스트 여부를 판정함.
 * - 게스트가 약 복용·몸상태·운동·게시글·측정·가족연동 등 서버 기록 액션을 시도하면
 *   Supabase에서 RLS/FK 오류가 발생하므로, 진입 시점에 통일된 안내문으로 차단한다.
 *
 * 사용 예:
 *   const blocked = await ensureNotGuest(user, dialog);
 *   if (blocked) return;
 */
import type { DialogApi } from '../context/DialogContext';
import type { UserProfile } from '../types/database';
import { navigateTo } from '../navigation/navigationRef';

/** useAuth.devSignIn이 주입하는 mock 사용자 id (useAuth.ts와 동기화 필요) */
export const GUEST_USER_ID = '00000000-0000-0000-0000-000000000001';

/** 사용자가 "테스트로 둘러보기"로 진입한 게스트인지 판정 */
export function isGuestUser(user: { id?: string | null } | null | undefined): boolean {
  return !!user && user.id === GUEST_USER_ID;
}

/**
 * 공용 안내문 — 게스트가 가입 후에만 가능한 기능을 시도했을 때.
 * 사용자가 "회원가입하기"를 누르면 가능한 경우 LoginScreen으로 복귀시킨다.
 *
 * 반환값:
 *  - true  : 가입하러 가기 선택 (호출처에서 별도 처리 불필요 — 헬퍼가 이미 sign-out + 이동 수행)
 *  - false : 닫기 선택
 */
export async function showGuestRestrictedDialog(
  dialog: DialogApi,
  options?: {
    /** "회원가입하기" 선택 시 로그아웃 후 로그인 화면으로 돌아갈지 (기본 true) */
    signOutOnConfirm?: boolean;
    /** 로그아웃 함수 (useAuth.signOut). signOutOnConfirm=true일 때 사용 */
    signOut?: () => Promise<void>;
  },
): Promise<boolean> {
  const choice = await dialog.show({
    title: '회원가입 후 사용 가능',
    message: '이 기능은 회원가입 후 사용하실 수 있어요.\n지금 가입하시겠어요?',
    buttons: [
      { id: 'signup', text: '회원가입하기', style: 'primary' },
      { id: 'close', text: '닫기', style: 'cancel' },
    ],
    cancelable: true,
  });

  if (choice === 'signup') {
    if (options?.signOutOnConfirm !== false && options?.signOut) {
      try {
        await options.signOut();
      } catch {
        // 무시 — 어차피 로그인 화면 안내까지만
      }
    } else {
      // 로그아웃 없이도 OnboardingGuest 스택의 Login으로 이동 시도
      try {
        navigateTo('Login');
      } catch {
        // 무시
      }
    }
    return true;
  }
  return false;
}

/**
 * 게스트면 안내 후 true 반환 (호출처는 즉시 return).
 * 게스트가 아니면 false 반환 (정상 진행).
 *
 * @example
 *   if (await ensureNotGuest(user, dialog, { signOut })) return;
 */
export async function ensureNotGuest(
  user: UserProfile | { id?: string | null } | null | undefined,
  dialog: DialogApi,
  options?: { signOut?: () => Promise<void> },
): Promise<boolean> {
  if (!isGuestUser(user)) return false;
  await showGuestRestrictedDialog(dialog, { signOut: options?.signOut });
  return true;
}
