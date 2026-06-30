-- admin_list_reports 반환에 author_banned(작성자 이용 정지 여부) 추가
-- users.banned 를 게시글/댓글 작성자 양쪽으로 조인하여 표면화.
-- 반환 시그니처 변경이므로 DROP 후 재생성. service_role 전용 EXECUTE 유지(권한 변경 없음).

DROP FUNCTION IF EXISTS public.admin_list_reports(boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_list_reports(p_only_visible boolean DEFAULT false, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(target_type text, target_id uuid, report_count bigint, reasons text[], last_reported_at timestamp with time zone, content_preview text, author_id uuid, author_name text, author_banned boolean, hidden boolean, hidden_reason text, hidden_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         coalesce(pu.banned, cu.banned, false) as author_banned,
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
$function$;

-- service_role 전용 EXECUTE 유지 (DROP/CREATE 시 부여되는 기본 PUBLIC/anon/authenticated 권한 회수)
REVOKE EXECUTE ON FUNCTION public.admin_list_reports(boolean, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_reports(boolean, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_reports(boolean, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(boolean, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
