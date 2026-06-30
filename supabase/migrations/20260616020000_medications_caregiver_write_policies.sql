-- 보호자(같은 그룹)도 환자 약을 등록/수정/삭제할 수 있게 medications RLS 쓰기 정책 추가.
-- 기존: 쓰기는 환자 본인(patient_id = auth.uid())만 허용 → 보호자 등록/수정 실패.
-- 변경: SELECT가 이미 is_same_group을 쓰므로 쓰기도 동일 게이트로 일관 확장(환자 본인 정책은 OR로 유지).
-- (medication_history는 이미 patient_group_members 조인으로 같은 그룹 쓰기 허용 — 손대지 않음.)
create policy "medications: 같은 그룹 보호자 insert"
  on medications for insert
  with check (is_same_group((select auth.uid()), patient_id));

create policy "medications: 같은 그룹 보호자 update"
  on medications for update
  using (is_same_group((select auth.uid()), patient_id))
  with check (is_same_group((select auth.uid()), patient_id));

create policy "medications: 같은 그룹 보호자 delete"
  on medications for delete
  using (is_same_group((select auth.uid()), patient_id));
