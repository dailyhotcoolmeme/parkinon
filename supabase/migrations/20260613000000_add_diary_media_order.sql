-- 일기 첨부(사진/영상/음성) 표시 순서. 토큰 평면 배열로 저장.
--   사진: 'photo:<url>'  / 영상: 'video'  / 음성: 'audio'
-- null이면(기존 행·구버전 클라이언트) 앱에서 기본 순서(사진들 → 영상 → 음성)로 폴백한다.
-- 컬럼 추가만 (비파괴적).
alter table public.diary_entries add column if not exists media_order text[];
