-- admin_list_reports 반환에 media_keys(게시물 첨부 사진 R2 key 배열) 추가
--   신고 목록에서 게시물 첨부 사진 썸네일을 보여주기 위함.
--   post_media(post_id, r2_key, media_type='image', sort_order) 에서 정렬해 array_agg.
--   target_type='post' 인 행만 채워지고, comment 면 NULL.
-- 반환 컬럼 변경 → DROP 후 CREATE. 시그니처(파라미터) 변경 없음.
-- 나머지 집계·필터·정렬·author_banned·resolved 전부 유지.

drop function if exists public.admin_list_reports(boolean,int,int,text);

create or replace function public.admin_list_reports(
  p_only_visible boolean default false,   -- true면 아직 숨김 안 된 것만
  p_limit  int default 100,
  p_offset int default 0,
  p_status text default 'open'            -- 'open'(진행중) / 'resolved'(종결) / 'all'
)
returns table (
  target_type      text,
  target_id        uuid,
  report_count     bigint,
  reasons          text[],
  last_reported_at timestamptz,
  content_preview  text,
  author_id        uuid,
  author_name      text,
  author_banned    boolean,
  hidden           boolean,
  hidden_reason    text,
  hidden_at        timestamptz,
  resolved         boolean,
  media_keys       text[]
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
           max(r.created_at)             as last_reported_at,
           bool_and(r.resolved)          as resolved
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
         coalesce(pu.banned, cu.banned, false) as author_banned,
         coalesce(p.hidden, c.hidden, false) as hidden,
         coalesce(p.hidden_reason, c.hidden_reason) as hidden_reason,
         coalesce(p.hidden_at, c.hidden_at)         as hidden_at,
         a.resolved,
         case when a.target_type = 'post' then (
           select array_agg(pm.r2_key order by pm.sort_order, pm.created_at)
           from public.post_media pm
           where pm.post_id = a.target_id
             and pm.media_type = 'image'
         ) end as media_keys
  from agg a
  left join public.posts    p  on a.target_type = 'post'    and p.id = a.target_id
  left join public.comments c  on a.target_type = 'comment' and c.id = a.target_id
  left join public.users    pu on pu.id = p.author_id
  left join public.users    cu on cu.id = c.author_id
  where ((not p_only_visible) or coalesce(p.hidden, c.hidden, false) = false)
    and (
      p_status = 'all'
      or (p_status = 'open'     and a.resolved = false)
      or (p_status = 'resolved' and a.resolved = true)
    )
  order by a.last_reported_at desc
  limit p_limit offset p_offset;
$$;

-- service_role 전용 권한 복원
revoke all on function public.admin_list_reports(boolean,int,int,text) from public, anon, authenticated;
grant execute on function public.admin_list_reports(boolean,int,int,text) to service_role;

notify pgrst, 'reload schema';
