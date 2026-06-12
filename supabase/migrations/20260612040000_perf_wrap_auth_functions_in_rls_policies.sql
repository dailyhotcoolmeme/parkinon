-- 성능(auth_rls_initplan, 100건): RLS 정책의 bare auth.uid()/auth.jwt()/auth.role() 호출을
-- (select ...) 로 감싸 행별 재평가를 1회 평가로 최적화. 접근 규칙(로직)은 완전히 동일.
-- pg_policies 에서 permissive/cmd/roles/qual/with_check 를 그대로 읽어 함수 호출만 래핑해 재생성.
-- 트랜잭션 내 실행 → 한 정책이라도 실패하면 전체 롤백(부분 적용 없음).
-- (라이브 적용·검증 완료: 어드바이저 auth_rls_initplan 100→0, 정책 수 105 보존 — 저장소 추적용)
do $$
declare
  r record;
  v_qual text;
  v_check text;
  stmt text;
begin
  for r in
    select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'')       ~ 'auth\.(uid|jwt|role)\(\)'
           or coalesce(with_check,'') ~ 'auth\.(uid|jwt|role)\(\)')
  loop
    v_qual  := r.qual;
    v_check := r.with_check;

    if v_qual is not null then
      v_qual := replace(v_qual, 'auth.uid()',  '(select auth.uid())');
      v_qual := replace(v_qual, 'auth.jwt()',  '(select auth.jwt())');
      v_qual := replace(v_qual, 'auth.role()', '(select auth.role())');
    end if;
    if v_check is not null then
      v_check := replace(v_check, 'auth.uid()',  '(select auth.uid())');
      v_check := replace(v_check, 'auth.jwt()',  '(select auth.jwt())');
      v_check := replace(v_check, 'auth.role()', '(select auth.role())');
    end if;

    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);

    stmt := format('create policy %I on %I.%I as %s for %s to %s',
              r.policyname, r.schemaname, r.tablename,
              r.permissive, r.cmd, array_to_string(r.roles, ', '));
    if v_qual is not null then
      stmt := stmt || ' using (' || v_qual || ')';
    end if;
    if v_check is not null then
      stmt := stmt || ' with check (' || v_check || ')';
    end if;

    execute stmt;
  end loop;
end $$;
