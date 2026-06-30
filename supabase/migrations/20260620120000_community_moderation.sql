-- 커뮤니티 모더레이션 기반: 숨김/밴 플래그 + 신고 누적 자동숨김 트리거 + RLS 반영 + 운영자 RPC.
-- 라이브(테스트 운영) 대상. idempotent. 기존 데이터/정상 흐름 보존(컬럼은 DEFAULT로 안전 추가).
-- 자동숨김 임계값: 서로 다른 reporter 3명(REPORT_HIDE_THRESHOLD).

-- ═════════════════════════════════════════════
-- 1) 숨김 플래그 (posts, comments) — 자동/수동 공용
-- ═════════════════════════════════════════════
alter table public.posts    add column if not exists hidden        boolean not null default false;
alter table public.posts    add column if not exists hidden_reason text;
alter table public.posts    add column if not exists hidden_at     timestamptz;

alter table public.comments add column if not exists hidden        boolean not null default false;
alter table public.comments add column if not exists hidden_reason text;
alter table public.comments add column if not exists hidden_at     timestamptz;

-- 일반 피드 조회 가속(숨김 아닌 것만 최신순). 부분 인덱스.
create index if not exists idx_posts_visible_created
  on public.posts (created_at desc) where hidden = false;
create index if not exists idx_comments_visible_post
  on public.comments (post_id, created_at) where hidden = false;

-- ═════════════════════════════════════════════
-- 2) 밴 플래그 (users)
-- ═════════════════════════════════════════════
alter table public.users add column if not exists banned        boolean not null default false;
alter table public.users add column if not exists banned_at     timestamptz;
alter table public.users add column if not exists banned_reason text;

-- ═════════════════════════════════════════════
-- 3) 자동 숨김 트리거 — post_reports INSERT 후
--    동일 (target_type, target_id) 의 서로 다른 reporter 수 >= 임계값이면 대상 숨김.
--    SECURITY DEFINER 로 RLS 우회.
-- ═════════════════════════════════════════════
create or replace function public.auto_hide_on_report_threshold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  report_hide_threshold constant int := 3;  -- 서로 다른 신고자 수 임계값
  distinct_reporters int;
begin
  select count(distinct reporter_id) into distinct_reporters
  from public.post_reports
  where target_type = new.target_type
    and target_id   = new.target_id;

  if distinct_reporters >= report_hide_threshold then
    if new.target_type = 'post' then
      update public.posts
        set hidden = true,
            hidden_reason = coalesce(hidden_reason, '신고 누적 자동 숨김'),
            hidden_at = coalesce(hidden_at, now())
      where id = new.target_id and hidden = false;
    elsif new.target_type = 'comment' then
      update public.comments
        set hidden = true,
            hidden_reason = coalesce(hidden_reason, '신고 누적 자동 숨김'),
            hidden_at = coalesce(hidden_at, now())
      where id = new.target_id and hidden = false;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_hide_on_report on public.post_reports;
create trigger trg_auto_hide_on_report
  after insert on public.post_reports
  for each row execute function public.auto_hide_on_report_threshold();

-- 트리거 함수는 트리거로만 실행되면 됨 — REST /rpc 직접 호출 차단(SECURITY DEFINER 노출 방지).
revoke all on function public.auto_hide_on_report_threshold() from public, anon, authenticated;

-- ═════════════════════════════════════════════
-- 4) RLS: 일반 사용자는 hidden=true 콘텐츠 안 보이게.
--    posts/comments 의 read 정책 2개(인증/게스트) 모두에 hidden=false 추가.
--    숨김은 전체 숨김(작성자 본인도 안 보임) — service_role(운영 RPC)은 RLS 우회.
-- ═════════════════════════════════════════════
drop policy if exists "posts: 인증 유저 read" on public.posts;
create policy "posts: 인증 유저 read" on public.posts
  for select
  using ((select auth.uid()) is not null and hidden = false);

drop policy if exists "guest_select_posts" on public.posts;
create policy "guest_select_posts" on public.posts
  as permissive for select to anon
  using (hidden = false);

drop policy if exists "comments: 인증 유저 read" on public.comments;
create policy "comments: 인증 유저 read" on public.comments
  for select
  using ((select auth.uid()) is not null and hidden = false);

drop policy if exists "guest_select_comments" on public.comments;
create policy "guest_select_comments" on public.comments
  as permissive for select to anon
  using (hidden = false);

-- ═════════════════════════════════════════════
-- 5) RLS: banned 사용자는 posts/comments INSERT 차단.
--    기존 "본인 insert" 정책의 WITH CHECK 에 banned=false 조건 AND 결합.
--    (정상 사용자 영향 없음 — 새 컬럼 default false.)
-- ═════════════════════════════════════════════
drop policy if exists "posts: 본인 insert" on public.posts;
create policy "posts: 본인 insert" on public.posts
  for insert
  with check (
    author_id = (select auth.uid())
    and not exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.banned = true
    )
  );

