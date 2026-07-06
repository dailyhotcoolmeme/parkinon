/**
 * 개인화 알림음(가족 목소리) 프로비저닝 유틸 — Android + iOS.
 *
 * [Android] 알림 채널 사운드는 시스템이 직접 읽어야 하므로,
 * 앱 내부 파일경로가 아니라 content:// URI(getContentUriAsync)로 줘야 한다.
 * 채널은 불변이라 사운드를 바꾸려면 채널을 새로 만들어야 한다.
 * 채널 ID 규칙(클라·서버 공유): `parkinon_alarm_<custom_sound_id>`
 * → 서버(Edge Function)가 약 알림 푸시를 보낼 때 이 channelId를 지정한다.
 *
 * [iOS] 알림음은 Library/Sounds/<name> 에 설치된 caf 파일만 가능(AAC/m4a 불가).
 * → 네이티브 모듈(modules/alarm-sound)이 m4a 를 IMA4 caf(44100Hz, mono, ≤30초)로
 *   변환해 설치한다. 파일명 규칙(클라·서버 공유): `parkinon_<custom_sound_id>.caf`
 * → 서버(APNs)가 약 알림 푸시를 보낼 때 payload 의 sound 필드에 이 파일명을 지정한다.
 * ⚠️ 네이티브 모듈이라 새 빌드 필요(OTA 불가). 빌드 전(현재 OTA 런타임)에는
 *   AlarmSoundNative.isAvailable=false → iOS 분기 전부 no-op(기본음). 크래시 없음.
 * ⚠️ 이 caf 는 알림음 "자산"일 뿐, 알림 발송/로컬알람 도입이 아님(서버푸시 규칙 불침해).
 *
 * 알림 종류별 목소리(방식 A): 단일 기본 목소리(alarm_sound_prefs) +
 * 약효/운동 알림 항목별 목소리(med_notif_prefs[].soundId / exercise_notif_prefs[].soundId)를
 * 모두 채널로 깔아둔다. 사용자가 쓰는 모든 soundId의 채널이 미리 있어야 푸시가 그 목소리로 울린다.
 */
import { Platform } from 'react-native';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { downloadAsync, cacheDirectory, getContentUriAsync } from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { resolveMediaUrl } from './r2Get';
import * as AlarmSoundNative from '../../modules/alarm-sound';
import i18n from '../i18n';

const CHANNEL_PREFIX = 'parkinon_alarm_';

/** 녹음 사운드용 알림 채널 ID (클라·서버 동일 규칙) */
export function alarmChannelId(soundId: string): string {
  return `${CHANNEL_PREFIX}${soundId}`;
}

/**
 * iOS 알림음 파일명 규칙(클라·서버 공유 상수).
 * Library/Sounds/<stableName> 에 설치되며, 푸시 payload 의 sound 필드와 정확히 일치해야 한다.
 * 규칙 = `parkinon_<soundId>.caf`
 */
export function alarmSoundFileNameIOS(soundId: string): string {
  return `parkinon_${soundId}.caf`;
}

/**
 * iOS: 녹음 사운드(custom_sounds)를 기기에 설치(없으면 다운로드→caf 변환→Library/Sounds).
 * - 네이티브 모듈이 없으면(현재 OTA 런타임) 안전하게 no-op → 다음 빌드 전까지 iOS 는 기본음.
 * - 이미 설치돼 있으면(listSounds 에 존재) skip.
 * @returns 설치된 파일명(또는 미설치 시 null)
 */
