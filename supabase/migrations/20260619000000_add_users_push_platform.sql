-- 푸시 라우팅용 사용자 플랫폼 기록 (개인화 알림음 3단계 대비)
-- iOS/Android 구분이 있어야 푸시 발송 시 사운드명/채널을 분기할 수 있다.
-- 토큰 등록(save-push-token / requestPermissionsAndSaveToken) 시 Platform.OS 를 함께 저장.
alter table public.users
  add column if not exists push_platform text
  check (push_platform is null or push_platform in ('ios', 'android', 'web'));

comment on column public.users.push_platform is
  '푸시 토큰을 등록한 기기 플랫폼(ios|android|web). 토큰 등록 시 Platform.OS 기록. 푸시 라우팅(사운드/채널 분기)용.';
