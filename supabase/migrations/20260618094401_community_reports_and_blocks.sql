-- 커뮤니티 신고(post_reports) / 차단(user_blocks) 테이블 명문화.
-- 이 객체들은 원래 마이그레이션 파일 없이 라이브 DB에만 존재했음(2026-06-18 적용).
-- 현재 라이브 구조 그대로 IF NOT EXISTS 로 재현 — 기존 데이터/객체 보존, 파괴 금지, idempotent.
-- 신규 환경(로컬/리셋)에서도 동일 구조가 만들어지도록 하기 위함.

-- ─────────────────────────────────────────────
-- post_reports: 게시글/댓글 신고
--   target_type='post' → target_id = posts.id
--   target_type='comment' → target_id = comments.id
--   post_id: 댓글 신고 시 소속 게시글 id(선택), 게시글 신고 시 게시글 id
-- ─────────────────────────────────────────────
create table if not exists public.post_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  target_type text not null check (target_type = any (array['post','comment'])),
  target_id   uuid not null,
  post_id     uuid references public.posts(id) on delete cascade,
  reason      text not null,
  detail      text,
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

create index if not exists idx_post_reports_target
  on public.post_reports using btree (target_type, target_id);

alter table public.post_reports enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polname = 'post_reports: 본인 insert' and polrelid = 'public.post_reports'::regclass) then
    create policy "post_reports: 본인 insert" on public.post_reports
      for insert with check (reporter_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'post_reports: 본인 select' and polrelid = 'public.post_reports'::regclass) then
    create policy "post_reports: 본인 select" on public.post_reports
      for select using (reporter_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'post_reports: 본인 delete' and polrelid = 'public.post_reports'::regclass) then
    create policy "post_reports: 본인 delete" on public.post_reports
      for delete using (reporter_id = (select auth.uid()));
  end if;
end $$;

-- ─────────────────────────────────────────────
-- user_blocks: 사용자 차단(피드/댓글 가림은 앱 쿼리에서 처리)
-- ─────────────────────────────────────────────
create table if not exists public.user_blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists idx_user_blocks_blocker
  on public.user_blocks using btree (blocker_id);

alter table public.user_blocks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polname = 'user_blocks: 본인 insert' and polrelid = 'public.user_blocks'::regclass) then
    create policy "user_blocks: 본인 insert" on public.user_blocks
      for insert with check (blocker_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'user_blocks: 본인 select' and polrelid = 'public.user_blocks'::regclass) then
    create policy "user_blocks: 본인 select" on public.user_blocks
      for select using (blocker_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'user_blocks: 본인 delete' and polrelid = 'public.user_blocks'::regclass) then
    create policy "user_blocks: 본인 delete" on public.user_blocks
      for delete using (blocker_id = (select auth.uid()));
  end if;
end $$;
