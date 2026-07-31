// 녹음 알림음(가족 목소리)은 유료 기능이다.
//
// 왜 서버에서 막는가:
//   구독 중에 녹음해 두면 .caf 파일이 폰에 설치되고 DB 설정도 남는다. 그 뒤 해지해도
//   앱만 막아서는 이미 설정된 슬롯이 계속 그 소리로 울린다(실측 확인).
//   실제 발송 시점이 마지막 관문이라, 여기서 등급을 보고 기본음으로 바꾼다.
//
// 설계 원칙:
//   - DB 설정값(녹음, 슬롯의 sound_id)은 절대 지우지 않는다. 재구독하면 즉시 원래대로 울린다.
//   - 프리셋은 무료 기능이라 그대로 둔다. 막는 건 녹음(uuid)뿐이다.
//   - 만료 시점은 우리가 정하지 않는다. subscription_expires_at 은 스토어가 계산해
//     RevenueCat 웹훅으로 넣어준 값이라, 해지해도 결제 기간 끝까지는 유료로 잡힌다.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** 'preset:xxx' 는 무료. 그 외(녹음 uuid)는 유료 기능. */
export function isRecordedSound(soundId: string | null | undefined): boolean {
  return !!soundId && !soundId.startsWith('preset:');
}

/** 그룹이 지금 유료인지 — tier 가 free 가 아니고, 만료일이 아직 안 지났을 때만 true. */
export async function isGroupPremium(
  supabase: SupabaseClient,
  groupId: string | null | undefined,
): Promise<boolean> {
  if (!groupId) return false;
  const { data, error } = await supabase
    .from('patient_groups')
    .select('subscription_tier, subscription_expires_at')
    .eq('id', groupId)
    .maybeSingle();
  if (error || !data) return false;
  const tier = (data.subscription_tier ?? 'free') as string;
  if (!tier || tier === 'free') return false;
  const exp = data.subscription_expires_at as string | null;
  // 만료일이 없으면(영구/수동 부여) 유료로 본다.
  if (!exp) return true;
  return new Date(exp).getTime() > Date.now();
}

// 한 번의 크론 실행에서 같은 그룹을 여러 번 조회하지 않도록 담아둔다(실행마다 새로 시작).
const groupPremiumCache = new Map<string, boolean>();
const userGroupCache = new Map<string, string | null>();

/** 사용자가 속한 그룹이 유료인지 — 알림 발송 경로 어디서든 이걸로 판정한다. */
export async function isUserPremium(
  supabase: SupabaseClient,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  let groupId = userGroupCache.get(userId);
  if (groupId === undefined) {
    const { data } = await supabase
      .from('users')
      .select('patient_group_id')
      .eq('id', userId)
      .maybeSingle();
    groupId = (data?.patient_group_id as string | null) ?? null;
    userGroupCache.set(userId, groupId);
  }
  if (!groupId) return false;
  const cached = groupPremiumCache.get(groupId);
  if (cached !== undefined) return cached;
  const premium = await isGroupPremium(supabase, groupId);
  groupPremiumCache.set(groupId, premium);
  return premium;
}

/**
 * 사용자 기준으로 발송에 쓸 soundId 를 정한다.
 * 녹음인데 무료 등급이면 null(기본음)로 떨어뜨린다.
 */
export async function effectiveSoundIdForUser(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  soundId: string | null | undefined,
): Promise<string | null> {
  if (!isRecordedSound(soundId)) return soundId ?? null;
  if (await isUserPremium(supabase, userId)) return soundId ?? null;
  console.log(`[premiumSound] 무료 등급 — 녹음 알림음(${soundId}) → 기본음 (user=${userId})`);
  return null;
}

/**
 * 발송에 실제로 쓸 soundId 를 정한다.
 * 녹음인데 무료 등급이면 null(=기본음)로 떨어뜨린다. 그 외에는 그대로 통과.
 */
export async function effectiveSoundId(
  supabase: SupabaseClient,
  groupId: string | null | undefined,
  soundId: string | null | undefined,
): Promise<string | null> {
  if (!isRecordedSound(soundId)) return soundId ?? null;
  const premium = await isGroupPremium(supabase, groupId);
  if (premium) return soundId ?? null;
  console.log(`[premiumSound] 무료 등급 — 녹음 알림음(${soundId})을 기본음으로 대체 (group=${groupId})`);
  return null;
}
