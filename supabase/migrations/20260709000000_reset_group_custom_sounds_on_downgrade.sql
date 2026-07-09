-- 구독 만료(다운그레이드) 시 그룹의 커스텀 알림음 설정을 기본음으로 초기화.
-- 녹음(custom_sounds)·미디어는 삭제하지 않음(재구독 시 재선택 가능). 알림 스케줄은 보존.
-- 호출: revenuecat-webhook 의 EXPIRATION 이벤트에서 reset_group_custom_sounds(group_id).
create or replace function public.reset_group_custom_sounds(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 기본 목소리 / 미복용 알림음 매핑 삭제 → 시스템 기본음
  delete from alarm_sound_prefs
   where user_id in (select id from users where patient_group_id = p_group_id);
  delete from missed_med_sound_prefs
   where user_id in (select id from users where patient_group_id = p_group_id);

  -- 대기 중 약효추적 큐의 커스텀 사운드 해제
  update effect_tracking_queue set sound_id = null
   where sound_id is not null
     and patient_id in (select id from users where patient_group_id = p_group_id);

  -- 약시간 슬롯별 사운드 매핑 비우기 (순수 사운드 → 기본음)
  update users set med_time_sound_prefs = null
   where patient_group_id = p_group_id and med_time_sound_prefs is not null;

  -- 약효/운동 알림 배열: soundId 키만 제거(스케줄·순서 보존)
  update users u set med_notif_prefs = sub.arr
    from (
      select us.id, jsonb_agg(e.elem - 'soundId' order by e.ord) as arr
        from users us, jsonb_array_elements(us.med_notif_prefs) with ordinality as e(elem, ord)
       where us.patient_group_id = p_group_id and jsonb_typeof(us.med_notif_prefs) = 'array'
       group by us.id
    ) sub
   where u.id = sub.id;

  update users u set exercise_notif_prefs = sub.arr
    from (
      select us.id, jsonb_agg(e.elem - 'soundId' order by e.ord) as arr
        from users us, jsonb_array_elements(us.exercise_notif_prefs) with ordinality as e(elem, ord)
       where us.patient_group_id = p_group_id and jsonb_typeof(us.exercise_notif_prefs) = 'array'
       group by us.id
    ) sub
   where u.id = sub.id;
end $$;

revoke all on function public.reset_group_custom_sounds(uuid) from public, anon, authenticated;
