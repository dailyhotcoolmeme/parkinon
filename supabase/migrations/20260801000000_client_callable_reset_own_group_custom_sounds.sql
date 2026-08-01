-- reset_group_custom_sounds(uuid) 는 임의 그룹 id를 받아 authenticated 에서 revoke 돼 있다
-- (다른 그룹을 지울 수 있으면 안 되므로). 클라이언트(SubscriptionContext)에서 "한국에서 만든
-- 커스텀 알림음을 해외 로케일+free 로 전환 시 되돌리기" 용으로 호출할 안전한 래퍼 —
-- auth.uid() 로 알아낸 자기 그룹만 초기화한다.
create or replace function public.reset_my_group_custom_sounds()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
begin
  select patient_group_id into v_group_id from public.users where id = auth.uid();
  if v_group_id is null then
    return;
  end if;
  perform public.reset_group_custom_sounds(v_group_id);
end $$;

grant execute on function public.reset_my_group_custom_sounds() to authenticated;
