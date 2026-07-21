-- 가족 일기: 하루 1건(작성자당) 제약을 풀어 수시 작성을 허용.
-- id가 이미 별도 PK라 unique(patient_id, entry_date, author_id)만 제거하면 됨.
alter table public.diary_entries
  drop constraint if exists diary_entries_patient_id_entry_date_author_id_key;
