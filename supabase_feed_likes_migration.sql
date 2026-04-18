-- =============================================
-- 파킨온 피드 좋아요 테이블 + 조회수 RPC
-- Supabase Dashboard > SQL Editor에서 실행
-- =============================================

-- ─── post_likes ───────────────────────────────────────────────────────────────
create table if not exists post_likes (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (post_id, user_id)
);

alter table post_likes enable row level security;

create policy "post_likes: 인증 유저 read"
  on post_likes for select
  using (auth.uid() is not null);

create policy "post_likes: 본인 insert"
  on post_likes for insert
  with check (user_id = auth.uid());

create policy "post_likes: 본인 delete"
  on post_likes for delete
  using (user_id = auth.uid());

create index if not exists idx_post_likes_post_id on post_likes (post_id);
create index if not exists idx_post_likes_user_id on post_likes (user_id);

-- ─── comment_likes ────────────────────────────────────────────────────────────
create table if not exists comment_likes (
  id uuid primary key default uuid_generate_v4(),
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (comment_id, user_id)
);

alter table comment_likes enable row level security;

create policy "comment_likes: 인증 유저 read"
  on comment_likes for select
  using (auth.uid() is not null);

create policy "comment_likes: 본인 insert"
  on comment_likes for insert
  with check (user_id = auth.uid());

create policy "comment_likes: 본인 delete"
  on comment_likes for delete
  using (user_id = auth.uid());

create index if not exists idx_comment_likes_comment_id on comment_likes (comment_id);

-- ─── post_likes 변경 시 posts.like_count 자동 동기화 트리거 ───────────────────
create or replace function sync_post_like_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update posts set like_count = like_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists post_likes_sync on post_likes;
create trigger post_likes_sync
  after insert or delete on post_likes
  for each row execute function sync_post_like_count();

-- ─── comment_likes 변경 시 comments.like_count 자동 동기화 트리거 ─────────────
create or replace function sync_comment_like_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update comments set like_count = like_count + 1 where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists comment_likes_sync on comment_likes;
create trigger comment_likes_sync
  after insert or delete on comment_likes
  for each row execute function sync_comment_like_count();

-- ─── comments insert/delete 시 posts.comment_count 자동 동기화 트리거 ──────────
create or replace function sync_post_comment_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists comments_count_sync on comments;
create trigger comments_count_sync
  after insert or delete on comments
  for each row execute function sync_post_comment_count();

-- ─── 조회수 increment RPC ─────────────────────────────────────────────────────
-- posts는 작성자 본인만 update RLS가 걸려 있으므로
-- SECURITY DEFINER 함수로 RLS 우회하여 view_count만 증가
create or replace function increment_view_count(post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update posts
  set view_count = view_count + 1
  where id = post_id;
$$;
