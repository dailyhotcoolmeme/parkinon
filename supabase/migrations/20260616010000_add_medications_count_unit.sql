-- 복용횟수 단위(1일/1주) 구분. daily_count는 그대로(횟수 숫자), count_unit이 기준 기간.
-- 'day' = "1일 N회"(기본), 'week' = "1주 N회". 주 N회 처방약(예: 일부 도파민작용제) 대응.
alter table medications
  add column if not exists count_unit text not null default 'day'
  check (count_unit in ('day','week'));
