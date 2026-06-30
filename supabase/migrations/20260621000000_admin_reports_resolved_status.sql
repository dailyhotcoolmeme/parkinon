-- 신고 검토 진행중/종결 상태 도입.
-- 정책: 수동 종결 + 새 신고 시 자동 재오픈(resolved 기본 false라 트리거 불필요) + 영구삭제 시 자동 종결.
-- idempotent. service_role 전용 EXECUTE 유지(anon/authenticated 미노출). 라이브(테스트 운영) 대상.
--
-- 그룹 상태 정의: 한 대상(target_type,target_id) = "종결"이면 그 대상의 모든 post_reports 행 resolved=true.
--   진행중 = resolved=false 행이 하나라도 있음. 새 신고는 resolved 기본 false라 자동 재오픈(트리거 불필요).
-- 참고: post_reports.post_id 는 posts FK ON DELETE CASCADE → 게시글 영구삭제 시 신고행이 함께 제거되어
--   모든 탭에서 사라진다(정상). 댓글 영구삭제 시엔 신고행이 남으므로 admin_delete_content 의 auto-resolve 로 종결 처리.

-- ═════════════════════════════════════════════
-- 1) post_reports 종결 컬럼
-- ═════════════════════════════════════════════
alter table public.post_reports add column if not exists resolved    boolean not null default false;
alter table public.post_reports add column if not exists resolved_at timestamptz;

-- ═════════════════════════════════════════════
-- 2) 그룹 종결 토글 RPC (그 대상의 모든 신고행 resolved 일괄 설정)
-- ═════════════════════════════════════════════
create or replace function public.admin_set_reports_resolved(
  p_target_type text,
  p_target_id   uuid,
  p_resolved    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.post_reports
    set resolved    = p_resolved,
        resolved_at = case when p_resolved then now() else null end
  where target_type = p_target_type
    and target_id   = p_target_id;
end;
$$;

-- ═════════════════════════════════════════════
-- 3) admin_delete_content: 영구삭제 시 해당 대상 신고행 자동 종결
--    (게시글은 CASCADE 로 신고행이 사라질 수 있으나, 댓글 등 남는 경로를 위해 종결 처리)
-- ═════════════════════════════════════════════
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

  -- 삭제된 콘텐츠의 신고는 처리완료로 자동 종결.
  update public.post_reports
    set resolved    = true,
        resolved_at = now()
  where target_type = p_target_type
    and target_id   = p_target_id
    and resolved = false;
end;
$$;

-- ═════════════════════════════════════════════
-- 4) admin_list_reports: p_status('open'/'resolved'/'all') + resolved 반환
--    시그니처 변경(파라미터/반환컬럼) → DROP 후 CREATE.
-- ═════════════════════════════════════════════
drop function if exists public.admin_list_reports(boolean,int,int);

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
  resolved         boolean
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
         a.resolved
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

-- ═════════════════════════════════════════════
-- 5) service_role 전용 권한(신규/변경 RPC)
-- ═════════════════════════════════════════════
revoke all on function public.admin_list_reports(boolean,int,int,text)       from public, anon, authenticated;
revoke all on function public.admin_set_reports_resolved(text,uuid,boolean)   from public, anon, authenticated;

grant execute on function public.admin_list_reports(boolean,int,int,text)     to service_role;
grant execute on function public.admin_set_reports_resolved(text,uuid,boolean) to service_role;

-- PostgREST 스키마 캐시 리로드
notify pgrst, 'reload schema';