drop policy if exists "comments: 본인 insert" on public.comments;
create policy "comments: 본인 insert" on public.comments
  for insert
  with check (
    author_id = (select auth.uid())
    and not exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.banned = true
    )
  );

-- ═════════════════════════════════════════════
-- 6) 운영자 조치용 RPC (SECURITY DEFINER, service_role 전용 EXECUTE)
--    웹 admin 의 Pages Function(서비스롤 키)에서 호출.
--    authenticated/anon 에는 EXECUTE 권한 부여하지 않음.
-- ═════════════════════════════════════════════

-- 6a) 신고 목록(집계): target 별 distinct 신고수/사유/최근시각/콘텐츠 미리보기/작성자/숨김여부.
create or replace function public.admin_list_reports(
  p_only_visible boolean default false,  -- true면 아직 숨김 안 된 것만
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  target_type     text,
  target_id       uuid,
  report_count    bigint,
  reasons         text[],
  last_reported_at timestamptz,
  content_preview text,
  author_id       uuid,
  author_name     text,
  hidden          boolean,
  hidden_reason   text,
  hidden_at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  with agg as (
    select r.target_type,
           r.target_id,
           count(distinct r.reporter_id) as report_count,
           array_agg(distinct r.reason)  as reasons,
           max(r.created_at)             as last_reported_at
    from public.post_reports r
    group by r.target_type, r.target_id
  )
  select a.target_type,
         a.target_id,
         a.report_count,
         a.reasons,
         a.last_reported_at,
         case a.target_type
           when 'post'    then left(coalesce(p.title,'') || ' / ' || coalesce(p.content,''), 200)
           when 'comment' then left(coalesce(c.content,''), 200)
         end as content_preview,
         coalesce(p.author_id, c.author_id) as author_id,
         coalesce(pu.name, cu.name)         as author_name,
         coalesce(p.hidden, c.hidden, false) as hidden,
         coalesce(p.hidden_reason, c.hidden_reason) as hidden_reason,
         coalesce(p.hidden_at, c.hidden_at)         as hidden_at
  from agg a
  left join public.posts    p  on a.target_type = 'post'    and p.id = a.target_id
  left join public.comments c  on a.target_type = 'comment' and c.id = a.target_id
  left join public.users    pu on pu.id = p.author_id
  left join public.users    cu on cu.id = c.author_id
  where (not p_only_visible) or coalesce(p.hidden, c.hidden, false) = false
  order by a.last_reported_at desc
  limit p_limit offset p_offset;
$$;

-- 6b) 게시글/댓글 숨김 토글(숨김/복구). p_hidden=true 숨김, false 복구.
create or replace function public.admin_set_content_hidden(
  p_target_type text,
  p_target_id   uuid,
  p_hidden      boolean,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target_type = 'post' then
    update public.posts
      set hidden = p_hidden,
          hidden_reason = case when p_hidden then coalesce(p_reason, '운영자 숨김') else null end,
          hidden_at     = case when p_hidden then now() else null end
    where id = p_target_id;
  elsif p_target_type = 'comment' then
    update public.comments
      set hidden = p_hidden,
          hidden_reason = case when p_hidden then coalesce(p_reason, '운영자 숨김') else null end,
          hidden_at     = case when p_hidden then now() else null end
    where id = p_target_id;
  else
    raise exception 'invalid target_type: %', p_target_type;
  end if;
end;
$$;

-- 6c) 게시글/댓글 영구 삭제.
create or replace function public.admin_delete_content(
  p_target_type text,
  p_target_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target_type = 'post' then
    delete from public.posts where id = p_target_id;
  elsif p_target_type = 'comment' then
    delete from public.comments where id = p_target_id;
  else
    raise exception 'invalid target_type: %', p_target_type;
  end if;
end;
$$;

-- 6d) 사용자 ban/unban.
create or replace function public.admin_set_user_banned(
  p_user_id uuid,
  p_banned  boolean,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
    set banned        = p_banned,
        banned_at     = case when p_banned then now() else null end,
        banned_reason = case when p_banned then coalesce(p_reason, '운영자 차단') else null end
  where id = p_user_id;
end;
$$;

-- service_role 전용 권한. 일반 사용자 호출 차단.
revoke all on function public.admin_list_reports(boolean,int,int)       from public, anon, authenticated;
revoke all on function public.admin_set_content_hidden(text,uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.admin_delete_content(text,uuid)           from public, anon, authenticated;
revoke all on function public.admin_set_user_banned(uuid,boolean,text)  from public, anon, authenticated;

grant execute on function public.admin_list_reports(boolean,int,int)       to service_role;
grant execute on function public.admin_set_content_hidden(text,uuid,boolean,text) to service_role;
grant execute on function public.admin_delete_content(text,uuid)           to service_role;
grant execute on function public.admin_set_user_banned(uuid,boolean,text)  to service_role;
