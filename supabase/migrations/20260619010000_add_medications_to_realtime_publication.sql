-- 복용약(medications) 실시간 동기화 활성화.
-- 환자/보호자 중 한쪽이 약을 추가·수정·삭제하면 다른쪽 화면이 새로고침 없이 즉시 반영되도록
-- supabase_realtime publication 에 medications 테이블을 추가한다.
-- (dose_slots·users 와 동일 패턴. RLS: 환자 본인 + 같은 그룹 보호자 SELECT 허용이라
--  realtime 이벤트도 양쪽에 정상 도달.)
alter publication supabase_realtime add table public.medications;
