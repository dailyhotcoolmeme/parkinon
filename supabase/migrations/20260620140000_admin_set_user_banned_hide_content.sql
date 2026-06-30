-- admin_set_user_banned 에 p_hide_content 파라미터 추가:
--   작성자 이용 정지/해제 시 그 작성자의 기존 게시물·댓글을 일괄 숨김/복구할지 운영자가 선택.
-- 시그니처 변경(파라미터 추가)이므로 기존 함수 DROP 후 재생성 + service_role EXECUTE 권한 복원.
--   - p_banned=true  AND p_hide_content=true: 숨김 안 된(author 본인) posts/comments 를 일괄 숨김
--       (hidden=true, hidden_reason='작성자 이용 정지', hidden_at=now()). hidden=false 인 것만.
--   - p_banned=false AND p_hide_content=true: '작성자 이용 정지' 로 숨겼던 것만 복구
--       (hidden=false, hidden_reason=null, hidden_at=null).
--       수동('운영자 숨김') / 자동('신고 누적 자동 숨김') 숨김은 hidden_reason 으로 구분하여 건드리지 않음.

-- 구 시그니처 제거 (호출부는 named arg 사용이므로 신규 시그니처로 정상 라우팅됨)
DROP FUNCTION IF EXISTS public.admin_set_user_banned(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.admin_set_user_banned(
  p_user_id      uuid,
  p_banned       boolean,
  p_reason       text default null,
  p_hide_content boolean default false
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

  if p_hide_content then
    if p_banned then
      -- 정지: 숨김 안 된 작성자 콘텐츠 일괄 숨김
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
    else
      -- 정지 해제: '작성자 이용 정지' 로 숨겼던 것만 복구 (수동/자동 숨김은 보존)
      update public.posts
        set hidden = false,
            hidden_reason = null,
            hidden_at = null
      where author_id = p_user_id and hidden_reason = '작성자 이용 정지';

      update public.comments
        set hidden = false,
            hidden_reason = null,
            hidden_at = null
      where author_id = p_user_id and hidden_reason = '작성자 이용 정지';
    end if;
  end if;
end;
$$;

-- service_role 전용 권한 복원 (DROP/CREATE 시 부여되는 기본 PUBLIC/anon/authenticated 회수)
revoke all on function public.admin_set_user_banned(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_user_banned(uuid, boolean, text, boolean) to service_role;

NOTIFY pgrst, 'reload schema';
