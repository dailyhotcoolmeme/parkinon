-- 모더레이션 모델 정리: 이용 정지(계정)와 게시물 숨김을 완전 독립으로.
-- 변경점: 정지 해제(p_banned=false) 시 게시물 공개 여부를 절대 건드리지 않음.
--   기존의 "정지로 숨긴 글 자동 복구" 로직(else 분기)을 제거 — 이게 개별 숨김/복구와 충돌하던 원인.
-- 유지: 정지(p_banned=true) 시 p_hide_content=true면 기존 글·댓글 일괄 숨김 편의 옵션.
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

  -- 게시물 숨김은 '정지할 때 + 편의 옵션 켰을 때'만. 정지 해제는 콘텐츠를 절대 안 건드림.
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
  end if;
end;
$function$;

notify pgrst, 'reload schema';