export async function ensureRecordedSoundIOS(
  soundId: string,
  publicUrl: string,
): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  if (!AlarmSoundNative.isAvailable) return null; // 네이티브 미존재(빌드 전) → no-op

  const fileName = alarmSoundFileNameIOS(soundId);
  try {
    // 이미 설치돼 있으면 skip
    const installed = await AlarmSoundNative.listSounds().catch(() => [] as string[]);
    if (installed.includes(fileName)) return fileName;

    // presigned GET URL 로 변환해 m4a 다운로드(실패 시 원본 공개 URL 폴백)
    const downloadUrl = await resolveMediaUrl(publicUrl);
    const target = `${cacheDirectory}alarm_${soundId}.m4a`;
    await downloadAsync(downloadUrl, target);

    // 네이티브에서 IMA4 caf 로 변환해 Library/Sounds/<fileName> 설치
    const result = await AlarmSoundNative.installSound(target, fileName);
    return result;
  } catch {
    // 변환/설치 실패 시 iOS 는 기본음으로(크래시 금지)
    return null;
  }
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
  // presigned GET URL 로 변환해 다운로드(실패 시 원본 공개 URL 폴백)
  const downloadUrl = await resolveMediaUrl(publicUrl);
  const target = `${cacheDirectory}alarm_${soundId}.m4a`;
  await downloadAsync(downloadUrl, target);
  const contentUri = await getContentUriAsync(target);

  const existing = await notifee.getChannel(channelId);
  if (!existing) {
    await notifee.createChannel({
      id: channelId,
      name: i18n.t('alarmSound.channelName', { label }),
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

/** 여러 soundId 를 채널로 프로비저닝하고, 그 외 옛 채널은 정리 (Android) */
async function provisionSounds(soundIds: string[], sounds: SoundRow[]): Promise<void> {
  if (Platform.OS !== 'android') return;
  const keep: string[] = [];
  for (const sid of new Set(soundIds)) {
    const s = sounds.find((x) => x.id === sid);
    if (!s || !s.public_url) continue;
    const ch = await ensureRecordedChannel(
      s.id,
      s.public_url,
      s.label?.trim() || i18n.t('alarmSound.defaultRecordingLabel'),
    ).catch(() => null);
    if (ch) keep.push(ch);
  }
  await cleanupAlarmChannels(keep);
}

/**
 * iOS: 여러 soundId 를 Library/Sounds 에 caf 로 설치하고, 더 이상 안 쓰는 parkinon_*.caf 는 정리.
 * - 네이티브 모듈 미존재(빌드 전)면 전부 no-op.
 */
async function provisionSoundsIOS(soundIds: string[], sounds: SoundRow[]): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!AlarmSoundNative.isAvailable) return; // 빌드 전 → no-op

  const keep = new Set<string>();
  for (const sid of new Set(soundIds)) {
    const s = sounds.find((x) => x.id === sid);
    if (!s || !s.public_url) continue;
    const name = await ensureRecordedSoundIOS(s.id, s.public_url).catch(() => null);
    if (name) keep.add(name);
  }

  // 미사용 caf 정리(우리가 설치한 parkinon_*.caf 만 대상)
  try {
    const installed = await AlarmSoundNative.listSounds();
    for (const f of installed) {
      if (f.startsWith('parkinon_') && f.endsWith('.caf') && !keep.has(f)) {
        await AlarmSoundNative.removeSound(f).catch(() => {});
      }
    }
  } catch {
    // 정리 실패는 무시(다음 기회에 재시도)
  }
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
  // iOS·Android 만 대상(web 등 제외)
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  if (!groupId) {
    // 그룹 없음 → 설치된 자산 전부 정리(Android 채널 / iOS caf)
    if (Platform.OS === 'android') {
      await cleanupAlarmChannels([]).catch(() => {});
    } else if (Platform.OS === 'ios') {
      await provisionSoundsIOS([], []).catch(() => {});
    }
    return;
  }
  try {
    const [soundsRes, prefRes, userRes, missedRes, slotsRes] = await Promise.all([
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
      supabase
        .from('missed_med_sound_prefs' as any)
        .select('first_sound_id, second_sound_id')
        .eq('user_id', userId)
        .maybeSingle(),
      // dose_slots 의 복용시간 알림/약효추적 목소리(환자 본인일 때 채워짐; 보호자는 빈 결과)
      supabase
        .from('dose_slots' as any)
        .select('remind_sound_id, track_sound_id')
        .eq('patient_id', userId),
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
    // 4) 약 미복용 알림 전용 목소리(1차/2차)
    const missed = (missedRes.data as any) ?? {};
    if (missed.first_sound_id) ids.push(missed.first_sound_id);
    if (missed.second_sound_id) ids.push(missed.second_sound_id);

    // 5) dose_slots 복용시간 알림(remind)·약효추적(track) 목소리
    for (const row of ((slotsRes.data as any[]) ?? []) as Array<{
      remind_sound_id?: string | null;
      track_sound_id?: string | null;
    }>) {
      if (row?.remind_sound_id) ids.push(row.remind_sound_id);
      if (row?.track_sound_id) ids.push(row.track_sound_id);
    }

    // 플랫폼별 프로비저닝
    if (Platform.OS === 'android') {
      await provisionSounds(ids, sounds);
    } else if (Platform.OS === 'ios') {
      await provisionSoundsIOS(ids, sounds);
    }
  } catch {
    // 실패해도 다음 기회(화면 진입 등)에 다시 프로비저닝됨
  }
}
