-- 모더레이션: 정지 해제(unban) 시 '작성자 이용 정지'로 숨긴 글·댓글 복구를 옵션화.
-- 변경점: p_banned=false AND p_hide_content=true 분기 부활 — 단, hidden_reason='작성자 이용 정지'인 것만 복구.
--   신고누적 자동숨김('신고 누적 자동 숨김')·수동숨김 등 다른 사유 숨김은 절대 건드리지 않음.
-- 유지: 정지(p_banned=true) + p_hide_content=true → 기존 글·댓글 일괄 숨김.
--   p_hide_content=false(또는 미전달) → 정지/해제 어느 쪽이든 콘텐츠 안 건드림.
-- 시그니처 동일 → CREATE OR REPLACE (GRANT 보존됨).
create or replace function public.admin_set_user_banned(
  p_user_id uuid,
  p_banned boolean,
  p_reason text default null,
  p_hide_content boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- 계정 정지 상태는 항상 정상 set (정지/해제 공통)
  update public.users
    set banned        = p_banned,
        banned_at     = case when p_banned then now() else null end,
        banned_reason = case when p_banned then coalesce(p_reason, '운영자 차단') else null end
  where id = p_user_id;

  -- 정지 + 편의 옵션: 그 작성자의 공개 글·댓글을 '작성자 이용 정지' 사유로 일괄 숨김.
  if p_banned and p_hide_content then
    update public.posts
      set hidden = true,
          hidden_reason = '작성자 이용 정지',
          hidden_at = now()
    where author_id = p_user_id and hidden = false;

    update public.comments
      set hidden = true,
          hidden_reason = '작성자 이용 정지',
          hidden_at = now()
    where author_id = p_user_id and hidden = false;

  -- 정지 해제 + 편의 옵션: '작성자 이용 정지'로 숨긴 것만 다시 공개.
  --   신고누적 자동숨김·수동숨김 등 다른 사유 숨김은 그대로 둔다(hidden_reason으로 구분).
  elsif (not p_banned) and p_hide_content then
    update public.posts
      set hidden = false,
          hidden_reason = null,
          hidden_at = null
    where author_id = p_user_id
      and hidden = true
      and hidden_reason = '작성자 이용 정지';

    update public.comments
      set hidden = false,
          hidden_reason = null,
          hidden_at = null
    where author_id = p_user_id
      and hidden = true
      and hidden_reason = '작성자 이용 정지';
  end if;
  -- p_hide_content=false: 콘텐츠 미변경 (정지/해제 공통).
end;
$function$;

notify pgrst, 'reload schema';
