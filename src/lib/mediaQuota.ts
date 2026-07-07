// Free 티어 "그룹당 하루 미디어 업로드 풀" 집계·판정.
// 설계(docs/monetization_plan.md 5.2/5.3):
//  - 구독은 그룹(환자) 단위. free 한도는 그룹당 하루 공유 풀(선착순, 구성원 무관).
//  - 한도: 사진 5 · 영상 2(일기1 + 몸상태1) · 음성 1.
//  - 미디어 저장 위치가 둘로 나뉨 → 이중집계 방지하며 통합 카운트:
//     · 일기: diary_entries(오늘 entry_date)의 photo_urls[]/video_media_id/audio_url
//     · 몸상태 영상: media_logs(category=body_state, media_type=video, source!='diary')
//       (일기 영상은 media_logs에도 source='diary'로 들어가므로 여기서 제외 → 일기쪽에서만 셈)
//  - 카운트 = "오늘 그룹에 현재 붙어있는 수"(누적 업로드 아님) → 삭제 시 슬롯 복구.
//  - premium 은 무제한 → 호출부에서 isPremium 이면 게이팅 자체를 스킵.
import { supabase } from './supabase';
import { getLocalToday, getLocalDayRange } from '../utils/medUtils';
import { getDeviceTimeZone } from '../utils/timezone';

export type MediaKind = 'photo' | 'video' | 'voice';

/** Free 그룹 하루 한도 (타입별). */
export const FREE_DAILY_LIMITS: Record<MediaKind, number> = {
  photo: 5,
  video: 2, // 일기 1 + 몸상태 1
  voice: 1,
};

export interface DailyMediaUsage {
  photo: number;
  video: number;
  voice: number;
}

export const EMPTY_USAGE: DailyMediaUsage = { photo: 0, video: 0, voice: 0 };

/**
 * 그룹(환자)의 오늘(tz 기준 entry_date/logged_at) 미디어 사용량을 타입별로 집계.
 * @param excludeAuthorId 주어지면 그 작성자의 일기 글은 제외(자기 작성기에서 편집 중인 글을
 *   중복으로 세지 않기 위함 — 남들이 쓴 양만 집계해 내 작성기 잔여 한도를 계산).
 *   몸상태 영상(media_logs)은 독립 행이라 exclude 대상 아님.
 */
export async function countTodayGroupMedia(
  patientId: string,
  tz?: string,
  excludeAuthorId?: string,
): Promise<DailyMediaUsage> {
  const zone = tz || getDeviceTimeZone();
  const todayStr = getLocalToday(zone);

  // 1) 일기(오늘) — photo_urls/video_media_id/audio_url
  let diaryQuery = supabase
    .from('diary_entries')
    .select('photo_urls, video_media_id, audio_url, author_id')
    .eq('patient_id', patientId)
    .eq('entry_date', todayStr);
  if (excludeAuthorId) diaryQuery = diaryQuery.neq('author_id', excludeAuthorId);
  const { data: diaryRows } = await diaryQuery;

  let photo = 0;
  let diaryVideo = 0;
  let voice = 0;
  for (const r of diaryRows ?? []) {
    if (Array.isArray(r.photo_urls)) photo += r.photo_urls.length;
    if (r.video_media_id) diaryVideo += 1;
    if (r.audio_url) voice += 1;
  }

  // 2) 몸상태 영상(오늘) — media_logs, 일기 소스 제외
  const { start, end } = getLocalDayRange(todayStr, zone);
  const { count: bodyVideoCount } = await supabase
    .from('media_logs')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', patientId)
    .eq('category', 'body_state')
    .eq('media_type', 'video')
    .neq('source', 'diary')
    .gte('logged_at', start)
    .lte('logged_at', end);

  return { photo, video: diaryVideo + (bodyVideoCount ?? 0), voice };
}

/** free 기준, 이 종류를 지금 `adding`개 더 붙일 수 있는지. */
export function canAddMedia(usage: DailyMediaUsage, kind: MediaKind, adding = 1): boolean {
  return usage[kind] + adding <= FREE_DAILY_LIMITS[kind];
}

/** free 기준 남은 슬롯 수. */
export function remainingQuota(usage: DailyMediaUsage, kind: MediaKind): number {
  return Math.max(0, FREE_DAILY_LIMITS[kind] - usage[kind]);
}
