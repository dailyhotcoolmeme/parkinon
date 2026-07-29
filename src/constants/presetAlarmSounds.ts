/**
 * 앱 제공 프리셋 알림음 카탈로그 (오너 큐레이션·전체 사용자 공용).
 *
 * 오너가 assets/ 에 넣은 12개 음원을 압축·번들해 제공한다(R2 아님 — 무음/401 원천 차단).
 *  - iOS: assets/alarm-presets/ios/<fileId>.caf   (IMA4·mono·44100·≤30초, 앱 번들)
 *  - Android: assets/alarm-presets/android/<fileId>.mp3 (mono·96k, res/raw)
 *  - 표시명(nameKo)은 오너가 준 원본 파일명 그대로(한국 사용자용). nameEn은 해외 로케일용 번역.
 *
 * dose_slots.remind_sound_id / track_sound_id 에는 `preset:<fileId>` 형태로 저장해
 * 그룹 녹음(custom_sounds UUID)과 구분한다.
 *
 * ⚠️ 실제 알림 재생은 번들 자산이 포함된 새 빌드에서만 동작(OTA 불가). 빌드 전엔 기본음.
 */
import i18n from '../i18n';
import { isOverseasLocale } from '../i18n/detectLocale';

/** dose_slots 저장 id 접두 — 녹음(uuid)과 프리셋을 구분 */
export const PRESET_SOUND_PREFIX = 'preset:';

export type PresetAlarmSound = {
  /** dose_slots 에 저장되는 값(`preset:<fileId>`) */
  id: string;
  /** 번들 파일 식별자(확장자·경로 제외, ASCII). iOS caf / Android res-raw 공통 */
  fileId: string;
  /** 표시명 = 원본 파일명 그대로(한글) */
  nameKo: string;
  /** 표시명 영문판(해외 로케일용) */
  nameEn: string;
  /** 길이(ms) — 미리듣기/안내용 */
  durationMs: number;
};

/** 짧은 것 → 긴 것 순(짧은 반복 알림용이 위로). */
export const PRESET_ALARM_SOUNDS: PresetAlarmSound[] = [
  { fileId: 'preset_knock', nameKo: '조심스레 노크하는', nameEn: 'Gentle knock', durationMs: 1680 },
  { fileId: 'preset_waterdrop', nameKo: '물방울 느낌 통통튀는', nameEn: 'Bouncy water drop', durationMs: 2540 },
  { fileId: 'preset_shortloop', nameKo: '그냥 짧게 반복 알림으로 쓸법한', nameEn: 'Short repeating chime', durationMs: 3020 },
  { fileId: 'preset_dreamy', nameKo: '몽환적이면서 리듬감 있는', nameEn: 'Dreamy and rhythmic', durationMs: 4050 },
  { fileId: 'preset_bouncy', nameKo: '통통 튀면서 중독성 있는', nameEn: 'Catchy and bouncy', durationMs: 8410 },
  { fileId: 'preset_dramatic', nameKo: '극적이면서 꼭 약을 먹어야할거 같은', nameEn: 'Dramatic, urgent reminder', durationMs: 12560 },
  { fileId: 'preset_cheerful', nameKo: '기분 좋으면서 리듬감 느껴지는', nameEn: 'Cheerful and upbeat', durationMs: 16400 },
  { fileId: 'preset_trot', nameKo: '딱 트로트 같은', nameEn: 'Retro trot-style tune', durationMs: 16660 },
  { fileId: 'preset_calm', nameKo: '리듬감 있는데 차분하기도 한', nameEn: 'Rhythmic yet calm', durationMs: 18050 },
  { fileId: 'preset_ballad', nameKo: '구슬픈 듯 하면서 노래를 불러주는 느낌', nameEn: 'Wistful, song-like melody', durationMs: 18120 },
  { fileId: 'preset_lullaby', nameKo: '틀어놓고 자도 될거 같은', nameEn: 'Soothing lullaby', durationMs: 19220 },
  { fileId: 'preset_sitcom', nameKo: '시트콤 주인공 행복한 일상 느낌', nameEn: 'Cheerful sitcom vibe', durationMs: 25030 },
].map((p) => ({ ...p, id: `${PRESET_SOUND_PREFIX}${p.fileId}` }));

/** 현재 로케일 기준 표시명(nameKo/nameEn 중 선택). */
export function presetSoundDisplayName(p: Pick<PresetAlarmSound, 'fileId' | 'nameKo' | 'nameEn'>): string {
  // nameKo/nameEn 이분법이면 프랑스어·일본어 사용자가 영어 이름만 본다.
  // 표시명은 언어 파일(presetSound.*)에서 가져오고, 키가 없을 때만 예전 값으로 떨어진다.
  const key = `presetSound.${p.fileId.replace('preset_', '')}`;
  const translated = i18n.t(key);
  if (translated && translated !== key) return translated;
  return isOverseasLocale() ? p.nameEn : p.nameKo;
}

/** dose_slots 저장값이 프리셋인지 */
export function isPresetSoundId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(PRESET_SOUND_PREFIX);
}

/** `preset:<fileId>` → fileId (아니면 null) */
export function presetFileIdOf(id: string | null | undefined): string | null {
  if (!isPresetSoundId(id)) return null;
  return (id as string).slice(PRESET_SOUND_PREFIX.length);
}

/** 저장 id 로 프리셋 카탈로그 항목 조회 */
export function findPresetById(id: string | null | undefined): PresetAlarmSound | null {
  if (!id) return null;
  return PRESET_ALARM_SOUNDS.find((p) => p.id === id) ?? null;
}

/** iOS 알림 payload/번들 파일명 규칙 = `<fileId>.caf` */
export function presetSoundFileNameIOS(fileId: string): string {
  return `${fileId}.caf`;
}

/** Android 알림 채널 id 규칙(프리셋 전용) = `parkinon_preset_<fileId>` */
export function presetChannelIdAndroid(fileId: string): string {
  return `parkinon_preset_${fileId}`;
}

// ── 알림 동작(방식) — 알림마다 개별 선택(dose_slots.remind_alarm_mode / track_alarm_mode) ──
//   basic  : 한 번 울림(현행)
//   sound30: 30초 동안 울림
//   alarm  : 알람처럼 — 끌 때까지 무한반복 + (Android) 전체화면 알람. iOS는 OS 제한상 30초까지.
export type AlarmMode = 'basic' | 'sound30' | 'alarm';
export const DEFAULT_ALARM_MODE: AlarmMode = 'basic';
