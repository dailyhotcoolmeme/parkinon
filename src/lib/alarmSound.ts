/**
 * 개인화 알림음(가족 목소리) 프로비저닝 유틸 — Android.
 *
 * 핵심: Android 알림 채널 사운드는 시스템이 직접 읽어야 하므로,
 * 앱 내부 파일경로가 아니라 content:// URI(getContentUriAsync)로 줘야 한다.
 * 채널은 불변이라 사운드를 바꾸려면 채널을 새로 만들어야 한다.
 *
 * 채널 ID 규칙(클라·서버 공유): `parkinon_alarm_<custom_sound_id>`
 * → 서버(Edge Function)가 약 알림 푸시를 보낼 때 이 channelId를 지정한다.
 *
 * 알림 종류별 목소리(방식 A): 단일 기본 목소리(alarm_sound_prefs) +
 * 약효/운동 알림 항목별 목소리(med_notif_prefs[].soundId / exercise_notif_prefs[].soundId)를
 * 모두 채널로 깔아둔다. 사용자가 쓰는 모든 soundId의 채널이 미리 있어야 푸시가 그 목소리로 울린다.
 */
import { Platform } from 'react-native';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { downloadAsync, cacheDirectory, getContentUriAsync } from 'expo-file-system/legacy';
import { supabase } from './supabase';

const CHANNEL_PREFIX = 'parkinon_alarm_';

/** 녹음 사운드용 알림 채널 ID (클라·서버 동일 규칙) */
export function alarmChannelId(soundId: string): string {
  return `${CHANNEL_PREFIX}${soundId}`;
}

/**
 * 녹음 사운드를 알림 채널로 프로비저닝(없으면 생성).
 * - 파일을 항상 같은 경로로 받아둔다(경로 고정 → content URI 고정 → 기존 채널과 호환).
 * - 채널이 이미 있으면 그대로 둔다(불변, 사용자의 시스템 알림 설정 보존).
 * @returns 채널 ID (iOS는 채널 개념이 없어 ID만 반환 — 2차에서 별도 처리)
 */
export async function ensureRecordedChannel(
  soundId: string,
  publicUrl: string,
  label: string,
): Promise<string> {
  const channelId = alarmChannelId(soundId);
  if (Platform.OS !== 'android') return channelId;

  // 파일 보장: 같은 경로 → content URI가 고정되어 이미 만든 채널과 계속 호환
  const target = `${cacheDirectory}alarm_${soundId}.m4a`;
  await downloadAsync(publicUrl, target);
  const contentUri = await getContentUriAsync(target);

  const existing = await notifee.getChannel(channelId);
  if (!existing) {
    await notifee.createChannel({
      id: channelId,
      name: `약 알림음 (${label})`,
      sound: contentUri,
      importance: AndroidImportance.HIGH,
      vibration: true,
    });
  }
  return channelId;
}

/** keepChannelIds 에 없는 parkinon_alarm_* 채널 정리(더 이상 쓰지 않는 옛 채널 제거) */
export async function cleanupAlarmChannels(keepChannelIds: string[]): Promise<void> {
  if (Platform.OS !== 'android') return;
  const keep = new Set(keepChannelIds);
  const channels = await notifee.getChannels();
  for (const ch of channels) {
    if (ch.id.startsWith(CHANNEL_PREFIX) && !keep.has(ch.id)) {
      await notifee.deleteChannel(ch.id).catch(() => {});
    }
  }
}

type SoundRow = { id: string; public_url: string | null; label: string | null };

/** 여러 soundId 를 채널로 프로비저닝하고, 그 외 옛 채널은 정리 */
async function provisionSounds(soundIds: string[], sounds: SoundRow[]): Promise<void> {
  if (Platform.OS !== 'android') return;
  const keep: string[] = [];
  for (const sid of new Set(soundIds)) {
    const s = sounds.find((x) => x.id === sid);
    if (!s || !s.public_url) continue;
    const ch = await ensureRecordedChannel(
      s.id,
      s.public_url,
      s.label?.trim() || '내 녹음',
    ).catch(() => null);
    if (ch) keep.push(ch);
  }
  await cleanupAlarmChannels(keep);
}

/**
 * 서버에서 현재 사용자의 알림음 설정 전체를 받아 기기에 프로비저닝.
 * - 단일 기본 목소리(alarm_sound_prefs) + 약효/운동 알림 항목별 목소리(soundId)를 모두 채널로.
 * 앱 시작(로그인 직후)·알림음 설정 변경·알림 추가/수정 시 호출 → 약 알림 전에 채널이 깔려 있도록.
 */
export async function provisionForUser(
  userId: string,
  groupId: string | null,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!groupId) {
    await cleanupAlarmChannels([]).catch(() => {});
    return;
  }
  try {
    const [soundsRes, prefRes, userRes] = await Promise.all([
      supabase
        .from('custom_sounds' as any)
        .select('id, public_url, label')
        .eq('group_id', groupId),
      supabase
        .from('alarm_sound_prefs' as any)
        .select('sound_type, custom_sound_id')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('users')
        .select('med_notif_prefs, exercise_notif_prefs, med_time_sound_prefs')
        .eq('id', userId)
        .maybeSingle(),
    ]);

    const sounds = ((soundsRes.data as any[]) ?? []) as SoundRow[];
    const ids: string[] = [];

    // 1) 단일 기본 목소리
    const pref = prefRes.data as any;
    if (pref?.sound_type === 'recorded' && pref.custom_sound_id) {
      ids.push(pref.custom_sound_id);
    }
    // 2) 약효/운동 알림 항목별 목소리
    const u = (userRes.data as any) ?? {};
    for (const n of (u.med_notif_prefs ?? []) as Array<{ soundId?: string | null }>) {
      if (n?.soundId) ids.push(n.soundId);
    }
    for (const n of (u.exercise_notif_prefs ?? []) as Array<{ soundId?: string | null }>) {
      if (n?.soundId) ids.push(n.soundId);
    }
    // 3) 약 복용 시간(아침/점심/저녁/취침)별 목소리
    const mtSound = (u.med_time_sound_prefs ?? {}) as Record<string, string | null>;
    for (const sid of Object.values(mtSound)) {
      if (sid) ids.push(sid);
    }

    await provisionSounds(ids, sounds);
  } catch {
    // 실패해도 다음 기회(화면 진입 등)에 다시 프로비저닝됨
  }
}
