// 일기 첨부(사진/영상/음성) 표시 순서 토큰 유틸.
// media_order는 첨부들의 평면 순서를 토큰 배열로 담는다.
//   사진: `photo:<url>`  / 영상: `video`  / 음성: `audio`
// media_order가 null이면(기존 행·구버전) 기본 순서(사진들 → 영상 → 음성)로 폴백한다.
//   ※ 기본 순서는 EntryBlock의 기존 렌더 순서(사진 → 영상 → 음성)와 일치시킨다.

export const PHOTO_PREFIX = 'photo:';
export const VIDEO_TOKEN = 'video';
export const AUDIO_TOKEN = 'audio';

export type MediaToken = string; // 'photo:<url>' | 'video' | 'audio'

// 현재 첨부 구성으로부터 '기본 순서'(사진들 → 영상 → 음성) 토큰 배열을 만든다.
export function buildDefaultMediaOrder(opts: {
  photoUrls: string[];
  hasVideo: boolean;
  hasAudio: boolean;
}): MediaToken[] {
  const order: MediaToken[] = [];
  for (const url of opts.photoUrls) order.push(`${PHOTO_PREFIX}${url}`);
  if (opts.hasVideo) order.push(VIDEO_TOKEN);
  if (opts.hasAudio) order.push(AUDIO_TOKEN);
  return order;
}

// 저장된(또는 로컬) media_order를 현재 실제 첨부 구성에 맞춰 정합화한다.
// - 더 이상 존재하지 않는 토큰(삭제된 사진/영상/음성)은 제거
// - 새로 추가됐는데 순서에 없는 토큰은 기본 위치(사진→영상→음성 규칙)대로 끝에 append
// 이렇게 하면 부분적으로만 저장된 순서나 null도 안전하게 복구된다.
export function normalizeMediaOrder(
  prev: MediaToken[] | null | undefined,
  current: { photoUrls: string[]; hasVideo: boolean; hasAudio: boolean },
): MediaToken[] {
  const defaults = buildDefaultMediaOrder(current);
  const validSet = new Set(defaults);
  // 1) 기존 순서 중 아직 유효한 토큰만 유지
  const kept = (prev ?? []).filter((t) => validSet.has(t));
  const keptSet = new Set(kept);
  // 2) 기본 순서를 돌며 아직 안 들어간(=새로 추가된) 토큰을 뒤에 append
  const appended = defaults.filter((t) => !keptSet.has(t));
  return [...kept, ...appended];
}
