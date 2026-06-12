-- 종합 데일리 저널: 사람이 쓴 "한마디" 저장 테이블(자동 영역은 기존 테이블에서 조회).
create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.users(id) on delete cascade,
  author_id  uuid not null references public.users(id) on delete cascade,
  entry_date date not null,
  text text,
  audio_url text,
  audio_r2_key text,
  photo_urls text[] not null default '{}',
  video_media_id uuid references public.media_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, entry_date, author_id)
);
create index if not exists idx_diary_entries_patient_date on public.diary_entries(patient_id, entry_date);
create index if not exists idx_diary_entries_author on public.diary_entries(author_id);
create index if not exists idx_diary_entries_video on public.diary_entries(video_media_id);

alter table public.diary_entries enable row level security;

create policy "diary_entries: read" on public.diary_entries
  for select to authenticated
  using (
    (patient_id = (select auth.uid()))
    or (author_id = (select auth.uid()))
    or is_same_group((select auth.uid()), patient_id)
  );

create policy "diary_entries: insert" on public.diary_entries
  for insert to authenticated
  with check (
    (author_id = (select auth.uid()))
    and ((patient_id = (select auth.uid())) or is_same_group((select auth.uid()), patient_id))
  );

create policy "diary_entries: update" on public.diary_entries
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "diary_entries: delete" on public.diary_entries
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- 영상 기록 연동: 일기에서 첨부한 영상 구분용 source('manual'|'diary')
alter table public.media_logs add column if not exists source text not null default 'manual';
